import Tesseract from 'tesseract.js'
import type { OCRModel, OCRResult } from './types.ts'

let worker: Tesseract.Worker | null = null
// Reuse a single canvas to avoid leaking GPU-backed surfaces across OCR calls
let ocrCanvas: HTMLCanvasElement | null = null

export const tesseractJpn: OCRModel = {
  id: 'tesseract-jpn',
  name: 'Tesseract Japanese',
  description: 'General-purpose Japanese OCR (horizontal text)',
  size: 10_000_000, // ~10MB (WASM core + jpn trained data)

  async isDownloaded() {
    if (worker) return true
    try {
      const cache = await caches.open('tesseract-assets')
      const keys = await cache.keys()
      return keys.some((req) => req.url.includes('traineddata'))
    } catch {
      return false
    }
  },

  async initialize(onProgress) {
    if (worker) return

    worker = await Tesseract.createWorker('jpn', undefined, {
      logger: (m) => {
        if (onProgress && m.progress > 0) {
          onProgress(m.progress)
        }
      },
    })
  },

  async recognize(image: ImageData): Promise<OCRResult> {
    if (!worker) {
      throw new Error('Tesseract worker not initialized. Call initialize() first.')
    }

    // Reuse a single offscreen canvas for Tesseract input
    if (!ocrCanvas) ocrCanvas = document.createElement('canvas')
    ocrCanvas.width = image.width
    ocrCanvas.height = image.height
    const ctx = ocrCanvas.getContext('2d')!
    ctx.putImageData(image, 0, 0)

    const result = await worker.recognize(ocrCanvas, {}, { blocks: true, text: true })

    // Release canvas backing store while idle to free memory
    ocrCanvas.width = 0
    ocrCanvas.height = 0

    const page = result.data

    const lines = (page.blocks ?? []).flatMap((block) =>
      block.paragraphs.flatMap((para) =>
        para.lines.map((line) => ({
          text: line.text.trim(),
          confidence: line.confidence,
          bbox: {
            x: line.bbox.x0,
            y: line.bbox.y0,
            width: line.bbox.x1 - line.bbox.x0,
            height: line.bbox.y1 - line.bbox.y0,
          },
        }))
      )
    ).filter((line) => line.text.length > 0)

    const fullText = page.text.trim()

    // Fallback: if blocks didn't parse but we got raw text, create a single line
    if (lines.length === 0 && fullText.length > 0) {
      lines.push({
        text: fullText,
        confidence: page.confidence,
        bbox: { x: 0, y: 0, width: image.width, height: image.height },
      })
    }

    return { lines, fullText }
  },

  async terminate() {
    if (worker) {
      await worker.terminate()
      worker = null
    }
    if (ocrCanvas) {
      ocrCanvas.width = 0
      ocrCanvas.height = 0
      ocrCanvas = null
    }
  },

  async clearCache() {
    await this.terminate()
    try {
      await caches.delete('tesseract-assets')
    } catch {
      // Cache API may not be available
    }
  },
}
