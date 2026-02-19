import { useState, useCallback, useRef, useEffect } from 'react'
import { preprocessFrame, analyzeImage } from '@/services/preprocessing.ts'
import type { PreprocessOptions, ImageAnalysis } from '@/services/preprocessing.ts'
import { ocrModels, getOCRModel, getDefaultOCRModel } from '@/services/ocr/registry.ts'
import { getDefaultTranslationModel } from '@/services/translation/registry.ts'
import { neuralModels, getNeuralModel, getSelectedNeuralModelId } from '@/services/translation/neural-registry.ts'
import type { NeuralModelConfig, NeuralModelInfo } from '@/services/translation/types.ts'
import {
  filterByConfidence,
  filterByContent,
  filterBySize,
  filterOverlapping,
  mergeAdjacentLines,
} from '@/services/ocr/filters.ts'
import type { OCRLine, OCRResult } from '@/services/ocr/types.ts'
import type { TranslationResult } from '@/services/translation/types.ts'
import { PRESETS, type PipelineParams } from '@/services/preprocessing-presets.ts'
import { ParameterPanel } from './ParameterPanel.tsx'
import { StagePanel } from './StagePanel.tsx'
import { ResultsPanel } from './ResultsPanel.tsx'
import { CameraCapture } from './CameraCapture.tsx'

interface StageTimings {
  preprocessing: number
  ocr: number
  filtering: number
  translation: number
  neural: number
}

type NeuralStatus = 'idle' | 'loading' | 'translating' | 'done' | 'error' | 'not-downloaded' | 'no-model'

interface PipelineOutput {
  preprocessed: ImageData | null
  rawOCR: OCRResult | null
  filteredLines: OCRLine[]
  translations: TranslationResult[]
  neuralTranslations: Map<number, string>
  neuralStatus: NeuralStatus
  neuralProgress: number // 0-100
  neuralError: string | null
  timings: StageTimings
}

const EMPTY_OUTPUT: PipelineOutput = {
  preprocessed: null,
  rawOCR: null,
  filteredLines: [],
  translations: [],
  neuralTranslations: new Map(),
  neuralStatus: 'idle',
  neuralProgress: 0,
  neuralError: null,
  timings: { preprocessing: 0, ocr: 0, filtering: 0, translation: 0, neural: 0 },
}

// ---------------------------------------------------------------------------
// Fixture grouping helpers
// ---------------------------------------------------------------------------

interface FixtureGroup {
  label: string
  items: { name: string; display: string }[]
}

