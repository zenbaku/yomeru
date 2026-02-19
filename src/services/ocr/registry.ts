import type { OCRModel } from './types.ts'
import { tesseractJpn } from './tesseract.ts'
import { paddleOCR } from './paddleocr.ts'

export const ocrModels: OCRModel[] = [paddleOCR, tesseractJpn]

export function getOCRModel(id: string): OCRModel | undefined {
  return ocrModels.find((m) => m.id === id)
}

export function getDefaultOCRModel(): OCRModel {
  return paddleOCR
}
