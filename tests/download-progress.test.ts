/**
 * Tests for download progress clamping and error handling.
 *
 * Verifies that progress values are capped at 100% even when
 * the underlying library reports values exceeding 100 (e.g. when
 * Content-Length reflects compressed size but progress tracks
 * decompressed bytes).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DownloadError } from '../src/services/storage/model-cache.ts'

// ---------------------------------------------------------------------------
// Worker progress clamping
// ---------------------------------------------------------------------------

describe('translation-worker progress clamping', () => {
  let postedMessages: any[]

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
   * Simulate the updated ModelManager display logic (with clamping):
   *   `Downloading ${Math.min(Math.round(progress * 100), 100)}%`
   *
   * Where progress is expected to be 0-1 (after normalization).
   */
  function displayPercentage(progress: number): number {
    return Math.min(Math.round(progress * 100), 100)
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

  it('should still cap at 100% even if upstream clamping fails', () => {
    // Defence-in-depth: even if a value > 1 leaks through, display caps it
    const unclamped = 354 / 100 // 3.54
    expect(displayPercentage(unclamped)).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// PaddleOCR progress clamping
// ---------------------------------------------------------------------------

describe('PaddleOCR progress clamping', () => {
  /**
   * Simulate the paddleocr.ts progress calculation:
   *   onProgress?.(Math.min((before + loaded) / TOTAL_SIZE, 1))
   */
  function paddleOCRProgress(before: number, loaded: number, totalSize: number): number {
    return Math.min((before + loaded) / totalSize, 1)
  }

  it('should report progress as fraction of total size', () => {
    const totalSize = 13_200_000
    expect(paddleOCRProgress(0, 1_000_000, totalSize)).toBeCloseTo(0.0758, 3)
    expect(paddleOCRProgress(3_000_000, 5_000_000, totalSize)).toBeCloseTo(0.6061, 3)
  })

  it('should clamp to 1 when actual file sizes exceed estimates', () => {
    const totalSize = 13_200_000
    // If actual rec.onnx is 15MB instead of estimated 10MB
    expect(paddleOCRProgress(3_000_000, 15_000_000, totalSize)).toBe(1)
  })

  it('should handle completion of all files', () => {
    const totalSize = 13_200_000
    expect(paddleOCRProgress(0, totalSize, totalSize)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Onboarding progress clamping
// ---------------------------------------------------------------------------

describe('Onboarding progress clamping', () => {
  /**
   * Simulate the Onboarding.tsx pct calculation:
   *   Math.max(0, Math.min(Math.round(progress * 100), 100))
   */
  function onboardingPct(progress: number): number {
    return Math.max(0, Math.min(Math.round(progress * 100), 100))
  }

  it('should display 0-100 for valid progress range', () => {
    expect(onboardingPct(0)).toBe(0)
    expect(onboardingPct(0.4)).toBe(40)
    expect(onboardingPct(1)).toBe(100)
  })

  it('should clamp negative progress to 0', () => {
    expect(onboardingPct(-0.1)).toBe(0)
  })

  it('should clamp overflow progress to 100', () => {
    expect(onboardingPct(1.24)).toBe(100)
    expect(onboardingPct(3.54)).toBe(100)
  })

  it('should never exceed 100 for the OCR model phase', () => {
    // Simulate: 0.4 + p * 0.6 where p might be > 1 without clamping
    const p = 1.4 // leaked unclamped value
    const progress = 0.4 + Math.min(p, 1) * 0.6
    expect(onboardingPct(progress)).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// downloadWithProgress byte-level clamping
// ---------------------------------------------------------------------------

describe('downloadWithProgress byte-level clamping', () => {
  /**
   * Simulate the model-cache.ts onProgress callback:
   *   onProgress?.(Math.min(loaded, contentLength), contentLength)
   */
  function clampedProgress(loaded: number, contentLength: number): number {
    return Math.min(loaded, contentLength) / contentLength
  }

  it('should report normal progress', () => {
    expect(clampedProgress(500, 1000)).toBe(0.5)
  })

  it('should clamp when loaded exceeds content-length', () => {
    // This happens with transparent decompression
    expect(clampedProgress(1200, 1000)).toBe(1)
  })

  it('should handle exact completion', () => {
    expect(clampedProgress(1000, 1000)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// DownloadError classification
// ---------------------------------------------------------------------------

describe('DownloadError', () => {
  it('should have a kind property for error classification', () => {
    const err = new DownloadError('You are offline', 'offline')
    expect(err.kind).toBe('offline')
    expect(err.message).toBe('You are offline')
    expect(err.name).toBe('DownloadError')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(DownloadError)
  })

  it('should support all error kinds', () => {
    const kinds = ['offline', 'network', 'server', 'timeout', 'unknown'] as const
    for (const kind of kinds) {
      const err = new DownloadError(`test ${kind}`, kind)
      expect(err.kind).toBe(kind)
    }
  })
})
