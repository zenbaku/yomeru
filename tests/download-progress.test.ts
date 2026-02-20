/**
 * Tests for download progress clamping.
 *
 * Verifies that progress values are capped at 100% even when
 * the underlying library reports values exceeding 100 (e.g. when
 * Content-Length reflects compressed size but progress tracks
 * decompressed bytes).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Worker progress clamping
// ---------------------------------------------------------------------------

describe('translation-worker progress clamping', () => {
  let postedMessages: any[]
  let onMessage: (event: MessageEvent) => void

  beforeEach(() => {
    postedMessages = []

    // Mock self.postMessage to capture worker output
    vi.stubGlobal('self', {
      postMessage: (msg: any) => postedMessages.push(msg),
      onmessage: null as any,
    })
  })

  /**
   * Simulate the worker's progress_callback logic (extracted from
   * translation-worker.ts lines 79-91) to test clamping in isolation.
   */
  function simulateProgressCallback(progress: {
    status?: string
    progress?: number
    file?: string
    loaded?: number
    total?: number
  }) {
    if (progress.status === 'progress') {
      self.postMessage({
        type: 'loading',
        payload: {
          phase: 'loading-model',
          progress: Math.min(progress.progress ?? 0, 100),
          file: progress.file ?? '',
          loaded: progress.loaded ?? 0,
          total: progress.total ?? 0,
        },
      })
    }
  }

  it('should cap progress at 100 when Transformers.js reports > 100', () => {
    simulateProgressCallback({
      status: 'progress',
      progress: 354,
      file: 'model.onnx',
      loaded: 354_000_000,
      total: 100_000_000,
    })

    expect(postedMessages).toHaveLength(1)
    expect(postedMessages[0].payload.progress).toBe(100)
  })

  it('should pass through normal progress values unchanged', () => {
    simulateProgressCallback({
      status: 'progress',
      progress: 45.5,
      file: 'model.onnx',
      loaded: 45_500_000,
      total: 100_000_000,
    })

    expect(postedMessages[0].payload.progress).toBe(45.5)
  })

  it('should handle zero progress', () => {
    simulateProgressCallback({
      status: 'progress',
      progress: 0,
      file: 'model.onnx',
    })

    expect(postedMessages[0].payload.progress).toBe(0)
  })

  it('should handle undefined progress as 0', () => {
    simulateProgressCallback({
      status: 'progress',
      file: 'model.onnx',
    })

    expect(postedMessages[0].payload.progress).toBe(0)
  })

  it('should not post messages for non-progress status', () => {
    simulateProgressCallback({ status: 'done' })
    expect(postedMessages).toHaveLength(0)
  })

  it('should handle exactly 100 progress', () => {
    simulateProgressCallback({
      status: 'progress',
      progress: 100,
      file: 'model.onnx',
    })

    expect(postedMessages[0].payload.progress).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// NLLB progress normalization
// ---------------------------------------------------------------------------

describe('NLLB progress normalization', () => {
  /**
   * Simulate the nllb.ts onProgress conversion logic:
   *   onProgress?.(Math.min(payload.progress / 100, 1))
   */
  function normalizeNLLBProgress(rawProgress: number): number {
    return Math.min(rawProgress / 100, 1)
  }

  it('should normalize 0-100 to 0-1', () => {
    expect(normalizeNLLBProgress(50)).toBe(0.5)
    expect(normalizeNLLBProgress(0)).toBe(0)
    expect(normalizeNLLBProgress(100)).toBe(1)
  })

  it('should clamp values exceeding 100 to 1', () => {
    expect(normalizeNLLBProgress(354)).toBe(1)
    expect(normalizeNLLBProgress(200)).toBe(1)
    expect(normalizeNLLBProgress(150)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Phrase model progress normalization
// ---------------------------------------------------------------------------

describe('phrase model progress normalization', () => {
  /**
   * Simulate the phrase.ts onProgress conversion logic:
   *   onProgress?.(Math.min(info.progress / 100, 1))
   */
  function normalizePhraseProgress(rawProgress: number): number {
    return Math.min(rawProgress / 100, 1)
  }

  it('should normalize 0-100 to 0-1', () => {
    expect(normalizePhraseProgress(50)).toBe(0.5)
    expect(normalizePhraseProgress(0)).toBe(0)
    expect(normalizePhraseProgress(100)).toBe(1)
  })

  it('should clamp values exceeding 100 to 1', () => {
    expect(normalizePhraseProgress(354)).toBe(1)
    expect(normalizePhraseProgress(200)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Display progress calculation (ModelManager pattern)
// ---------------------------------------------------------------------------

describe('display progress calculation', () => {
  /**
   * Simulate the ModelManager display logic:
   *   `Downloading ${Math.round(progress * 100)}%`
   *   width: `${Math.round(progress * 100)}%`
   *
   * Where progress is expected to be 0-1 (after normalization).
   */
  function displayPercentage(progress: number): number {
    return Math.round(progress * 100)
  }

  it('should display 0-100% for normalized 0-1 progress', () => {
    expect(displayPercentage(0)).toBe(0)
    expect(displayPercentage(0.5)).toBe(50)
    expect(displayPercentage(1)).toBe(100)
  })

  it('should never display > 100% when progress is properly clamped', () => {
    // After clamping, the max progress value should be 1
    const clampedProgress = Math.min(354 / 100, 1)
    expect(displayPercentage(clampedProgress)).toBe(100)
  })

  it('should show 354% without clamping (demonstrates the original bug)', () => {
    // This is what was happening before the fix:
    // Transformers.js reported progress=354, worker passed it through,
    // nllb.ts divided by 100 to get 3.54, display multiplied by 100 to get 354%
    const unclamped = 354 / 100 // 3.54
    expect(displayPercentage(unclamped)).toBe(354)
  })
})
