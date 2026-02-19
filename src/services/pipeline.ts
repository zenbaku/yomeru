import type { OCRResult } from './ocr/types.ts'
import type { TranslationResult } from './translation/types.ts'
import { getDefaultOCRModel } from './ocr/registry.ts'
import { getDefaultTranslationModel } from './translation/registry.ts'
import { filterOCRLines } from './ocr/filters.ts'
import { preprocessFrame } from './preprocessing.ts'
import { translatePhrases } from './translation/phrase.ts'

export type PipelinePhase =
  | 'idle'
  | 'preprocessing'
  | 'ocr'
  | 'segmenting'
  | 'translating'
  | 'done'
  | 'error'

export interface PipelineState {
  phase: PipelinePhase
  ocrResult: OCRResult | null
  translations: TranslationResult[] | null
  /** Per-line phrase translations, or null if unavailable */
  phraseTranslation: string[] | null
  error: string | null
  /** Dimensions of the source image (for overlay scaling) */
  imageSize: { width: number; height: number } | null
}

export const INITIAL_STATE: PipelineState = {
  phase: 'idle',
  ocrResult: null,
  translations: null,
  phraseTranslation: null,
  error: null,
  imageSize: null,
}

export interface PipelineOptions {
  ocrOnly?: boolean
}

export type StateListener = (state: PipelineState) => void

export async function runPipeline(
  frame: ImageData,
  onState: StateListener,
  options?: PipelineOptions,
): Promise<void> {
  let state: PipelineState = {
    ...INITIAL_STATE,
    phase: 'preprocessing',
    imageSize: { width: frame.width, height: frame.height },
  }
  onState(state)

  try {
    // Preprocessing phase
    const processed = preprocessFrame(frame)

    // OCR phase
    state = { ...state, phase: 'ocr' }
    onState(state)

    const ocrModel = getDefaultOCRModel()
    await ocrModel.initialize()
    const rawResult = await ocrModel.recognize(processed)

    // Filter OCR lines (confidence, content, size, overlap, merge)
    const filteredLines = filterOCRLines(rawResult.lines)
    const ocrResult: OCRResult = {
      lines: filteredLines,
      fullText: filteredLines.map((l) => l.text).join(''),
    }

    state = { ...state, ocrResult }
    onState(state)

    if (ocrResult.fullText.length === 0 || options?.ocrOnly) {
      state = { ...state, phase: 'done', translations: [] }
      onState(state)
      return
    }

    // Segmentation + Translation phase
    state = { ...state, phase: 'segmenting' }
    onState(state)

    const translationModel = getDefaultTranslationModel()
    await translationModel.initialize()

    state = { ...state, phase: 'translating' }
    onState(state)

    // Run word-by-word lookup and per-line phrase translation in parallel
    const lineTexts = ocrResult.lines.map((l) => l.text)
    const [translations, phraseTranslation] = await Promise.all([
      translationModel.translate(ocrResult.fullText),
      translatePhrases(lineTexts),
    ])

    state = { ...state, phase: 'done', translations, phraseTranslation }
    onState(state)
  } catch (err) {
    state = {
      ...state,
      phase: 'error',
      error: err instanceof Error ? err.message : 'Unknown error',
    }
    onState(state)
  }
}
