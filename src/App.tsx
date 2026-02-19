import { useState, useCallback } from 'react'
import { Camera } from './components/Camera.tsx'
import { TextOverlay } from './components/TextOverlay.tsx'
import { ResultsPanel } from './components/ResultsPanel.tsx'
import { Onboarding } from './components/Onboarding.tsx'
import { ModelManager } from './components/ModelManager.tsx'
import { usePipeline } from './hooks/usePipeline.ts'

type Screen = 'camera' | 'models'

function App() {
  const [ready, setReady] = useState(false)
  const [screen, setScreen] = useState<Screen>('camera')
  const pipeline = usePipeline()

  const handleCapture = useCallback((frame: ImageData) => {
    pipeline.scan(frame)
  }, [pipeline.scan])

  if (!ready) {
    return <Onboarding onReady={() => setReady(true)} />
  }

  if (screen === 'models') {
    return <ModelManager onBack={() => setScreen('camera')} />
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <Camera
        phase={pipeline.phase}
        onCapture={handleCapture}
        scanning={pipeline.scanning}
      />

      <TextOverlay
        ocrResult={pipeline.ocrResult}
        imageSize={pipeline.imageSize}
        translated={pipeline.phase === 'done'}
      />

      <ResultsPanel
        translations={pipeline.translations}
        onClose={pipeline.reset}
      />

      {/* Settings gear - top right */}
      <button
        onClick={() => setScreen('models')}
        style={{
          position: 'absolute',
          top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
          right: 12,
          zIndex: 10,
          width: 36,
          height: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.4)',
          borderRadius: '50%',
          backdropFilter: 'blur(8px)',
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      </button>
    </div>
  )
}

export default App
