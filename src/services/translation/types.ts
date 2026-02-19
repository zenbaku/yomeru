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
}
