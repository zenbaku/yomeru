import { useState, useCallback, useEffect, useRef, Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { Camera } from './components/Camera.tsx'
import { TextOverlay } from './components/TextOverlay.tsx'
import { InfoPanel } from './components/InfoPanel.tsx'
import { Onboarding } from './components/Onboarding.tsx'
import { ModelManager } from './components/ModelManager.tsx'
import { usePipeline } from './hooks/usePipeline.ts'
import { useNeuralTranslator } from './hooks/useNeuralTranslator.ts'
import { getSelectedNeuralModelId } from './services/translation/neural-registry.ts'

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null }

  static getDerivedStateFromError(err: Error) {
    return { error: err.message || 'Unexpected error' }
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', err, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100%', padding: 32, textAlign: 'center', gap: 16,
        }}>
          <p style={{ color: '#e94560', fontSize: 16 }}>Something went wrong</p>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, maxWidth: 300 }}>
            {this.state.error}
          </p>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              padding: '10px 24px', background: 'rgba(255,255,255,0.1)',
              borderRadius: 8, fontSize: 14,
            }}
          >
            Try Again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

type Screen = 'camera' | 'models'

function App() {
  const [ready, setReady] = useState(false)
  const [screen, setScreen] = useState<Screen>('camera')
  const pipeline = usePipeline()
  const [neuralModelId, setNeuralModelId] = useState(getSelectedNeuralModelId)
  const neural = useNeuralTranslator(neuralModelId)
  const [neuralTranslations, setNeuralTranslations] = useState<(string | null)[] | null>(null)
  const prevPhaseRef = useRef(pipeline.phase)

  const handleCapture = useCallback((frame: ImageData) => {
    try {
      pipeline.scan(frame, { ocrOnly: pipeline.ocrOnly })
    } catch (err) {
      console.error('Scan failed:', err)
    }
  }, [pipeline.scan, pipeline.ocrOnly])

  // When pipeline finishes and neural model is available, trigger neural translation
  useEffect(() => {
    const justFinished = pipeline.phase === 'done' && prevPhaseRef.current !== 'done'
    prevPhaseRef.current = pipeline.phase

    if (justFinished && pipeline.ocrResult && !pipeline.ocrOnly && (neural.isModelLoaded || neural.isModelDownloaded)) {
      const lines = pipeline.ocrResult.lines.map((l, i) => ({
        index: i,
        japanese: l.text,
      }))

      // Initialize neural translations array with nulls
      setNeuralTranslations(new Array(lines.length).fill(null))

      neural.translateLines(
        lines,
        // onPartial: update specific line
        (index, translation) => {
          setNeuralTranslations((prev) => {
            if (!prev) return prev
            const next = [...prev]
            next[index] = translation
            return next
          })
        },
      )
    }
  }, [pipeline.phase, pipeline.ocrResult, pipeline.ocrOnly, neural.isModelLoaded, neural.isModelDownloaded])

  // Reset neural translations when pipeline resets
  useEffect(() => {
    if (pipeline.phase === 'idle') {
      setNeuralTranslations(null)
    }
  }, [pipeline.phase])

  // Re-check neural download status when returning from model manager
  const handleBackFromModels = useCallback(() => {
    setScreen('camera')
    neural.recheckDownloaded()
  }, [neural.recheckDownloaded])

  if (!ready) {
    return <Onboarding onReady={() => setReady(true)} />
  }

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
    }}>
      {/* Camera view (always mounted) */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}>
        {/* Camera section */}
        <div style={{
          flex: '0 0 55vh',
          position: 'relative',
          overflow: 'hidden',
        }}>
          <Camera
            onCapture={handleCapture}
            scanning={pipeline.scanning}
          />

          <TextOverlay
            ocrResult={pipeline.ocrResult}
            imageSize={pipeline.imageSize}
            translated={pipeline.phase === 'done'}
          />
        </div>

        {/* Info panel section */}
        <InfoPanel
          phase={pipeline.phase}
          ocrText={pipeline.ocrResult?.fullText ?? null}
          translations={pipeline.translations}
          neuralTranslations={neuralTranslations}
          isNeuralTranslating={neural.isTranslating}
          isNeuralAvailable={neural.isModelDownloaded}
          error={pipeline.error}
          ocrOnly={pipeline.ocrOnly}
          onOcrOnlyChange={pipeline.setOcrOnly}
          onSettings={() => setScreen('models')}
          onReset={pipeline.reset}
        />
      </div>

      {/* Settings overlay — slides in from right */}
      {screen === 'models' && (
        <div style={{
          position: 'absolute',
          inset: 0,
          zIndex: 20,
          background: 'var(--bg-primary)',
          animation: 'slideInRight 0.25s ease-out',
        }}>
          <ModelManager
            onBack={handleBackFromModels}
            neural={neural}
            onNeuralModelChange={setNeuralModelId}
          />
        </div>
      )}
    </div>
  )
}

function AppWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  )
}

export default AppWithErrorBoundary
