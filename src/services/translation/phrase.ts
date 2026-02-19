import type { TranslationPipeline } from '@huggingface/transformers'
import type { ModelInfo } from './types.ts'

const MODEL_ID = 'Xenova/opus-mt-ja-en'
/** Opus-MT typically supports up to ~512 tokens; cap input chars to stay safe. */
const MAX_INPUT_LENGTH = 300

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
  })().catch((err) => {
    // Reset so the next call can retry instead of returning a rejected promise forever
    initPromise = null
    translator = null
    throw err
  })

  return initPromise
}

/**
 * Translate a single phrase/sentence to English using the local Opus-MT model.
 * Returns null if the model isn't ready or translation fails.
 */
export async function translatePhrase(text: string): Promise<string | null> {
  const trimmed = text.trim()
  if (!trimmed) return null

  // Ensure model is loaded (no-op if already initialized)
  await initializePhraseModel()

  if (!translator) return null

  try {
    // Truncate to avoid WASM heap overflow on long text
    const input = trimmed.length > MAX_INPUT_LENGTH
      ? trimmed.slice(0, MAX_INPUT_LENGTH)
      : trimmed

    const output = await translator(input)
    const result = Array.isArray(output) ? output[0] : output
    const translated = result && typeof result === 'object'
      ? (result as { translation_text?: string }).translation_text
      : undefined
    if (!translated || translated === input) return null
    return translated
  } catch {
    return null
  }
}

/**
 * Translate multiple OCR lines in sequence.
 * Returns an array of translations (null entries filtered out), or null if none succeeded.
 */
export async function translatePhrases(lines: string[]): Promise<string[] | null> {
  if (lines.length === 0) return null

  try {
    // Ensure model is loaded once before processing all lines
    await initializePhraseModel()
    if (!translator) return null

    const results: string[] = []
    for (const line of lines) {
      const t = await translatePhrase(line)
      if (t) results.push(t)
    }
    return results.length > 0 ? results : null
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

/**
 * Delete all cached phrase model data from the browser.
 */
export async function clearPhraseModelCache(): Promise<void> {
  await terminatePhraseModel()
  try {
    await caches.delete('transformers-cache')
    await caches.delete('hf-models')
  } catch {
    // Cache API may not be available
  }
}

/** Phrase translation model info for the Models page. */
export const phraseModelInfo: ModelInfo = {
  id: 'opus-mt-ja-en',
  name: 'Opus-MT Ja→En',
  description: 'Neural machine translation for full phrases and sentences (~50 MB)',
  size: 50_000_000,
  isDownloaded: isPhraseModelDownloaded,
  initialize: initializePhraseModel,
  clearCache: clearPhraseModelCache,
}
