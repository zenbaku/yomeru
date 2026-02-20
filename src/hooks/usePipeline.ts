import { useState, useCallback, useRef, useEffect } from 'react'
import { runPipeline, INITIAL_STATE, type PipelineState, type PipelineOptions } from '../services/pipeline.ts'
import { getDefaultOCRModel } from '../services/ocr/registry.ts'

/**
 * Release WASM models after this many ms of inactivity to free memory.
 * Shortened from 2 minutes: ONNX WASM + model weights can consume 30-60MB,
 * which combined with the live camera stream causes OOM on mobile devices.
 */
const IDLE_TIMEOUT_MS = 45_000 // 45 seconds

/** Maximum time a scan can run before we force-abort with an error. */
const SCAN_TIMEOUT_MS = 90_000 // 90 seconds

export function usePipeline() {
  const [state, setState] = useState<PipelineState>(INITIAL_STATE)
  const [ocrOnly, setOcrOnly] = useState(false)
  const runningRef = useRef(false)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function resetIdleTimer() {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(async () => {
      // Only terminate if not currently running a scan
      if (!runningRef.current) {
        await getDefaultOCRModel().terminate()
      }
    }, IDLE_TIMEOUT_MS)
  }

  // Release WASM models immediately when the app is backgrounded.
  // On mobile, the OS will kill the tab if it uses too much memory while hidden.
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.hidden && !runningRef.current) {
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
        getDefaultOCRModel().terminate()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    }
  }, [])

  const scan = useCallback(async (frame: ImageData, options?: PipelineOptions) => {
    if (runningRef.current) return
    runningRef.current = true

    // Cancel pending idle cleanup — we're actively using the models
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)

    // Clear previous results immediately
    setState({ ...INITIAL_STATE, phase: 'preprocessing', imageSize: { width: frame.width, height: frame.height } })

    try {
      // Race the pipeline against a timeout so we never leave the UI stuck
      let timer: ReturnType<typeof setTimeout>
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Scan timed out. Try reloading the page and scanning again.')),
          SCAN_TIMEOUT_MS,
        )
      })

      await Promise.race([
        runPipeline(frame, (newState) => {
          setState(newState)
        }, options),
        timeout,
      ]).finally(() => clearTimeout(timer!))
    } catch (err) {
      console.error('Pipeline failed unexpectedly:', err)
      setState((prev) => ({
        ...prev,
        phase: 'error',
        error: err instanceof Error ? err.message : 'Unexpected error during scan',
      }))
    } finally {
      runningRef.current = false
      // Start idle timer after scan completes
      resetIdleTimer()
    }
  }, [])

  const reset = useCallback(() => {
    setState(INITIAL_STATE)
  }, [])

  return { ...state, scan, reset, ocrOnly, setOcrOnly, scanning: state.phase !== 'idle' && state.phase !== 'done' && state.phase !== 'error' }
}
