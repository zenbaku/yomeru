import { useState, useCallback, useRef, useEffect } from 'react'
import { runPipeline, INITIAL_STATE, type PipelineState, type PipelineOptions } from '../services/pipeline.ts'
import { getDefaultOCRModel } from '../services/ocr/registry.ts'
import { terminatePhraseModel } from '../services/translation/phrase.ts'

/** Release WASM models after this many ms of inactivity to free memory. */
const IDLE_TIMEOUT_MS = 2 * 60 * 1000 // 2 minutes

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
        await terminatePhraseModel()
      }
    }, IDLE_TIMEOUT_MS)
  }

  // Clear timer on unmount
  useEffect(() => {
    return () => {
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

    await runPipeline(frame, (newState) => {
      setState(newState)
    }, options)

    runningRef.current = false

    // Start idle timer after scan completes
    resetIdleTimer()
  }, [])

  const reset = useCallback(() => {
    setState(INITIAL_STATE)
  }, [])

  return { ...state, scan, reset, ocrOnly, setOcrOnly, scanning: state.phase !== 'idle' && state.phase !== 'done' && state.phase !== 'error' }
}
