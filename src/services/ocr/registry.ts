import type { OCRModel } from './types.ts'
import { tesseractJpn } from './tesseract.ts'

export const ocrModels: OCRModel[] = [tesseractJpn]

export function getOCRModel(id: string): OCRModel | undefined {
  return ocrModels.find((m) => m.id === id)
}

export function getDefaultOCRModel(): OCRModel {
  return tesseractJpn
}
