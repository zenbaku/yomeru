/**
 * Regression tests for pipeline timeout and error recovery.
 *
 * These tests use mock OCR/translation models to simulate hangs and failures,
 * verifying that the pipeline always terminates (via timeout or error) instead
 * of leaving the UI stuck with a spinner forever.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runPipeline, type PipelineState, type PipelinePhase } from '@/services/pipeline.ts'
import type { OCRModel } from '@/services/ocr/types.ts'
import type { TranslationModel } from '@/services/translation/types.ts'
import { createImageData } from './helpers.ts'

// ---------------------------------------------------------------------------
// Mock model factories
// ---------------------------------------------------------------------------

function createMockOCRModel(overrides: Partial<OCRModel> = {}): OCRModel {
  return {
    id: 'mock-ocr',
    name: 'Mock OCR',
    description: 'Mock OCR for testing',
    size: 0,
    isDownloaded: async () => true,
    initialize: async () => {},
    recognize: async () => ({
      lines: [
        { text: '日本語テスト', confidence: 0.95, bbox: { x: 0, y: 0, width: 200, height: 30 } },
      ],
      fullText: '日本語テスト',
    }),
    terminate: async () => {},
    clearCache: async () => {},
    ...overrides,
  }
}

function createMockTranslationModel(overrides: Partial<TranslationModel> = {}): TranslationModel {
  return {
    id: 'mock-dict',
    name: 'Mock Dictionary',
    description: 'Mock dictionary for testing',
    size: 0,
    isDownloaded: async () => true,
    initialize: async () => {},
    translate: async (text: string) => [
      { original: text, reading: '', translations: ['test'], partOfSpeech: '' },
    ],
    terminate: async () => {},
    clearCache: async () => {},
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect all pipeline phase transitions during a run. */
function collectPhases(states: PipelineState[]): PipelinePhase[] {
  return states.map((s) => s.phase)
}

/** Create a promise that never resolves (simulates a hang). */
function hang(): Promise<never> {
  return new Promise(() => {})
}

// ---------------------------------------------------------------------------
// Module mocks — swap registries so runPipeline uses our fake models
// ---------------------------------------------------------------------------

let mockOCR: OCRModel
let mockTranslation: TranslationModel

vi.mock('@/services/ocr/registry.ts', () => ({
  ocrModels: [],
  getOCRModel: () => undefined,
  getDefaultOCRModel: () => mockOCR,
}))

