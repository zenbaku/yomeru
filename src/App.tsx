import { useState, useCallback, Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { Camera } from './components/Camera.tsx'
import { TextOverlay } from './components/TextOverlay.tsx'
import { InfoPanel } from './components/InfoPanel.tsx'
import { Onboarding } from './components/Onboarding.tsx'
import { ModelManager } from './components/ModelManager.tsx'
import { usePipeline } from './hooks/usePipeline.ts'

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

  const handleCapture = useCallback((frame: ImageData) => {
    pipeline.scan(frame, { ocrOnly: pipeline.ocrOnly })
  }, [pipeline.scan, pipeline.ocrOnly])

  if (!ready) {
    return <Onboarding onReady={() => setReady(true)} />
  }

  if (screen === 'models') {
    return <ModelManager onBack={() => setScreen('camera')} />
  }

  return (
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
        phraseTranslation={pipeline.phraseTranslation}
        error={pipeline.error}
        ocrOnly={pipeline.ocrOnly}
        onOcrOnlyChange={pipeline.setOcrOnly}
        onSettings={() => setScreen('models')}
        onReset={pipeline.reset}
      />
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
