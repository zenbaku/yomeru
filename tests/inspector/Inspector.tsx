import { useState, useCallback, useRef, useEffect } from 'react'
import { preprocessFrame, analyzeImage } from '@/services/preprocessing.ts'
import type { PreprocessOptions, ImageAnalysis } from '@/services/preprocessing.ts'
import { ocrModels, getOCRModel, getDefaultOCRModel } from '@/services/ocr/registry.ts'
import { getDefaultTranslationModel } from '@/services/translation/registry.ts'
import { translatePhrases } from '@/services/translation/phrase.ts'
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
}

interface PipelineOutput {
  preprocessed: ImageData | null
  rawOCR: OCRResult | null
  filteredLines: OCRLine[]
  translations: TranslationResult[]
  phraseTranslations: string[] | null
  timings: StageTimings
}

const EMPTY_OUTPUT: PipelineOutput = {
  preprocessed: null,
  rawOCR: null,
  filteredLines: [],
  translations: [],
  phraseTranslations: null,
  timings: { preprocessing: 0, ocr: 0, filtering: 0, translation: 0 },
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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const runIdRef = useRef(0)
  const dragCountRef = useRef(0)

  // Discover fixtures on mount
  useEffect(() => {
    fetch('/fixtures/_list')
      .then((r) => r.json())
      .then((names: string[]) => setFixtureGroups(groupFixtures(names)))
      .catch(() => setFixtureGroups([]))
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
    async (img: ImageData, p: PipelineParams, modelId: string) => {
      const runId = ++runIdRef.current
      setRunning(true)
      setStatus('Running pipeline...')
      setOutput(EMPTY_OUTPUT) // Clear stale results from previous run

      const timings: StageTimings = { preprocessing: 0, ocr: 0, filtering: 0, translation: 0 }
      const ocrModel = getOCRModel(modelId) ?? getDefaultOCRModel()

      try {
        // Stage 1: Preprocessing (skip for PaddleOCR — its detector handles scene text natively)
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

        // Stage 3: Filtering (using custom params)
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

        // Stage 4: Dictionary translation (fast, runs immediately)
        setStatus('Translating...')
        const t3 = performance.now()
        let translations: TranslationResult[] = []
        const fullText = filteredLines.map((l) => l.text).join('')
        const lineTexts = filteredLines.map((l) => l.text)
        if (fullText.length > 0) {
          const translationModel = getDefaultTranslationModel()
          await translationModel.initialize()
          translations = await translationModel.translate(fullText)
        }
        timings.translation = performance.now() - t3

        if (runId !== runIdRef.current) return

        // Show dictionary results immediately
        setOutput({ preprocessed, rawOCR, filteredLines, translations, phraseTranslations: null, timings })
        const totalMs = Object.values(timings).reduce((a, b) => a + b, 0)
        setStatus(`Done in ${totalMs.toFixed(0)}ms`)

        // Stage 5: Phrase translation (async, may download ~50 MB model)
        // Runs in the background so it doesn't block the main results.
        if (lineTexts.length > 0) {
          setStatus(`Done in ${totalMs.toFixed(0)}ms — loading phrase model...`)
          translatePhrases(lineTexts).then((phraseResult) => {
            if (runId !== runIdRef.current) return
            setOutput((prev) => ({ ...prev, phraseTranslations: phraseResult }))
            setStatus(`Done in ${totalMs.toFixed(0)}ms`)
          }).catch(() => {
            // Phrase translation is best-effort; don't fail the pipeline
          })
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
        runPipeline(imageData, newParams, selectedModelId)
      }, 300)
    },
    [imageData, runPipeline, selectedModelId],
  )

  // Re-run when model changes
  const handleModelChange = useCallback(
    (modelId: string) => {
      setSelectedModelId(modelId)
      if (!imageData) return
      runPipeline(imageData, params, modelId)
    },
    [imageData, params, runPipeline],
  )

  // Run analysis + pipeline when image changes
  useEffect(() => {
    if (imageData) {
      setAnalysis(analyzeImage(imageData))
      runPipeline(imageData, params, selectedModelId)
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
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
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
              phraseTranslations={output.phraseTranslations}
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
