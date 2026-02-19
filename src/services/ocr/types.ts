export interface BBox {
  x: number
  y: number
  width: number
  height: number
}

export interface OCRLine {
  text: string
  confidence: number
  bbox: BBox
}

export interface OCRResult {
  lines: OCRLine[]
  fullText: string
}

export interface OCRModel {
  id: string
  name: string
  description: string
  size: number // bytes
  isDownloaded: () => Promise<boolean>
  initialize: (onProgress?: (p: number) => void) => Promise<void>
  recognize: (image: ImageData) => Promise<OCRResult>
  terminate: () => Promise<void>
  clearCache: () => Promise<void>
}
