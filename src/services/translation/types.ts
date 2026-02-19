export interface TranslationResult {
  original: string
  reading: string
  translations: string[]
  partOfSpeech: string
}

export interface TranslationModel {
  id: string
  name: string
  description: string
  size: number
  isDownloaded: () => Promise<boolean>
  initialize: (onProgress?: (p: number) => void) => Promise<void>
  /** Takes full text, segments it, and returns per-word translations */
  translate: (text: string) => Promise<TranslationResult[]>
  terminate: () => Promise<void>
  clearCache: () => Promise<void>
}

/** Shared model info shape used for display purposes on the Models page. */
export interface ModelInfo {
  id: string
  name: string
  description: string
  size: number
  isDownloaded: () => Promise<boolean>
  initialize: (onProgress?: (p: number) => void) => Promise<void>
  clearCache: () => Promise<void>
}
