import type { OCRModel, OCRResult } from './types.ts'
import { downloadWithProgress, isCached } from '../storage/model-cache.ts'

const CACHE_NAME = 'paddleocr-models'

const MODEL_FILES = {
  det: {
    url: 'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/detection/v5/det.onnx',
    size: 3_000_000,
  },
  rec: {
    url: 'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/chinese/rec.onnx',
    size: 10_000_000,
  },
  dict: {
    url: 'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/chinese/dict.txt',
    size: 200_000,
  },
} as const

const TOTAL_SIZE = MODEL_FILES.det.size + MODEL_FILES.rec.size + MODEL_FILES.dict.size

let ocrInstance: any = null
let initPromise: Promise<void> | null = null

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

    // Prevent concurrent initialization — all callers share the same promise
    if (initPromise) return initPromise

    initPromise = (async () => {
      try {
        // Download all model files with combined progress tracking
        let downloaded = 0

        for (const file of [MODEL_FILES.det, MODEL_FILES.rec, MODEL_FILES.dict]) {
          const before = downloaded
          await downloadWithProgress(file.url, CACHE_NAME, (loaded, _total) => {
            onProgress?.((before + loaded) / TOTAL_SIZE)
          })
          downloaded += file.size
          onProgress?.(downloaded / TOTAL_SIZE)
        }

        // Create blob URLs from cached files so the OCR library can load them
        const [detUrl, recUrl, dictUrl] = await Promise.all([
          cachedResponseToURL(MODEL_FILES.det.url),
          cachedResponseToURL(MODEL_FILES.rec.url),
          cachedResponseToURL(MODEL_FILES.dict.url),
        ])

        try {
          const { default: Ocr } = await import('@gutenye/ocr-browser')
          ocrInstance = await Ocr.create({
            models: {
              detectionPath: detUrl,
              recognitionPath: recUrl,
              dictionaryPath: dictUrl,
            },
          })
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

    // Convert ImageData to a blob URL — the library only accepts URL strings
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext('2d')!
    ctx.putImageData(image, 0, 0)

    const blobUrl = await new Promise<string>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('Failed to create image blob'))
        resolve(URL.createObjectURL(blob))
      }, 'image/png')
    })

    try {
      // detect() returns Line[] where Line = { text, mean, box? }
      // box is a 4-point polygon: [[x0,y0], [x1,y1], [x2,y2], [x3,y3]]
      const detectedLines: any[] = await ocrInstance.detect(blobUrl)

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
      canvas.width = 0
      canvas.height = 0
    }
  },

  async terminate() {
    if (ocrInstance) {
      // The library doesn't expose a dispose method on the instance,
      // but nulling the reference allows GC to collect ONNX sessions
      ocrInstance = null
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
