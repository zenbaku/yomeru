import { useState, useEffect } from 'react'
import { isDictionaryLoaded, loadDictionaryFromJSON } from '../services/storage/indexeddb.ts'
import { getDefaultOCRModel } from '../services/ocr/registry.ts'

interface OnboardingProps {
  onReady: () => void
}

type Stage = 'checking' | 'needs-download' | 'downloading' | 'ready' | 'error'

export function Onboarding({ onReady }: OnboardingProps) {
  const [stage, setStage] = useState<Stage>('checking')
  const [progress, setProgress] = useState(0)
  const [statusText, setStatusText] = useState('Checking assets...')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    checkAssets()
  }, [])

  async function checkAssets() {
    setStage('checking')
    setStatusText('Checking assets...')
    try {
      const ocrModel = getDefaultOCRModel()
      const [dictLoaded, ocrLoaded] = await Promise.all([
        isDictionaryLoaded(),
        ocrModel.isDownloaded(),
      ])

      if (dictLoaded && ocrLoaded) {
        // Core assets cached — initialize OCR
        setStatusText('Initializing models...')

        try {
          await ocrModel.initialize((p) => setProgress(p))
        } catch (err) {
          console.warn('OCR model init failed, will re-download:', err)
          setStage('needs-download')
          return
        }

        setStage('ready')
        setTimeout(onReady, 500)
      } else {
        setStage('needs-download')
      }
    } catch (err) {
      setStage('error')
      setErrorMsg(err instanceof Error ? err.message : 'Failed to check assets')
    }
  }

  async function startDownload() {
    setStage('downloading')
    setProgress(0)
    try {
      // Step 1: Load dictionary into IndexedDB (0-40%)
      setStatusText('Loading dictionary...')
      await loadDictionaryFromJSON((loaded, total) => {
        setProgress(loaded / total * 0.4)
      })

      // Step 2: Download + initialize OCR model (40-100%)
      setStatusText('Downloading OCR model...')
      await getDefaultOCRModel().initialize((p) => {
        setProgress(0.4 + p * 0.6)
      })

      setStage('ready')
      setStatusText("You're all set! Yomeru now works offline.")
    } catch (err) {
      setStage('error')
      setErrorMsg(err instanceof Error ? err.message : 'Download failed')
    }
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      padding: 32,
      textAlign: 'center',
      gap: 20,
    }}>
      {/* Logo */}
      <div style={{ fontSize: 64, lineHeight: 1 }}>
        <span style={{ color: 'var(--accent)' }}>&#35501;</span>
      </div>
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Yomeru</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14, maxWidth: 280 }}>
        Offline Japanese text scanner and translator
      </p>

      {stage === 'checking' && (
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          {statusText}
        </p>
      )}

      {stage === 'needs-download' && (
        <>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, maxWidth: 300 }}>
            Yomeru needs to download language data and the OCR model (~20 MB) to work offline. This only happens once.
          </p>
          <button
            onClick={startDownload}
            style={{
              padding: '12px 32px',
              background: 'var(--accent)',
              borderRadius: 8,
              fontSize: 16,
              fontWeight: 600,
              boxShadow: '0 0 20px var(--accent-glow)',
            }}
          >
            Download
          </button>
        </>
      )}

      {stage === 'downloading' && (
        <>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            {statusText}
          </p>
          <div style={{
            width: '100%',
            maxWidth: 280,
            height: 6,
            background: 'rgba(255,255,255,0.1)',
            borderRadius: 3,
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${Math.round(progress * 100)}%`,
              height: '100%',
              background: 'var(--accent)',
              borderRadius: 3,
              transition: 'width 0.3s ease',
            }} />
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
            {Math.round(progress * 100)}%
          </p>
        </>
      )}

      {stage === 'ready' && (
        <>
          <p style={{ color: 'var(--bbox-done)', fontSize: 14, fontWeight: 600 }}>
            {statusText}
          </p>
          <button
            onClick={onReady}
            style={{
              padding: '12px 32px',
              background: 'var(--accent)',
              borderRadius: 8,
              fontSize: 16,
              fontWeight: 600,
            }}
          >
            Start Scanning
          </button>
        </>
      )}

      {stage === 'error' && (
        <>
          <p style={{ color: 'var(--accent)', fontSize: 14 }}>
            {errorMsg}
          </p>
          <button
            onClick={checkAssets}
            style={{
              padding: '10px 24px',
              background: 'rgba(255,255,255,0.1)',
              borderRadius: 8,
              fontSize: 14,
            }}
          >
            Retry
          </button>
        </>
      )}
    </div>
  )
}
