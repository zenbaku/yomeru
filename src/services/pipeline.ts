import type { OCRResult } from './ocr/types.ts'
import type { TranslationResult } from './translation/types.ts'
import { getDefaultOCRModel } from './ocr/registry.ts'
import { getDefaultTranslationModel } from './translation/registry.ts'
import { filterOCRLines } from './ocr/filters.ts'
import { preprocessFrame } from './preprocessing.ts'
import { log } from './logger.ts'

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
  /** When aborted, the pipeline stops between phases and throws. */
  signal?: AbortSignal
}

export type StateListener = (state: PipelineState) => void

/** Check the signal and throw if the pipeline has been cancelled. */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Pipeline aborted', 'AbortError')
  }
}

export async function runPipeline(
  frame: ImageData,
  onState: StateListener,
  options?: PipelineOptions,
): Promise<void> {
  const signal = options?.signal

  let state: PipelineState = {
    ...INITIAL_STATE,
    phase: 'preprocessing',
    imageSize: { width: frame.width, height: frame.height },
  }
  onState(state)

  const t0 = performance.now()
  try {
    throwIfAborted(signal)

    const ocrModel = getDefaultOCRModel()
    log.pipeline('started', { model: ocrModel.id, width: frame.width, height: frame.height })

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
    throwIfAborted(signal)
    state = { ...state, phase: 'ocr' }
    onState(state)

    try {
      await ocrModel.initialize()
      log.pipeline('ocr model initialized', { elapsed: performance.now() - t0 })
    } catch (err) {
      log.pipelineError('ocr init failed', err)
      throw new Error(`OCR model failed to load: ${err instanceof Error ? err.message : 'unknown error'}`)
    }

    throwIfAborted(signal)

    let rawResult: OCRResult
    try {
      rawResult = await ocrModel.recognize(processed)
      log.pipeline('ocr complete', { lines: rawResult.lines.length, elapsed: performance.now() - t0 })
    } catch (err) {
      log.pipelineError('ocr recognize failed', err)
      throw new Error(`Text recognition failed: ${err instanceof Error ? err.message : 'unknown error'}`)
    }

    throwIfAborted(signal)

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
    throwIfAborted(signal)
    state = { ...state, phase: 'segmenting' }
    onState(state)

    const translationModel = getDefaultTranslationModel()
    try {
      await translationModel.initialize()
    } catch (err) {
      throw new Error(`Translation model failed to load: ${err instanceof Error ? err.message : 'unknown error'}`)
    }

    throwIfAborted(signal)
    state = { ...state, phase: 'translating' }
    onState(state)

    // Translate each line independently for per-line dictionary results
    const translations: TranslationResult[][] = []
    for (const line of ocrResult.lines) {
      throwIfAborted(signal)
      try {
        const lineTranslations = await translationModel.translate(line.text)
        translations.push(lineTranslations)
      } catch {
        // Skip lines that fail to translate rather than aborting
        translations.push([])
      }
    }

    // Pipeline finishes here — neural translation (NLLB) is handled externally
    log.pipeline('done', { elapsed: performance.now() - t0, translatedLines: translations.length })
    state = { ...state, phase: 'done', translations }
    onState(state)
  } catch (err) {
    // Don't report abort as an error — it's an intentional cancellation
    if (err instanceof DOMException && err.name === 'AbortError') {
      log.pipeline('aborted', { elapsed: performance.now() - t0 })
      return
    }

    log.pipelineError('pipeline failed', err, { elapsed: performance.now() - t0 })
    state = {
      ...state,
      phase: 'error',
      error: err instanceof Error ? err.message : 'Unknown error',
    }
    onState(state)
  }
}
