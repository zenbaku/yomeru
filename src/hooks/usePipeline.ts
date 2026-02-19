import { useState, useCallback, useRef } from 'react'
import { runPipeline, INITIAL_STATE, type PipelineState } from '../services/pipeline.ts'

export function usePipeline() {
  const [state, setState] = useState<PipelineState>(INITIAL_STATE)
  const runningRef = useRef(false)

  const scan = useCallback(async (frame: ImageData) => {
    if (runningRef.current) return
    runningRef.current = true

    // Clear previous results immediately
    setState({ ...INITIAL_STATE, phase: 'preprocessing', imageSize: { width: frame.width, height: frame.height } })

    await runPipeline(frame, (newState) => {
      setState(newState)
    })

    runningRef.current = false
  }, [])

  const reset = useCallback(() => {
    setState(INITIAL_STATE)
  }, [])

  return { ...state, scan, reset, scanning: state.phase !== 'idle' && state.phase !== 'done' && state.phase !== 'error' }
}