function groupFixtures(names: string[]): FixtureGroup[] {
  const manual: FixtureGroup = { label: 'Manual', items: [] }
  const syntheticMap = new Map<string, { name: string; variant: string }[]>()

  for (const name of names) {
    if (!name.startsWith('synthetic-')) {
      manual.items.push({ name, display: name })
      continue
    }

    // synthetic-{id}-{variant} — variant is the last segment
    const withoutPrefix = name.slice('synthetic-'.length)
    const lastDash = withoutPrefix.lastIndexOf('-')
    if (lastDash === -1) {
      manual.items.push({ name, display: name })
      continue
    }
    const fixtureId = withoutPrefix.slice(0, lastDash)
    const variant = withoutPrefix.slice(lastDash + 1)

    if (!syntheticMap.has(fixtureId)) syntheticMap.set(fixtureId, [])
    syntheticMap.get(fixtureId)!.push({ name, variant })
  }

  const groups: FixtureGroup[] = []
  if (manual.items.length > 0) groups.push(manual)

  if (syntheticMap.size > 0) {
    const syntheticGroup: FixtureGroup = { label: 'Synthetic', items: [] }
    for (const [id, variants] of [...syntheticMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      for (const v of variants.sort((a, b) => a.variant.localeCompare(b.variant))) {
        syntheticGroup.items.push({ name: v.name, display: `${id} (${v.variant})` })
      }
    }
    groups.push(syntheticGroup)
  }

  return groups
}

// ---------------------------------------------------------------------------
// NeuralModelBar — inline mini model manager
// ---------------------------------------------------------------------------

function NeuralModelBar({
  selectedId,
  onSelect,
  onDownloadComplete,
}: {
  selectedId: string
  onSelect: (id: string) => void
  onDownloadComplete: () => void
}) {
  return (
    <div style={neuralBarStyle}>
      <span style={{ fontSize: 12, color: '#a0a0b0', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Neural:
      </span>
      {neuralModels.map((m) => (
        <NeuralModelChip
          key={m.id}
          model={m}
          isSelected={m.id === selectedId}
          onSelect={() => onSelect(m.id)}
          onDownloadComplete={onDownloadComplete}
        />
      ))}
      <button
        onClick={() => onSelect('')}
        style={{
          ...chipStyle,
          background: selectedId === '' ? '#0f3460' : 'transparent',
          border: selectedId === '' ? '1px solid #4dabf7' : '1px solid #0f3460',
          color: selectedId === '' ? '#4dabf7' : '#a0a0b0',
        }}
      >
        None
      </button>
    </div>
  )
}

function NeuralModelChip({
  model,
  isSelected,
  onSelect,
  onDownloadComplete,
}: {
  model: NeuralModelInfo
  isSelected: boolean
  onSelect: () => void
  onDownloadComplete: () => void
}) {
  const [downloaded, setDownloaded] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    model.isDownloaded().then(setDownloaded).catch(() => setDownloaded(false))
  }, [model])

  const sizeMB = (model.size / 1024 / 1024).toFixed(0)

  async function handleDownload(e: React.MouseEvent) {
    e.stopPropagation()
    setBusy(true)
    setProgress(0)
    try {
      await model.initialize((p) => setProgress(p))
      setDownloaded(true)
      onDownloadComplete()
    } catch {
      // Download failed
    } finally {
      setBusy(false)
      setProgress(0)
    }
  }

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    setBusy(true)
    try {
      await model.clearCache()
      setDownloaded(false)
    } catch {
      // Delete failed
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      onClick={downloaded ? onSelect : undefined}
      style={{
        ...chipStyle,
        background: isSelected ? '#0f3460' : 'rgba(255,255,255,0.03)',
        border: isSelected ? '1px solid #4dabf7' : '1px solid #0f3460',
        cursor: downloaded ? 'pointer' : 'default',
        gap: 8,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Progress bar background */}
      {busy && progress > 0 && (
        <div style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: `${Math.round(progress * 100)}%`,
          background: 'rgba(77, 171, 247, 0.12)',
          transition: 'width 0.3s ease',
        }} />
      )}

      <span style={{
        color: isSelected ? '#4dabf7' : downloaded ? '#e8e8e8' : '#a0a0b0',
        fontWeight: isSelected ? 600 : 400,
        position: 'relative',
      }}>
        {model.name}
      </span>

      <span style={{ color: '#666', fontSize: 11, position: 'relative' }}>
        ~{sizeMB} MB
      </span>

      {downloaded === false && !busy && (
        <button onClick={handleDownload} style={chipActionStyle}>
          Download
        </button>
      )}

      {busy && (
        <span style={{ color: '#4dabf7', fontSize: 11, position: 'relative' }}>
          {Math.round(progress * 100)}%
        </span>
      )}

      {downloaded && (
        <>
          <span style={{ color: '#4cd964', fontSize: 11, position: 'relative' }}>
            {isSelected ? 'Active' : 'Ready'}
          </span>
          <button onClick={handleDelete} style={{ ...chipActionStyle, color: '#e94560' }}>
            ×
          </button>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

export function Inspector() {
  const [params, setParams] = useState<PipelineParams>({ ...PRESETS.auto })
  const [imageData, setImageData] = useState<ImageData | null>(null)
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [output, setOutput] = useState<PipelineOutput>(EMPTY_OUTPUT)
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState<string>('Load an image to begin')
  const [fixtureGroups, setFixtureGroups] = useState<FixtureGroup[]>([])
  const [dragging, setDragging] = useState(false)
  const [analysis, setAnalysis] = useState<ImageAnalysis | null>(null)
  const [selectedModelId, setSelectedModelId] = useState(getDefaultOCRModel().id)
  const [selectedNeuralId, setSelectedNeuralId] = useState(getSelectedNeuralModelId)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const runIdRef = useRef(0)
  const dragCountRef = useRef(0)

  // ---------------------------------------------------------------------------
  // Persistent neural worker — survives across image selections
  // ---------------------------------------------------------------------------
  const neuralWorkerRef = useRef<Worker | null>(null)
  const neuralWorkerModelRef = useRef('')
  const neuralWorkerReadyRef = useRef(false)
  const neuralInitPromiseRef = useRef<Promise<Worker> | null>(null)
  const neuralLoadProgressRef = useRef<((progress: number) => void) | null>(null)

  function terminateNeuralWorker() {
    neuralWorkerRef.current?.terminate()
    neuralWorkerRef.current = null
    neuralWorkerModelRef.current = ''
    neuralWorkerReadyRef.current = false
    neuralInitPromiseRef.current = null
    neuralLoadProgressRef.current = null
  }

  function ensureNeuralWorker(modelId: string, config: NeuralModelConfig): Promise<Worker> {
    // Already ready for this model — return immediately
    if (neuralWorkerRef.current && neuralWorkerModelRef.current === modelId && neuralWorkerReadyRef.current) {
      return Promise.resolve(neuralWorkerRef.current)
    }
    // Currently loading the same model — share the in-flight promise
    if (neuralInitPromiseRef.current && neuralWorkerModelRef.current === modelId && neuralWorkerRef.current) {
      return neuralInitPromiseRef.current
    }
    // Different model or no worker — start fresh
    terminateNeuralWorker()

    const worker = new Worker(
      new URL('../../src/workers/translation-worker.ts', import.meta.url),
      { type: 'module' },
    )
    neuralWorkerRef.current = worker
    neuralWorkerModelRef.current = modelId

    const fileProgress = new Map<string, { loaded: number; total: number }>()

    const promise = new Promise<Worker>((resolve, reject) => {
      // Watchdog: resets on every progress event so active loading never times out,
      // but genuinely stuck loads (no progress for 90s) do.
      const WATCHDOG_MS = 90_000
      let watchdog = setTimeout(onTimeout, WATCHDOG_MS)
      function onTimeout() {
        terminateNeuralWorker()
        reject(new Error('Model loading timed out'))
      }
      function resetWatchdog() {
        clearTimeout(watchdog)
        watchdog = setTimeout(onTimeout, WATCHDOG_MS)
      }

      worker.onmessage = (event) => {
        const { type, payload } = event.data
        if (type === 'loading') {
          resetWatchdog()
          const file = payload.file ?? ''
          if (file && payload.total > 0) {
            fileProgress.set(file, { loaded: payload.loaded ?? 0, total: payload.total })
            let totalBytes = 0, loadedBytes = 0
            for (const f of fileProgress.values()) {
              totalBytes += f.total
              loadedBytes += f.loaded
            }
            neuralLoadProgressRef.current?.(totalBytes > 0 ? (loadedBytes / totalBytes) * 100 : 0)
          } else {
            neuralLoadProgressRef.current?.(payload.progress ?? 0)
          }
        } else if (type === 'ready') {
          clearTimeout(watchdog)
          neuralWorkerReadyRef.current = true
          neuralInitPromiseRef.current = null
          resolve(worker)
        } else if (type === 'error') {
          clearTimeout(watchdog)
          terminateNeuralWorker()
          reject(new Error(payload.message))
        }
      }

      worker.onerror = (err) => {
        clearTimeout(watchdog)
        terminateNeuralWorker()
        reject(new Error(err.message || 'Worker error'))
      }

      worker.postMessage({ type: 'init', payload: { config } })
    })

    neuralInitPromiseRef.current = promise
    return promise
  }

  function translateWithWorker(
    worker: Worker,
    lines: { index: number; japanese: string }[],
    onProgress?: (progress: number) => void,
  ): Promise<Map<number, string>> {
    return new Promise((resolve, reject) => {
      const results = new Map<number, string>()
      const timeout = setTimeout(() => resolve(results), 120_000)

      worker.onmessage = (event) => {
        const { type, payload } = event.data
        switch (type) {
          case 'translate-partial':
            results.set(payload.index, payload.translation)
            onProgress?.((results.size / lines.length) * 100)
            break
          case 'translate-done':
            clearTimeout(timeout)
            resolve(results)
            break
          case 'translate-result':
            if (payload?.error) {
              clearTimeout(timeout)
              reject(new Error(payload.error))
            }
            break
          case 'error':
            clearTimeout(timeout)
            terminateNeuralWorker()
            reject(new Error(payload.message))
            break
        }
      }

      worker.onerror = (err) => {
        clearTimeout(timeout)
        terminateNeuralWorker()
        reject(new Error(err.message || 'Worker error'))
      }

      worker.postMessage({ type: 'translate', payload: { lines }, id: 'inspector' })
    })
  }

  // Discover fixtures on mount
  useEffect(() => {
    fetch('/fixtures/_list')
      .then((r) => r.json())
      .then((names: string[]) => setFixtureGroups(groupFixtures(names)))
      .catch(() => setFixtureGroups([]))
  }, [])

  // Terminate neural worker on unmount
  useEffect(() => {
    return () => { neuralWorkerRef.current?.terminate() }
  }, [])

  // Eagerly init neural worker on mount if a model is selected and downloaded
  useEffect(() => {
    const modelId = selectedNeuralId
    if (!modelId) return
    const model = getNeuralModel(modelId)
    if (!model) return
    model.isDownloaded().then((downloaded) => {
      if (downloaded) ensureNeuralWorker(modelId, model.workerConfig).catch(() => {})
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------------------------------------------------------------------------
  // Image loading
  // ---------------------------------------------------------------------------

  const loadImageFromFile = useCallback((file: File) => {
    const url = URL.createObjectURL(file)
    setImageSrc(url)

    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
      setImageData(data)
    }
    img.src = url
  }, [])

  const loadFixtureByName = useCallback((name: string) => {
    const extensions = ['.png', '.jpg', '.jpeg', '.webp']
    let loaded = false

    for (const ext of extensions) {
      const url = `/fixtures/${name}${ext}`
      const img = new Image()
      img.onload = () => {
        if (loaded) return
        loaded = true
        setImageSrc(url)
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0)
        setImageData(ctx.getImageData(0, 0, canvas.width, canvas.height))
      }
      img.onerror = () => {
        // Try next extension
      }
      img.src = url
    }
  }, [])

  const handleCameraCapture = useCallback((data: ImageData, objectUrl: string) => {
    setImageData(data)
    setImageSrc(objectUrl)
  }, [])

  // ---------------------------------------------------------------------------
  // Clipboard paste
  // ---------------------------------------------------------------------------

  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items
      if (!items) return

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const file = item.getAsFile()
          if (file) loadImageFromFile(file)
          return
        }
      }
    }

    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [loadImageFromFile])

  // ---------------------------------------------------------------------------
  // Drag and drop
  // ---------------------------------------------------------------------------

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCountRef.current++
    if (e.dataTransfer.types.includes('Files')) {
      setDragging(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCountRef.current--
    if (dragCountRef.current === 0) {
      setDragging(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      dragCountRef.current = 0
      setDragging(false)

      const file = e.dataTransfer.files[0]
      if (file && file.type.startsWith('image/')) {
        loadImageFromFile(file)
      }
    },
    [loadImageFromFile],
  )

  // ---------------------------------------------------------------------------
  // Pipeline execution
  // ---------------------------------------------------------------------------

  const runPipeline = useCallback(
    async (img: ImageData, p: PipelineParams, modelId: string, neuralId: string) => {
      const runId = ++runIdRef.current
      setRunning(true)
      setStatus('Running pipeline...')
      setOutput(EMPTY_OUTPUT)

      const timings: StageTimings = { preprocessing: 0, ocr: 0, filtering: 0, translation: 0, neural: 0 }
      const ocrModel = getOCRModel(modelId) ?? getDefaultOCRModel()

      try {
        // Stage 1: Preprocessing (skip for PaddleOCR)
        let preprocessed: ImageData = img
        if (ocrModel.id === 'tesseract-jpn') {
          setStatus('Preprocessing...')
          const t0 = performance.now()
          const preprocessOpts: PreprocessOptions = {
            auto: p.auto,
            adaptiveBlockSize: p.adaptiveBlockSize,
            adaptiveC: p.adaptiveC,
            blur: p.blur,
            median: p.median,
            morphOpen: p.morphOpen,
            upscale: p.upscale,
          }
          preprocessed = preprocessFrame(img, preprocessOpts)
          timings.preprocessing = performance.now() - t0
        }

        if (runId !== runIdRef.current) return

        // Stage 2: OCR
        setStatus(`Running OCR (${ocrModel.name})...`)
        const t1 = performance.now()
        await ocrModel.initialize()
        const rawOCR = await ocrModel.recognize(preprocessed)
        timings.ocr = performance.now() - t1

        if (runId !== runIdRef.current) return

        // Stage 3: Filtering
        setStatus('Filtering...')
        const t2 = performance.now()
        let filteredLines = filterByConfidence(rawOCR.lines, p.minConfidence)
        if (p.requireJapanese) {
          filteredLines = filterByContent(filteredLines)
        }
        filteredLines = filterBySize(filteredLines)
        filteredLines = filterOverlapping(filteredLines)
        filteredLines = mergeAdjacentLines(filteredLines)
        timings.filtering = performance.now() - t2

        if (runId !== runIdRef.current) return

        // Stage 4: Dictionary translation
        setStatus('Translating (dictionary)...')
        const t3 = performance.now()
        let translations: TranslationResult[] = []
        const fullText = filteredLines.map((l) => l.text).join('')
        if (fullText.length > 0) {
          const translationModel = getDefaultTranslationModel()
          await translationModel.initialize()
          translations = await translationModel.translate(fullText)
        }
        timings.translation = performance.now() - t3

        if (runId !== runIdRef.current) return

        // Determine neural status — skip isDownloaded() if worker is already warm
        const neuralModel = getNeuralModel(neuralId)
        const workerWarm = neuralWorkerReadyRef.current && neuralWorkerModelRef.current === neuralId
        let shouldRunNeural = false
        let neuralStatus: NeuralStatus = 'no-model'

        if (neuralModel) {
          if (workerWarm) {
            shouldRunNeural = true
            neuralStatus = 'translating'
          } else {
            const isDownloaded = await neuralModel.isDownloaded()
            if (isDownloaded) {
              shouldRunNeural = true
              neuralStatus = 'loading'
            } else {
              neuralStatus = 'not-downloaded'
            }
          }
        }

        const baseOutput = { preprocessed, rawOCR, filteredLines, translations, neuralTranslations: new Map<number, string>(), neuralStatus, neuralProgress: 0, neuralError: null, timings }
        setOutput(baseOutput)
        const dictMs = Object.values(timings).reduce((a, b) => a + b, 0)
        setStatus(
          neuralStatus === 'loading' ? `Loading ${neuralModel!.name}...` :
          neuralStatus === 'translating' ? `Translating (${neuralModel!.name})...` :
          `Done in ${dictMs.toFixed(0)}ms`)
        setRunning(shouldRunNeural)

        // Stage 5: Neural translation (persistent worker)
        if (shouldRunNeural && neuralModel && filteredLines.length > 0) {
          const t4 = performance.now()
          const lines = filteredLines.map((l, i) => ({ index: i, japanese: l.text }))
          try {
            // Set progress callback for loading phase (read via ref by worker handler)
            neuralLoadProgressRef.current = (progress) => {
              if (runId !== runIdRef.current) return
              setOutput((prev) => ({ ...prev, neuralStatus: 'loading', neuralProgress: progress }))
              setStatus(`Loading ${neuralModel.name}... ${Math.round(progress)}%`)
            }
            const worker = await ensureNeuralWorker(neuralId, neuralModel.workerConfig)
            neuralLoadProgressRef.current = null

            if (runId !== runIdRef.current) return

            setOutput((prev) => ({ ...prev, neuralStatus: 'translating' }))
            setStatus(`Translating (${neuralModel.name})...`)

            const results = await translateWithWorker(worker, lines)
            timings.neural = performance.now() - t4
            if (runId === runIdRef.current) {
              setOutput({ ...baseOutput, neuralTranslations: results, neuralStatus: 'done', neuralProgress: 100, neuralError: null, timings })
              const totalMs = Object.values(timings).reduce((a, b) => a + b, 0)
              setStatus(`Done in ${totalMs.toFixed(0)}ms`)
              setRunning(false)
            }
          } catch (err) {
            if (runId === runIdRef.current) {
              const message = err instanceof Error ? err.message : String(err)
              setOutput((prev) => ({ ...prev, neuralStatus: 'error', neuralError: message }))
              setStatus(`Done in ${dictMs.toFixed(0)}ms (neural failed)`)
              setRunning(false)
            }
          }
        }
      } catch (err) {
        if (runId === runIdRef.current) {
          setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
        }
      } finally {
        if (runId === runIdRef.current) {
          setRunning(false)
        }
      }
    },
    [],
  )

  // Re-run pipeline when params change (debounced)
  const handleParamsChange = useCallback(
    (newParams: PipelineParams) => {
      setParams(newParams)
      if (!imageData) return
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        runPipeline(imageData, newParams, selectedModelId, selectedNeuralId)
      }, 300)
    },
    [imageData, runPipeline, selectedModelId, selectedNeuralId],
  )

  // Re-run when OCR model changes
  const handleModelChange = useCallback(
    (modelId: string) => {
      setSelectedModelId(modelId)
      if (!imageData) return
      runPipeline(imageData, params, modelId, selectedNeuralId)
    },
    [imageData, params, runPipeline, selectedNeuralId],
  )

  // Re-run when neural model changes
  const handleNeuralModelChange = useCallback(
    (neuralId: string) => {
      if (!neuralId) terminateNeuralWorker()
      setSelectedNeuralId(neuralId)
      if (!imageData) return
      runPipeline(imageData, params, selectedModelId, neuralId)
    },
    [imageData, params, runPipeline, selectedModelId],
  )

  // Run analysis + pipeline when image changes
  useEffect(() => {
    if (imageData) {
      setAnalysis(analyzeImage(imageData))
      runPipeline(imageData, params, selectedModelId, selectedNeuralId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageData])

  return (
    <div
      style={{ padding: 20, maxWidth: 1400, margin: '0 auto', position: 'relative' }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {dragging && (
        <div style={dropOverlayStyle}>
          <div style={dropLabelStyle}>Drop image here</div>
        </div>
      )}

      <h1 style={{ margin: '0 0 16px', fontSize: 24, color: '#e94560' }}>
        Yomeru Pipeline Inspector
      </h1>

      {/* Image selection toolbar */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <select
          onChange={(e) => {
            if (e.target.value) loadFixtureByName(e.target.value)
          }}
          defaultValue=""
          style={selectStyle}
        >
          <option value="" disabled>
            Select test image...
          </option>
          {fixtureGroups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.items.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.display}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        <label style={buttonStyle}>
          Upload
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) loadImageFromFile(file)
            }}
          />
        </label>

        <CameraCapture onCapture={handleCameraCapture} />

        <select
          value={selectedModelId}
          onChange={(e) => handleModelChange(e.target.value)}
          style={selectStyle}
        >
          {ocrModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>

        <span style={{ color: '#a0a0b0', fontSize: 13 }}>
          {running ? '...' : status}
        </span>

        <span style={hintStyle}>
          Paste or drag-and-drop an image
        </span>
      </div>

      {/* Neural model bar */}
      <NeuralModelBar
        selectedId={selectedNeuralId}
        onSelect={handleNeuralModelChange}
        onDownloadComplete={() => {
          // Re-run pipeline so it picks up the newly downloaded model
          if (imageData) {
            runPipeline(imageData, params, selectedModelId, selectedNeuralId)
          }
        }}
      />

      {/* Parameters */}
      <ParameterPanel
        params={params}
        onChange={handleParamsChange}
        presets={PRESETS}
      />

      {/* Stage panels */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
          marginTop: 16,
        }}
      >
        {/* Panel 1: Original */}
        <StagePanel title="Original" timing={null}>
          {imageSrc ? (
            <img
              src={imageSrc}
              alt="Original"
              style={{ width: '100%', height: 'auto', display: 'block' }}
            />
          ) : (
            <Placeholder text="No image loaded" />
          )}
        </StagePanel>

        {/* Panel 2: Preprocessed */}
        <StagePanel title="Preprocessed" timing={output.timings.preprocessing}>
          {selectedModelId !== 'tesseract-jpn' && output.rawOCR ? (
            <Placeholder text="Skipped (PaddleOCR uses raw image)" />
          ) : output.preprocessed ? (
            <PreprocessedCanvas imageData={output.preprocessed} />
          ) : (
            <Placeholder text="Waiting..." />
          )}
        </StagePanel>

        {/* Panel 3: OCR + Bounding Boxes */}
        <StagePanel title="OCR + BBox" timing={output.timings.ocr + output.timings.filtering}>
          {imageSrc && output.rawOCR ? (
            <BBoxOverlay
              imageSrc={imageSrc}
              rawLines={output.rawOCR.lines}
              filteredLines={output.filteredLines}
              minConfidence={params.minConfidence}
            />
          ) : (
            <Placeholder text="Waiting..." />
          )}
        </StagePanel>

        {/* Panel 4: Results */}
        <StagePanel title="Results" timing={output.timings.translation}>
          {output.translations.length > 0 ? (
            <ResultsPanel
              filteredLines={output.filteredLines}
              translations={output.translations}
              neuralTranslations={output.neuralTranslations}
              neuralStatus={output.neuralStatus}
              neuralProgress={output.neuralProgress}
              neuralError={output.neuralError}
            />
          ) : (
            <Placeholder text={output.rawOCR ? 'No results' : 'Waiting...'} />
          )}
        </StagePanel>
      </div>

      {/* Auto-detection info */}
      {analysis && params.auto && (
        <div style={analysisBarStyle}>
          <span style={{ color: '#e94560', fontWeight: 600 }}>Auto-detect:</span>
          <span>
            Noise: {(analysis.noiseLevel * 100).toFixed(1)}%
            {analysis.isNoisy ? ' (noisy)' : ' (clean)'}
          </span>
          <span>Median: {analysis.recommendedMedian ? 'ON' : 'off'}</span>
          <span>Upscale: {analysis.recommendedUpscale}x</span>
          <span>Despeckle: {analysis.recommendedDespeckle ? 'ON' : 'off'}</span>
        </div>
      )}

      {/* Stats bar */}
      {output.rawOCR && (
        <div style={statsBarStyle}>
          <span>
            Preprocess: {output.timings.preprocessing.toFixed(0)}ms
          </span>
          <span>OCR: {output.timings.ocr.toFixed(0)}ms</span>
          <span>Filter: {output.timings.filtering.toFixed(0)}ms</span>
          <span>Translate: {output.timings.translation.toFixed(0)}ms</span>
          <span>Neural: {output.timings.neural.toFixed(0)}ms</span>
          <span>|</span>
          <span>
            Regions found: {output.rawOCR.lines.length}
          </span>
          <span>
            After filter: {output.filteredLines.length}
          </span>
          {output.rawOCR.lines.length > 0 && (
            <span>
              Confidence range:{' '}
              {(Math.min(...output.rawOCR.lines.map((l) => l.confidence)) * 100).toFixed(0)}%-
              {(Math.max(...output.rawOCR.lines.map((l) => l.confidence)) * 100).toFixed(0)}%
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// --- Helper components ---

function Placeholder({ text }: { text: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 200,
        color: '#a0a0b0',
        fontSize: 14,
      }}
    >
      {text}
    </div>
  )
}

function PreprocessedCanvas({ imageData }: { imageData: ImageData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = imageData.width
    canvas.height = imageData.height
    const ctx = canvas.getContext('2d')!
    ctx.putImageData(imageData, 0, 0)
  }, [imageData])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: 'auto', display: 'block' }}
    />
  )
}

function BBoxOverlay({
  imageSrc,
  rawLines,
  filteredLines,
  minConfidence,
}: {
  imageSrc: string
  rawLines: OCRLine[]
  filteredLines: OCRLine[]
  minConfidence: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      drawOverlay()
    }
    img.src = imageSrc
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageSrc, rawLines, filteredLines, minConfidence])

  function drawOverlay() {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img) return

    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)

    const filteredTexts = new Set(filteredLines.map((l) => l.text))

    for (const line of rawLines) {
      const isFiltered = filteredTexts.has(line.text)
      const conf = line.confidence

      // Color by confidence (0-1 scale)
      let color: string
      if (conf >= 0.8) color = '#4cd964'
      else if (conf >= 0.6) color = '#f5a623'
      else color = '#e94560'

      const { x, y, width, height } = line.bbox

      ctx.strokeStyle = color
      ctx.lineWidth = 2
      if (!isFiltered || conf < minConfidence) {
        ctx.setLineDash([6, 4])
      } else {
        ctx.setLineDash([])
      }
      ctx.strokeRect(x, y, width, height)
      ctx.setLineDash([])

      // Confidence label (convert 0-1 to percentage)
      const label = `${(conf * 100).toFixed(0)}%`
      ctx.font = `${Math.max(12, height * 0.3)}px sans-serif`
      ctx.fillStyle = color
      const metrics = ctx.measureText(label)
      ctx.fillStyle = 'rgba(0,0,0,0.7)'
      ctx.fillRect(x, y - Math.max(14, height * 0.35), metrics.width + 4, Math.max(14, height * 0.35))
      ctx.fillStyle = color
      ctx.fillText(label, x + 2, y - 2)
    }
  }

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: 'auto', display: 'block' }}
    />
  )
}

