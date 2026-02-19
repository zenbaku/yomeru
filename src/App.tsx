import { useState, useCallback } from 'react'
import { Camera } from './components/Camera.tsx'
import { TextOverlay } from './components/TextOverlay.tsx'
import { InfoPanel } from './components/InfoPanel.tsx'
import { Onboarding } from './components/Onboarding.tsx'
import { ModelManager } from './components/ModelManager.tsx'
import { usePipeline } from './hooks/usePipeline.ts'

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

export default App
