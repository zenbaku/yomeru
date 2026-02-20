import type { NeuralModelInfo } from './types.ts'

const MODEL_NAME = 'nllb-200-distilled-600M'

/** Check whether NLLB-200 model files are cached in the browser. */
export async function isNLLBDownloaded(): Promise<boolean> {
  try {
    const cache = await caches.open('transformers-cache')
    const keys = await cache.keys()
    return keys.some((req) => req.url.includes(MODEL_NAME))
  } catch {
    return false
  }
}

/**
 * Download and initialize the NLLB-200 model via a temporary web worker.
 * The worker handles the heavy Transformers.js download and WASM setup
 * without blocking the main thread.
 */
export function initializeNLLBModel(
  onProgress?: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('../../workers/translation-worker.ts', import.meta.url),
      { type: 'module' },
    )

    worker.onmessage = (event) => {
      const { type, payload } = event.data
      switch (type) {
        case 'loading':
          onProgress?.(Math.min(payload.progress / 100, 1))
          break
        case 'ready':
          worker.terminate()
          resolve()
          break
        case 'error':
          worker.terminate()
          reject(new Error(payload.message))
          break
      }
    }

    worker.onerror = (err) => {
      worker.terminate()
      reject(new Error(err.message || 'Worker error'))
    }

    worker.postMessage({
      type: 'init',
      payload: {
        config: {
          hfModelId: 'Xenova/nllb-200-distilled-600M',
          dtype: 'q8',
          device: 'wasm',
          translateOptions: { src_lang: 'jpn_Jpan', tgt_lang: 'eng_Latn', max_length: 200 },
          cacheKey: 'nllb-200-distilled-600M',
        },
      },
    })
  })
}

/** Delete all cached NLLB-200 model data from the browser. */
export async function clearNLLBCache(): Promise<void> {
  try {
    // Transformers.js stores files in transformers-cache and possibly hf-models
    const cacheNames = ['transformers-cache', 'hf-models']
    for (const name of cacheNames) {
      const cache = await caches.open(name)
      const keys = await cache.keys()
      for (const req of keys) {
        if (req.url.includes(MODEL_NAME)) {
          await cache.delete(req)
        }
      }
    }
  } catch {
    // Cache API may not be available
  }
}

/** NLLB-200 model info for the Models page. */
export const nllbNeuralModel: NeuralModelInfo = {
  id: 'nllb-200-distilled-600M',
  name: 'NLLB-200',
  description: 'Natural sentence-level translation by Meta, 200 languages. Works fully offline after download (~350 MB)',
  size: 350_000_000,
  isDownloaded: isNLLBDownloaded,
  initialize: initializeNLLBModel,
  clearCache: clearNLLBCache,
  workerConfig: {
    hfModelId: 'Xenova/nllb-200-distilled-600M',
    dtype: 'q8',
    device: 'wasm',
    translateOptions: { src_lang: 'jpn_Jpan', tgt_lang: 'eng_Latn', max_length: 200 },
    cacheKey: 'nllb-200-distilled-600M',
  },
}
