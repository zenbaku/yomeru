import type { OCRResult } from './ocr/types.ts'
import type { TranslationResult } from './translation/types.ts'
import { getDefaultOCRModel } from './ocr/registry.ts'
import { getDefaultTranslationModel } from './translation/registry.ts'

export type PipelinePhase =
  | 'idle'
  | 'capturing'
  | 'ocr'
  | 'segmenting'
  | 'translating'
  | 'done'
  | 'error'

export interface PipelineState {
  phase: PipelinePhase
  ocrResult: OCRResult | null
  translations: TranslationResult[] | null
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

export type StateListener = (state: PipelineState) => void

export async function runPipeline(
  frame: ImageData,
  onState: StateListener,
): Promise<void> {
  let state: PipelineState = {
    ...INITIAL_STATE,
    phase: 'capturing',
    imageSize: { width: frame.width, height: frame.height },
  }
  onState(state)

  try {
    // OCR phase
    state = { ...state, phase: 'ocr' }
    onState(state)

    const ocrModel = getDefaultOCRModel()
    await ocrModel.initialize()
    const ocrResult = await ocrModel.recognize(frame)

    state = { ...state, ocrResult }
    onState(state)

    if (ocrResult.lines.length === 0) {
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

    const fullText = ocrResult.lines.map((l) => l.text).join('')
    const translations = await translationModel.translate(fullText)

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
