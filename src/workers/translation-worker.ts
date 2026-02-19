// eslint-disable-next-line @typescript-eslint/no-explicit-any
let translator: any = null
let isLoading = false
let isReady = false

interface NeuralModelConfig {
  hfModelId: string
  dtype: string
  device: string
  translateOptions: Record<string, unknown>
  cacheKey: string
}

let activeConfig: NeuralModelConfig | null = null

interface TranslateLine {
  index: number
  japanese: string
}

interface WorkerMessage {
  type: 'init' | 'translate' | 'status'
  payload?: { lines?: TranslateLine[]; config?: NeuralModelConfig }
  id?: string
}

// Start loading the transformers library eagerly at worker creation time,
// so the import overlaps with whatever the main thread does before sending 'init'.
// (Dynamic import to avoid TS2590 — union type too complex with static `pipeline`)
const transformersReady = import('@huggingface/transformers')

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { type, payload, id } = event.data

  switch (type) {
    case 'init':
      await initModel(payload?.config)
      break

    case 'translate':
      if (payload?.lines && id) {
        await translateText(payload.lines, id)
      }
      break

    case 'status':
      self.postMessage({ type: 'status', payload: { isReady, isLoading } })
      break
  }
}

async function initModel(config?: NeuralModelConfig) {
  if (isReady || isLoading) return
  if (!config) {
    self.postMessage({ type: 'error', payload: { message: 'No model config provided' } })
    return
  }

  isLoading = true
  activeConfig = config

  try {
    const t0 = performance.now()
    self.postMessage({ type: 'loading', payload: { phase: 'importing', progress: 0 } })

    const { pipeline, env } = await transformersReady
    const tImport = performance.now()

    // Configure for offline-first browser use
    env.useBrowserCache = true
    env.allowRemoteModels = true
    env.allowLocalModels = false // skip filesystem checks (N/A in browser)

    self.postMessage({ type: 'loading', payload: { phase: 'loading-model', progress: 0 } })

    translator = await (pipeline as Function)('translation', config.hfModelId, {
      dtype: config.dtype,
      device: config.device,
      progress_callback: (progress: { status?: string; progress?: number; file?: string; loaded?: number; total?: number }) => {
        if (progress.status === 'progress') {
          self.postMessage({
            type: 'loading',
            payload: {
              phase: 'loading-model',
              progress: progress.progress ?? 0,
              file: progress.file ?? '',
              loaded: progress.loaded ?? 0,
              total: progress.total ?? 0,
            },
          })
        }
      },
    })

    const tReady = performance.now()
    console.log(
      `[translation-worker] init ${config.hfModelId}: import=${(tImport - t0).toFixed(0)}ms, pipeline=${(tReady - tImport).toFixed(0)}ms, total=${(tReady - t0).toFixed(0)}ms`,
    )

    isReady = true
    isLoading = false
    self.postMessage({ type: 'ready' })
  } catch (error) {
    isLoading = false
    self.postMessage({ type: 'error', payload: { message: String(error) } })
  }
}

async function translateText(lines: TranslateLine[], requestId: string) {
  if (!isReady || !translator || !activeConfig) {
    self.postMessage({
      type: 'translate-result',
      id: requestId,
      payload: { error: 'Model not loaded' },
    })
    return
  }

  try {
    // Filter lines worth translating (single characters are better handled by dictionary)
    const validLines = lines.filter((l) => l.japanese.trim().length >= 2)

    if (validLines.length === 0) {
      self.postMessage({ type: 'translate-done', id: requestId })
      return
    }

    const texts = validLines.map((l) => l.japanese.trim())

    // Batch translate all lines in one ONNX inference call
    const outputs = await translator(texts, {
      ...activeConfig.translateOptions,
    })

    // Post results (maintaining translate-partial protocol for UI compatibility)
    for (let i = 0; i < validLines.length; i++) {
      // Handle both single and batch output formats:
      //   single string  → [{translation_text}]
      //   string array   → [[{translation_text}], ...]
      const entry = outputs[i]
      const result = Array.isArray(entry) ? entry[0] : entry
      const translation: string =
        (result as { translation_text?: string })?.translation_text ?? ''

      if (translation && translation !== texts[i] && !isGibberish(translation)) {
        self.postMessage({
          type: 'translate-partial',
          id: requestId,
          payload: {
            index: validLines[i].index,
            translation,
          },
        })
      }
    }

    self.postMessage({ type: 'translate-done', id: requestId })
  } catch (error) {
    self.postMessage({
      type: 'translate-result',
      id: requestId,
      payload: { error: String(error) },
    })
  }
}

/** Detect common NMT failure modes */
function isGibberish(text: string): boolean {
  // Extremely long output relative to typical translation
  if (text.length > 500) return true
  // Repeated phrases (common NMT failure)
  const words = text.split(/\s+/)
  if (words.length > 6) {
    const half = Math.floor(words.length / 2)
    const firstHalf = words.slice(0, half).join(' ')
    const secondHalf = words.slice(half, half * 2).join(' ')
    if (firstHalf === secondHalf) return true
  }
  return false
}
