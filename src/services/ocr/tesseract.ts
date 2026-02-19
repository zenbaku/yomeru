import Tesseract from 'tesseract.js'
import type { OCRModel, OCRResult } from './types.ts'

let worker: Tesseract.Worker | null = null

export const tesseractJpn: OCRModel = {
  id: 'tesseract-jpn',
  name: 'Tesseract Japanese',
  description: 'General-purpose Japanese OCR (horizontal text)',
  size: 10_000_000, // ~10MB (WASM core + jpn trained data)

  async isDownloaded() {
    // Tesseract.js handles its own caching via browser cache
    // If the worker has been created before, the data is likely cached
    return worker !== null
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

    // Convert ImageData to canvas for Tesseract
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext('2d')!
    ctx.putImageData(image, 0, 0)

    const result = await worker.recognize(canvas)
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

    return {
      lines,
      fullText: page.text.trim(),
    }
  },

  async terminate() {
    if (worker) {
      await worker.terminate()
      worker = null
    }
  },
}
