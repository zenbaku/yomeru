import type { OCRResult } from './ocr/types.ts'
import type { TranslationResult } from './translation/types.ts'
import { getDefaultOCRModel } from './ocr/registry.ts'
import { getDefaultTranslationModel } from './translation/registry.ts'
import { filterOCRLines } from './ocr/filters.ts'
import { preprocessFrame } from './preprocessing.ts'

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
  /** Per-line word-by-word dictionary translations */
  translations: TranslationResult[][] | null
  error: string | null
  /** Dimensions of the source image (for overlay scaling) */
  imageSize: { width: number; height: number } | null
}

export const INITIAL_STATE: PipelineState = {
  phase: 'idle',
  ocrResult: null,
  translations: null,
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
    const ocrModel = getDefaultOCRModel()

    // Preprocessing phase — skip for PaddleOCR (its detection model handles scene text natively)
    let processed = frame
    if (ocrModel.id === 'tesseract-jpn') {
      try {
        processed = preprocessFrame(frame)
      } catch (err) {
        console.error('Preprocessing failed:', err)
        // Fall back to raw frame if preprocessing fails
      }
    }

    // OCR phase
    state = { ...state, phase: 'ocr' }
    onState(state)

    try {
      await ocrModel.initialize()
    } catch (err) {
      throw new Error(`OCR model failed to load: ${err instanceof Error ? err.message : 'unknown error'}`)
    }

    let rawResult: OCRResult
    try {
      rawResult = await ocrModel.recognize(processed)
    } catch (err) {
      throw new Error(`Text recognition failed: ${err instanceof Error ? err.message : 'unknown error'}`)
    }

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

    // Segmentation + Dictionary phase (instant)
    state = { ...state, phase: 'segmenting' }
    onState(state)

    const translationModel = getDefaultTranslationModel()
    try {
      await translationModel.initialize()
    } catch (err) {
      throw new Error(`Translation model failed to load: ${err instanceof Error ? err.message : 'unknown error'}`)
    }

    state = { ...state, phase: 'translating' }
    onState(state)

    // Translate each line independently for per-line dictionary results
    const translations: TranslationResult[][] = []
    for (const line of ocrResult.lines) {
      try {
        const lineTranslations = await translationModel.translate(line.text)
        translations.push(lineTranslations)
      } catch {
        // Skip lines that fail to translate rather than aborting
        translations.push([])
      }
    }

    // Pipeline finishes here — neural translation (NLLB) is handled externally
    state = { ...state, phase: 'done', translations }
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
