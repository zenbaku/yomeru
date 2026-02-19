import { useState, useCallback, useRef, useEffect } from 'react'
import { preprocessFrame } from '@/services/preprocessing.ts'
import type { PreprocessOptions } from '@/services/preprocessing.ts'
import { getDefaultOCRModel } from '@/services/ocr/registry.ts'
import { getDefaultTranslationModel } from '@/services/translation/registry.ts'
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
  timings: StageTimings
}

const EMPTY_OUTPUT: PipelineOutput = {
  preprocessed: null,
  rawOCR: null,
  filteredLines: [],
  translations: [],
  timings: { preprocessing: 0, ocr: 0, filtering: 0, translation: 0 },
}

export function Inspector() {
  const [params, setParams] = useState<PipelineParams>({ ...PRESETS.default })
  const [imageData, setImageData] = useState<ImageData | null>(null)
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [output, setOutput] = useState<PipelineOutput>(EMPTY_OUTPUT)
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState<string>('Load an image to begin')
  const [fixtures, setFixtures] = useState<string[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const runIdRef = useRef(0)

  // Discover fixture images on mount
  useEffect(() => {
    // We can't do fs listing from browser, so we fetch the meta files
    // and infer image names. The user adds images manually.
    const knownFixtures = ['menu-simple', 'hotel-card', 'emergency-exit']
    setFixtures(knownFixtures)
  }, [])

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
    // Try common image extensions
    const extensions = ['.jpg', '.jpeg', '.png', '.webp']
    let loaded = false

    for (const ext of extensions) {
      const url = `/tests/fixtures/${name}${ext}`
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

  const runPipeline = useCallback(
    async (img: ImageData, p: PipelineParams) => {
      const runId = ++runIdRef.current
      setRunning(true)
      setStatus('Running pipeline...')

      const timings: StageTimings = { preprocessing: 0, ocr: 0, filtering: 0, translation: 0 }

      try {
        // Stage 1: Preprocessing
        setStatus('Preprocessing...')
        const t0 = performance.now()
        const preprocessOpts: PreprocessOptions = {
          adaptiveBlockSize: p.adaptiveBlockSize,
          adaptiveC: p.adaptiveC,
          blur: p.blur,
        }
        const preprocessed = preprocessFrame(img, preprocessOpts)
        timings.preprocessing = performance.now() - t0

        if (runId !== runIdRef.current) return

        // Stage 2: OCR
        setStatus('Running OCR...')
        const t1 = performance.now()
        const ocrModel = getDefaultOCRModel()
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

        // Stage 4: Translation
        setStatus('Translating...')
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

        setOutput({ preprocessed, rawOCR, filteredLines, translations, timings })
        const totalMs = Object.values(timings).reduce((a, b) => a + b, 0)
        setStatus(`Done in ${totalMs.toFixed(0)}ms`)
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
        runPipeline(imageData, newParams)
      }, 300)
    },
    [imageData, runPipeline],
  )

  // Run immediately when image changes
  useEffect(() => {
    if (imageData) {
      runPipeline(imageData, params)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageData])

  return (
    <div style={{ padding: 20, maxWidth: 1400, margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 16px', fontSize: 24, color: '#e94560' }}>
        Yomeru Pipeline Inspector
      </h1>

      {/* Image selection */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
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
          {fixtures.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>

        <label style={buttonStyle}>
          Upload custom image
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

        <span style={{ color: '#a0a0b0', fontSize: 14 }}>
          {running ? '...' : status}
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
          {output.preprocessed ? (
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
            />
          ) : (
            <Placeholder text={output.rawOCR ? 'No results' : 'Waiting...'} />
          )}
        </StagePanel>
      </div>

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
              {Math.min(...output.rawOCR.lines.map((l) => l.confidence)).toFixed(0)}-
              {Math.max(...output.rawOCR.lines.map((l) => l.confidence)).toFixed(0)}
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

      // Color by confidence
      let color: string
      if (conf >= 80) color = '#4cd964'
      else if (conf >= 60) color = '#f5a623'
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

      // Confidence label
      const label = `${conf.toFixed(0)}%`
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