// --- Styles ---

const selectStyle: React.CSSProperties = {
  background: '#16213e',
  color: '#e8e8e8',
  border: '1px solid #0f3460',
  borderRadius: 6,
  padding: '8px 12px',
  fontSize: 14,
  cursor: 'pointer',
}

const buttonStyle: React.CSSProperties = {
  background: '#0f3460',
  color: '#e8e8e8',
  border: '1px solid #16213e',
  borderRadius: 6,
  padding: '8px 16px',
  fontSize: 14,
  cursor: 'pointer',
  display: 'inline-block',
}

const hintStyle: React.CSSProperties = {
  color: '#666',
  fontSize: 12,
  marginLeft: 'auto',
}

const neuralBarStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  marginBottom: 12,
  padding: '8px 12px',
  background: '#16213e',
  borderRadius: 8,
  flexWrap: 'wrap',
}

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  borderRadius: 6,
  fontSize: 13,
  cursor: 'pointer',
  border: '1px solid #0f3460',
  background: 'transparent',
  color: '#e8e8e8',
}

const chipActionStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#4dabf7',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  padding: '0 2px',
  position: 'relative',
}

const analysisBarStyle: React.CSSProperties = {
  marginTop: 12,
  padding: '10px 16px',
  background: '#1a1a2e',
  border: '1px solid #e9456040',
  borderRadius: 8,
  display: 'flex',
  gap: 16,
  fontSize: 13,
  color: '#a0a0b0',
  flexWrap: 'wrap',
}

const statsBarStyle: React.CSSProperties = {
  marginTop: 12,
  padding: '10px 16px',
  background: '#16213e',
  borderRadius: 8,
  display: 'flex',
  gap: 16,
  fontSize: 13,
  color: '#a0a0b0',
  flexWrap: 'wrap',
}

const dropOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(233, 69, 96, 0.12)',
  border: '3px dashed #e94560',
  borderRadius: 12,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 999,
  pointerEvents: 'none',
}

const dropLabelStyle: React.CSSProperties = {
  color: '#e94560',
  fontSize: 24,
  fontWeight: 600,
}
