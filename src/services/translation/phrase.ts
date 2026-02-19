import type { TranslationPipeline } from '@huggingface/transformers'

const MODEL_ID = 'Xenova/opus-mt-ja-en'

let translator: TranslationPipeline | null = null
let initPromise: Promise<void> | null = null

/**
 * Check whether the translation model files are already cached in the browser.
 */
export async function isPhraseModelDownloaded(): Promise<boolean> {
  try {
    const cache = await caches.open('transformers-cache')
    const keys = await cache.keys()
    // The model stores multiple files; if we have any from this model it's at least partially cached.
    // Check for the ONNX model file specifically.
    return keys.some((req) => req.url.includes('opus-mt-ja-en'))
  } catch {
    return false
  }
}

/**
 * Pre-download and initialize the phrase translation model.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export async function initializePhraseModel(
  onProgress?: (progress: number) => void,
): Promise<void> {
  if (translator) return
  if (initPromise) return initPromise

  initPromise = (async () => {
    // Dynamic import to avoid TS2590 (union type too complex) with static `pipeline`
    const { pipeline } = await import('@huggingface/transformers')
    translator = await (pipeline as Function)('translation', MODEL_ID, {
      dtype: 'q8',
      progress_callback: (info: { status: string; progress?: number }) => {
        if (info.status === 'progress' && info.progress != null) {
          onProgress?.(info.progress / 100)
        }
      },
    }) as TranslationPipeline
  })()

  return initPromise
}

/**
 * Translate a full Japanese phrase/sentence to English using the local Opus-MT model.
 * Returns null if the model hasn't been initialized yet.
 */
export async function translatePhrase(text: string): Promise<string | null> {
  if (!text.trim()) return null

  // Ensure model is loaded (no-op if already initialized)
  await initializePhraseModel()

  if (!translator) return null

  try {
    const output = await translator(text)
    const result = Array.isArray(output) ? output[0] : output
    const translated = (result as { translation_text: string }).translation_text
    if (!translated || translated === text) return null
    return translated
  } catch {
    return null
  }
}

/**
 * Release model resources.
 */
export async function terminatePhraseModel(): Promise<void> {
  if (translator) {
    await translator.dispose()
    translator = null
    initPromise = null
  }
}
