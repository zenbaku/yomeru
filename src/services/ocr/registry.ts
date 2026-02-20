import type { OCRModel } from './types.ts'
import { tesseractJpn } from './tesseract.ts'
import { paddleOCR } from './paddleocr.ts'

const STORAGE_KEY = 'yomeru:ocr-model'

export const ocrModels: OCRModel[] = [paddleOCR, tesseractJpn]

export function getOCRModel(id: string): OCRModel | undefined {
  return ocrModels.find((m) => m.id === id)
}

export function getDefaultOCRModel(): OCRModel {
  return getOCRModel(getSelectedOCRModelId()) ?? paddleOCR
}

export function getSelectedOCRModelId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? paddleOCR.id
  } catch {
    return paddleOCR.id
  }
}

export function setSelectedOCRModelId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // localStorage may not be available
  }
}
