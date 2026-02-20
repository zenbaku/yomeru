import type { OCRModel, OCRResult } from './types.ts'
import { downloadWithProgress, isCached } from '../storage/model-cache.ts'

const CACHE_NAME = 'paddleocr-models'

/** Timeout for Ocr.create() — ONNX session loading */
const INIT_TIMEOUT_MS = 60_000
/** Timeout for ocrInstance.detect() — single inference pass */
const DETECT_TIMEOUT_MS = 30_000

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

const MODEL_FILES = {
  det: {
    url: 'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/detection/v5/det.onnx',
    size: 3_000_000,
    label: 'text detection model',
  },
  rec: {
    url: 'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/chinese/rec.onnx',
    size: 10_000_000,
    label: 'text recognition model',
  },
  dict: {
    url: 'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/chinese/dict.txt',
    size: 200_000,
    label: 'character dictionary',
  },
} as const

const MODEL_FILE_LIST = [MODEL_FILES.det, MODEL_FILES.rec, MODEL_FILES.dict] as const
const TOTAL_SIZE = MODEL_FILES.det.size + MODEL_FILES.rec.size + MODEL_FILES.dict.size

let ocrInstance: any = null
let initPromise: Promise<void> | null = null

// Reuse a single canvas for recognize() to avoid leaking GPU-backed surfaces.
// Creating a new canvas per frame causes GPU memory fragmentation on mobile,
// eventually leading to OOM crashes.
let recognizeCanvas: HTMLCanvasElement | null = null

/** Convert a cached response to an object URL that the OCR library can fetch. */
async function cachedResponseToURL(url: string): Promise<string> {
  const cache = await caches.open(CACHE_NAME)
  const response = await cache.match(url)
  if (!response) throw new Error(`Model file not found in cache: ${url}`)
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}

export const paddleOCR: OCRModel = {
  id: 'paddleocr-v4-cjk',
  name: 'PaddleOCR (CJK)',
  description: 'High-accuracy scene text OCR for Chinese, Japanese, and Korean. Best for signs, menus, and real-world text.',
  size: TOTAL_SIZE,

  async isDownloaded() {
    if (ocrInstance) return true
    try {
      const [det, rec, dict] = await Promise.all([
        isCached(MODEL_FILES.det.url, CACHE_NAME),
        isCached(MODEL_FILES.rec.url, CACHE_NAME),
        isCached(MODEL_FILES.dict.url, CACHE_NAME),
      ])
      return det && rec && dict
    } catch {
      return false
    }
  },

  async initialize(onProgress) {
    if (ocrInstance) return

    // Prevent concurrent initialization — all callers share the same promise.
    // If a previous init is still pending (possibly hung), abandon it and retry.
    if (initPromise) return initPromise

    initPromise = (async () => {
      try {
        // Download all model files with combined progress tracking.
        // Use estimated sizes for weighting, but clamp to [0, 1] to guard
        // against actual file sizes differing from estimates.
        let downloaded = 0

        for (const file of MODEL_FILE_LIST) {
          const before = downloaded
          await downloadWithProgress(file.url, CACHE_NAME, (loaded, _total) => {
            const raw = (before + loaded) / TOTAL_SIZE
            onProgress?.(Math.min(raw, 1))
          })
          downloaded += file.size
          onProgress?.(Math.min(downloaded / TOTAL_SIZE, 1))
        }

        // Create blob URLs from cached files so the OCR library can load them
        const [detUrl, recUrl, dictUrl] = await Promise.all([
          cachedResponseToURL(MODEL_FILES.det.url),
          cachedResponseToURL(MODEL_FILES.rec.url),
          cachedResponseToURL(MODEL_FILES.dict.url),
        ])

        try {
          const { default: Ocr } = await import('@gutenye/ocr-browser')
          ocrInstance = await withTimeout(
            Ocr.create({
              models: {
                detectionPath: detUrl,
                recognitionPath: recUrl,
                dictionaryPath: dictUrl,
              },
            }),
            INIT_TIMEOUT_MS,
            'OCR model initialization timed out — the ONNX runtime may have stalled. Try reloading the page.',
          )
        } catch (err) {
          // Ensure ocrInstance is null on timeout or any init failure so
          // subsequent initialize() calls retry instead of assuming success
          ocrInstance = null
          throw err
        } finally {
          URL.revokeObjectURL(detUrl)
          URL.revokeObjectURL(recUrl)
          URL.revokeObjectURL(dictUrl)
        }
      } finally {
        initPromise = null
      }
    })()

    return initPromise
  },

  async recognize(image: ImageData): Promise<OCRResult> {
    if (!ocrInstance) {
      throw new Error('PaddleOCR not initialized. Call initialize() first.')
    }

    // Reuse a single offscreen canvas to avoid leaking GPU-backed surfaces
    if (!recognizeCanvas) {
      recognizeCanvas = document.createElement('canvas')
    }
    recognizeCanvas.width = image.width
    recognizeCanvas.height = image.height
    const ctx = recognizeCanvas.getContext('2d')!
    ctx.putImageData(image, 0, 0)

    const blobUrl = await new Promise<string>((resolve, reject) => {
      recognizeCanvas!.toBlob((blob) => {
        if (!blob) return reject(new Error('Failed to create image blob'))
        resolve(URL.createObjectURL(blob))
      }, 'image/jpeg', 0.90)
    })

    try {
      // detect() returns Line[] where Line = { text, mean, box? }
      // box is a 4-point polygon: [[x0,y0], [x1,y1], [x2,y2], [x3,y3]]
      const detectedLines: any[] = await withTimeout(
        ocrInstance.detect(blobUrl),
        DETECT_TIMEOUT_MS,
        'OCR detection timed out — try scanning a simpler image',
      )

      const lines = (detectedLines ?? [])
        .filter((line: any) => line.text && line.text.length > 0)
        .map((line: any) => {
          let bbox = { x: 0, y: 0, width: image.width, height: image.height }

          if (line.box && line.box.length === 4) {
            const xs = line.box.map((p: number[]) => p[0])
            const ys = line.box.map((p: number[]) => p[1])
            const minX = Math.min(...xs)
            const minY = Math.min(...ys)
            bbox = {
              x: Math.round(minX),
              y: Math.round(minY),
              width: Math.round(Math.max(...xs) - minX),
              height: Math.round(Math.max(...ys) - minY),
            }
          }

          return {
            text: line.text.trim(),
            confidence: line.mean ?? 0, // 0-1 confidence score
            bbox,
          }
        })

      const fullText = lines.map((l: any) => l.text).join('')
      return { lines, fullText }
    } finally {
      URL.revokeObjectURL(blobUrl)
      // Release canvas backing store while idle to free GPU memory
      if (recognizeCanvas) {
        recognizeCanvas.width = 0
        recognizeCanvas.height = 0
      }
    }
  },

  async terminate() {
    // NOTE: The @gutenye/ocr-browser Ocr class stores its ONNX
    // InferenceSession objects in #private fields.  We cannot call
    // session.release(), so the ONNX thread-pool workers
    // (SharedArrayBuffer) will be orphaned and the WASM linear memory
    // leaked until the page is unloaded.  Because of this, callers
    // should minimise how often terminate() is invoked — ideally only
    // when the app is backgrounded or unmounted.
    ocrInstance = null
    initPromise = null
    if (recognizeCanvas) {
      recognizeCanvas.width = 0
      recognizeCanvas.height = 0
      recognizeCanvas = null
    }
  },

  async clearCache() {
    await this.terminate()
    try {
      await caches.delete(CACHE_NAME)
    } catch {
      // Cache API may not be available
    }
  },
}
