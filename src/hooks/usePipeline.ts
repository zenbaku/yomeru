import { useState, useCallback, useRef, useEffect } from 'react'
import { runPipeline, INITIAL_STATE, type PipelineState, type PipelineOptions } from '../services/pipeline.ts'
import { getDefaultOCRModel } from '../services/ocr/registry.ts'

/** Maximum time a scan can run before we force-abort with an error. */
const SCAN_TIMEOUT_MS = 90_000 // 90 seconds

export function usePipeline() {
  const [state, setState] = useState<PipelineState>(INITIAL_STATE)
  const [ocrOnly, setOcrOnly] = useState(false)
  const runningRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  // Release WASM models when the app is backgrounded to prevent OOM kills.
  //
  // IMPORTANT: We intentionally do NOT terminate on an idle timer.
  // The @gutenye/ocr-browser library hides its ONNX InferenceSession
  // objects behind #private fields, so we cannot call session.release().
  // Without release(), the ONNX thread pool workers (SharedArrayBuffer)
  // are orphaned on every terminate() call, permanently leaking 30-60 MB
  // of WASM memory that the GC can never reclaim.  Repeated idle-timer
  // termination therefore causes unbounded memory growth and eventual OOM.
  //
  // Keeping the model alive uses a fixed ~30-60 MB while the app is
  // foregrounded — stable and predictable.  We only terminate when the
  // app is backgrounded (where the OS may reclaim the process anyway)
  // or on unmount.
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.hidden && !runningRef.current) {
        getDefaultOCRModel().terminate().catch(() => {})
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      // Release OCR model on unmount
      getDefaultOCRModel().terminate().catch(() => {})
    }
  }, [])

  const scan = useCallback(async (frame: ImageData, options?: PipelineOptions) => {
    if (runningRef.current) return
    runningRef.current = true

    // Clear previous results immediately
    setState({ ...INITIAL_STATE, phase: 'preprocessing', imageSize: { width: frame.width, height: frame.height } })

    // AbortController lets us actually stop in-flight pipeline work on timeout,
    // rather than just ignoring the result while it continues consuming CPU/memory.
    const abort = new AbortController()
    abortRef.current = abort
    const timer = setTimeout(() => abort.abort(), SCAN_TIMEOUT_MS)

    try {
      await runPipeline(frame, (newState) => {
        setState(newState)
      }, { ...options, signal: abort.signal })

      if (abort.signal.aborted) {
        throw new Error('Scan timed out. Try reloading the page and scanning again.')
      }
    } catch (err) {
      console.error('Pipeline failed unexpectedly:', err)
      setState((prev) => ({
        ...prev,
        phase: 'error',
        error: err instanceof Error ? err.message : 'Unexpected error during scan',
      }))
    } finally {
      clearTimeout(timer)
      abortRef.current = null
      runningRef.current = false
    }
  }, [])

  const reset = useCallback(() => {
    setState(INITIAL_STATE)
  }, [])

  return { ...state, scan, reset, ocrOnly, setOcrOnly, scanning: state.phase !== 'idle' && state.phase !== 'done' && state.phase !== 'error' }
}
