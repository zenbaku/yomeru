import { useState, useEffect, useRef, useCallback } from 'react'
import { getNeuralModel, getSelectedNeuralModel } from '../services/translation/neural-registry.ts'
import type { NeuralModelInfo } from '../services/translation/types.ts'

export interface NeuralTranslatorState {
  isModelDownloaded: boolean
  isModelLoaded: boolean
  isModelLoading: boolean
  downloadProgress: number // 0-100
  isTranslating: boolean
}

type PartialCallback = (index: number, translation: string) => void
type DoneCallback = () => void

function resolveModel(modelId?: string): NeuralModelInfo {
  if (modelId) return getNeuralModel(modelId) ?? getSelectedNeuralModel()
  return getSelectedNeuralModel()
}

export function useNeuralTranslator(modelId?: string) {
  const modelRef = useRef<NeuralModelInfo>(resolveModel(modelId))
  const workerRef = useRef<Worker | null>(null)
  const onPartialRef = useRef<PartialCallback | null>(null)
  const onDoneRef = useRef<DoneCallback | null>(null)
  const pendingRef = useRef<{
    lines: { index: number; japanese: string }[]
    onPartial?: PartialCallback
    onDone?: DoneCallback
  } | null>(null)

  const [state, setState] = useState<NeuralTranslatorState>({
    isModelDownloaded: false,
    isModelLoaded: false,
    isModelLoading: false,
    downloadProgress: 0,
    isTranslating: false,
  })

  // When modelId changes, resolve new model, terminate old worker, reset state
  useEffect(() => {
    const model = resolveModel(modelId)
    const prev = modelRef.current

    if (model.id !== prev.id) {
      if (workerRef.current) {
        workerRef.current.terminate()
        workerRef.current = null
      }
      pendingRef.current = null
      onPartialRef.current = null
      onDoneRef.current = null
      setState({
        isModelDownloaded: false,
        isModelLoaded: false,
        isModelLoading: false,
        downloadProgress: 0,
        isTranslating: false,
      })
      modelRef.current = model
    }

    checkDownloaded(model)
  }, [modelId])

  // Check on mount
  useEffect(() => {
    checkDownloaded(modelRef.current)
  }, [])

  async function checkDownloaded(model?: NeuralModelInfo) {
    const m = model ?? modelRef.current
    try {
      const cache = await caches.open('transformers-cache')
      const keys = await cache.keys()
      const found = keys.some((req) => req.url.includes(m.workerConfig.cacheKey))
      setState((s) => ({ ...s, isModelDownloaded: found }))
    } catch {
      // Cache API unavailable
    }
  }

  function getOrCreateWorker(): Worker {
    if (!workerRef.current) {
      const worker = new Worker(
        new URL('../workers/translation-worker.ts', import.meta.url),
        { type: 'module' },
      )

      worker.onmessage = (event) => {
        const { type, payload } = event.data

        switch (type) {
          case 'loading':
            setState((s) => ({
              ...s,
              isModelLoading: true,
              downloadProgress: payload.progress ?? 0,
            }))
            break

          case 'ready':
            setState((s) => ({
              ...s,
              isModelLoaded: true,
              isModelLoading: false,
              isModelDownloaded: true,
              downloadProgress: 100,
            }))
            // If there's a pending translation, send it now
            if (pendingRef.current) {
              const { lines, onPartial, onDone } = pendingRef.current
              pendingRef.current = null
              onPartialRef.current = onPartial ?? null
              onDoneRef.current = onDone ?? null
              setState((s) => ({ ...s, isTranslating: true }))
              workerRef.current?.postMessage({
                type: 'translate',
                payload: { lines },
                id: crypto.randomUUID(),
              })
            }
            break

          case 'error':
            setState((s) => ({
              ...s,
              isModelLoading: false,
            }))
            pendingRef.current = null
            break

          case 'translate-partial':
            onPartialRef.current?.(payload.index, payload.translation)
            break

          case 'translate-done':
            onDoneRef.current?.()
            setState((s) => ({ ...s, isTranslating: false }))
            onPartialRef.current = null
            onDoneRef.current = null
            break

          case 'translate-result':
            if (payload?.error) {
              setState((s) => ({ ...s, isTranslating: false }))
              onPartialRef.current = null
              onDoneRef.current = null
            }
            break
        }
      }

      workerRef.current = worker
    }
    return workerRef.current
  }

  /** Start downloading and initializing the model */
  const downloadModel = useCallback(() => {
    const worker = getOrCreateWorker()
    worker.postMessage({
      type: 'init',
      payload: { config: modelRef.current.workerConfig },
    })
  }, [])

  /**
   * Translate OCR lines with the selected neural model.
   * If model is loaded, sends immediately.
   * If model is downloaded but not loaded, queues request and starts loading.
   * If model is not downloaded, does nothing.
   */
  const translateLines = useCallback(
    (
      lines: { index: number; japanese: string }[],
      onPartial?: PartialCallback,
      onDone?: DoneCallback,
    ) => {
      if (state.isModelLoaded) {
        onPartialRef.current = onPartial ?? null
        onDoneRef.current = onDone ?? null
        setState((s) => ({ ...s, isTranslating: true }))
        getOrCreateWorker().postMessage({
          type: 'translate',
          payload: { lines },
          id: crypto.randomUUID(),
        })
      } else if (state.isModelDownloaded && !state.isModelLoading) {
        // Queue the request and init the model
        pendingRef.current = { lines, onPartial, onDone }
        setState((s) => ({ ...s, isModelLoading: true }))
        getOrCreateWorker().postMessage({
          type: 'init',
          payload: { config: modelRef.current.workerConfig },
        })
      }
      // If not downloaded, do nothing — dictionary-only mode
    },
    [state.isModelLoaded, state.isModelDownloaded, state.isModelLoading],
  )

  /** Terminate the worker to free memory */
  const terminate = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate()
      workerRef.current = null
    }
    setState((s) => ({
      ...s,
      isModelLoaded: false,
      isModelLoading: false,
      isTranslating: false,
    }))
  }, [])

  // Terminate worker when the app is backgrounded to free WASM memory.
  // The neural translation model can consume 40-100MB; keeping it alive
  // while the tab is hidden is a primary cause of OOM kills on mobile.
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.hidden && workerRef.current && !state.isTranslating) {
        workerRef.current.terminate()
        workerRef.current = null
        setState((s) => ({
          ...s,
          isModelLoaded: false,
          isModelLoading: false,
        }))
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      workerRef.current?.terminate()
    }
  }, [state.isTranslating])

  return {
    ...state,
    downloadModel,
    translateLines,
    terminate,
    recheckDownloaded: () => checkDownloaded(),
  }
}