vi.mock('@/services/translation/registry.ts', () => ({
  translationModels: [],
  getTranslationModel: () => undefined,
  getDefaultTranslationModel: () => mockTranslation,
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pipeline timeout and error recovery', () => {
  const frame = createImageData(100, 100)

  beforeEach(() => {
    vi.useFakeTimers()
    mockOCR = createMockOCRModel()
    mockTranslation = createMockTranslationModel()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ---- Happy path ----

  it('should complete normally with working models', async () => {
    const states: PipelineState[] = []

    await runPipeline(frame, (s) => states.push(s))

    const phases = collectPhases(states)
    expect(phases).toContain('preprocessing')
    expect(phases).toContain('ocr')
    expect(phases).toContain('done')
    expect(phases).not.toContain('error')

    const final = states[states.length - 1]
    expect(final.phase).toBe('done')
    expect(final.translations).not.toBeNull()
    expect(final.translations!.length).toBeGreaterThan(0)
  })

  // ---- OCR model errors ----

  it('should transition to error when OCR initialize() throws', async () => {
    mockOCR = createMockOCRModel({
      initialize: async () => { throw new Error('WASM load failed') },
    })

    const states: PipelineState[] = []
    await runPipeline(frame, (s) => states.push(s))

    const final = states[states.length - 1]
    expect(final.phase).toBe('error')
    expect(final.error).toContain('OCR model failed to load')
    expect(final.error).toContain('WASM load failed')
  })

  it('should transition to error when OCR recognize() throws', async () => {
    mockOCR = createMockOCRModel({
      recognize: async () => { throw new Error('inference crashed') },
    })

    const states: PipelineState[] = []
    await runPipeline(frame, (s) => states.push(s))

    const final = states[states.length - 1]
    expect(final.phase).toBe('error')
    expect(final.error).toContain('Text recognition failed')
  })

  // ---- Translation model errors ----

  it('should transition to error when translation initialize() throws', async () => {
    mockTranslation = createMockTranslationModel({
      initialize: async () => { throw new Error('IndexedDB blocked') },
    })

    const states: PipelineState[] = []
    await runPipeline(frame, (s) => states.push(s))

    const final = states[states.length - 1]
    expect(final.phase).toBe('error')
    expect(final.error).toContain('Translation model failed to load')
    expect(final.error).toContain('IndexedDB blocked')
  })

  it('should still complete when individual line translation fails', async () => {
    let callCount = 0
    mockTranslation = createMockTranslationModel({
      translate: async () => {
        callCount++
        throw new Error('lookup failed')
      },
    })

    // OCR returns 2 lines spaced far apart so they won't be merged by filters
    mockOCR = createMockOCRModel({
      recognize: async () => ({
        lines: [
          { text: '東京', confidence: 0.9, bbox: { x: 0, y: 0, width: 100, height: 30 } },
          { text: '大阪', confidence: 0.9, bbox: { x: 0, y: 200, width: 100, height: 30 } },
        ],
        fullText: '東京大阪',
      }),
    })

    const states: PipelineState[] = []
    await runPipeline(frame, (s) => states.push(s))

    const final = states[states.length - 1]
    expect(final.phase).toBe('done')
    // Both lines should have empty fallback arrays, not missing
    expect(final.translations).toEqual([[], []])
    expect(callCount).toBe(2)
  })

  // ---- Phase transitions ----

  it('should progress through all expected phases in order', async () => {
    const states: PipelineState[] = []
    await runPipeline(frame, (s) => states.push(s))

    const phases = collectPhases(states)
    // Must visit these phases in this order
    const expected: PipelinePhase[] = ['preprocessing', 'ocr', 'segmenting', 'translating', 'done']
    let lastIdx = -1
    for (const phase of expected) {
      const idx = phases.indexOf(phase)
      expect(idx, `missing phase: ${phase}`).toBeGreaterThan(lastIdx)
      lastIdx = idx
    }
  })

  it('should set imageSize from the input frame', async () => {
    const states: PipelineState[] = []
    const wideFrame = createImageData(640, 480)
    await runPipeline(wideFrame, (s) => states.push(s))

    expect(states[0].imageSize).toEqual({ width: 640, height: 480 })
  })

  // ---- ocrOnly mode ----

  it('should skip translation when ocrOnly is true', async () => {
    const translateSpy = vi.fn()
    mockTranslation = createMockTranslationModel({
      initialize: translateSpy,
    })

    const states: PipelineState[] = []
    await runPipeline(frame, (s) => states.push(s), { ocrOnly: true })

    const final = states[states.length - 1]
    expect(final.phase).toBe('done')
    expect(final.translations).toEqual([])
    // Translation model should not even be initialized
    expect(translateSpy).not.toHaveBeenCalled()
  })

  // ---- Empty OCR results ----

  it('should complete with empty translations when OCR finds no text', async () => {
    mockOCR = createMockOCRModel({
      recognize: async () => ({ lines: [], fullText: '' }),
    })

    const states: PipelineState[] = []
    await runPipeline(frame, (s) => states.push(s))

    const final = states[states.length - 1]
    expect(final.phase).toBe('done')
    expect(final.translations).toEqual([])
    expect(final.ocrResult?.fullText).toBe('')
  })

  // ---- OCR results available before translation hangs ----

  it('should expose ocrResult even if translation phase errors', async () => {
    mockTranslation = createMockTranslationModel({
      initialize: async () => { throw new Error('dict broken') },
    })

    const states: PipelineState[] = []
    await runPipeline(frame, (s) => states.push(s))

    // The OCR result should have been emitted before translation failed
    const ocrStates = states.filter((s) => s.ocrResult !== null)
    expect(ocrStates.length).toBeGreaterThan(0)
    expect(ocrStates[0].ocrResult!.fullText).toBe('日本語テスト')

    // Final state should be error
    const final = states[states.length - 1]
    expect(final.phase).toBe('error')
    // OCR result should still be preserved in the error state
    expect(final.ocrResult).not.toBeNull()
  })

  // ---- Hang detection (timeout tests) ----

  it('should not hang when OCR initialize() never resolves (caught by caller timeout)', async () => {
    mockOCR = createMockOCRModel({
      initialize: () => hang(),
    })

    const states: PipelineState[] = []

    // Simulate the scan-level timeout pattern from usePipeline
    const TIMEOUT_MS = 500
    let timer: ReturnType<typeof setTimeout>
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Scan timed out')),
        TIMEOUT_MS,
      )
    })

    const pipeline = runPipeline(frame, (s) => states.push(s))

    // Advance timers to trigger the timeout
    const racePromise = Promise.race([pipeline, timeout])
      .catch((err) => {
        states.push({
          phase: 'error',
          ocrResult: null,
          translations: null,
          error: err.message,
          imageSize: null,
        })
      })
      .finally(() => clearTimeout(timer!))

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 50)
    await racePromise

    const final = states[states.length - 1]
    expect(final.phase).toBe('error')
    expect(final.error).toContain('timed out')
  })

  it('should not hang when OCR recognize() never resolves (caught by caller timeout)', async () => {
    mockOCR = createMockOCRModel({
      recognize: () => hang(),
    })

    const states: PipelineState[] = []

    const TIMEOUT_MS = 500
    let timer: ReturnType<typeof setTimeout>
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Scan timed out')),
        TIMEOUT_MS,
      )
    })

    const pipeline = runPipeline(frame, (s) => states.push(s))
    const racePromise = Promise.race([pipeline, timeout])
      .catch((err) => {
        states.push({
          phase: 'error',
          ocrResult: null,
          translations: null,
          error: err.message,
          imageSize: null,
        })
      })
      .finally(() => clearTimeout(timer!))

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 50)
    await racePromise

    const final = states[states.length - 1]
    expect(final.phase).toBe('error')
    expect(final.error).toContain('timed out')
  })

  it('should not hang when translation initialize() never resolves (caught by caller timeout)', async () => {
    mockTranslation = createMockTranslationModel({
      initialize: () => hang(),
    })

    const states: PipelineState[] = []

    const TIMEOUT_MS = 500
    let timer: ReturnType<typeof setTimeout>
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Scan timed out')),
        TIMEOUT_MS,
      )
    })

    const pipeline = runPipeline(frame, (s) => states.push(s))
    const racePromise = Promise.race([pipeline, timeout])
      .catch((err) => {
        states.push({
          phase: 'error',
          ocrResult: null,
          translations: null,
          error: err.message,
          imageSize: null,
        })
      })
      .finally(() => clearTimeout(timer!))

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 50)
    await racePromise

    // OCR phase should have completed before the hang
    const ocrDone = states.some((s) => s.ocrResult !== null)
    expect(ocrDone).toBe(true)

    const final = states[states.length - 1]
    expect(final.phase).toBe('error')
    expect(final.error).toContain('timed out')
  })

  // ---- runningRef guard (via usePipeline pattern) ----

  it('should reset running state after pipeline error so subsequent scans work', async () => {
    // Simulate the usePipeline pattern with runningRef
    let running = false

    async function scanOnce(ocrModel: OCRModel) {
      if (running) return 'blocked'
      running = true
      const states: PipelineState[] = []
      try {
        mockOCR = ocrModel
        await runPipeline(frame, (s) => states.push(s))
      } catch {
        // handled
      } finally {
        running = false
      }
      return states[states.length - 1].phase
    }

    // First scan: fails
    const result1 = await scanOnce(createMockOCRModel({
      initialize: async () => { throw new Error('fail') },
    }))
    expect(result1).toBe('error')
    expect(running).toBe(false)

    // Second scan: should NOT be blocked, and should succeed
    const result2 = await scanOnce(createMockOCRModel())
    expect(result2).toBe('done')
  })
})
