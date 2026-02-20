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

  const pct = Math.round(progress * 100)

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      padding: 32,
      textAlign: 'center',
      gap: 24,
      background: 'radial-gradient(ellipse at 50% 40%, rgba(233, 69, 96, 0.06) 0%, transparent 70%)',
    }}>
      {/* Logo with glow */}
      <div style={{
        fontSize: 72,
        lineHeight: 1,
        filter: stage === 'checking' ? 'none' : undefined,
        animation: stage === 'checking' || stage === 'downloading' ? 'pulse 2s ease-in-out infinite' : undefined,
      }}>
        <span style={{
          color: 'var(--accent)',
          textShadow: '0 0 30px var(--accent-glow), 0 0 60px rgba(233, 69, 96, 0.15)',
        }}>&#35501;</span>
      </div>

      <div>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: -0.5 }}>Yomeru</h1>
        <p style={{
          color: 'var(--text-secondary)',
          fontSize: 14,
          maxWidth: 280,
          marginTop: 6,
          lineHeight: 1.4,
        }}>
          Offline Japanese text scanner and translator
        </p>
      </div>

      {stage === 'checking' && (
        <div style={{ animation: 'fadeIn 0.3s ease' }}>
          <div style={{
            width: 32,
            height: 32,
            margin: '0 auto 12px',
            border: '3px solid rgba(255,255,255,0.1)',
            borderTopColor: 'var(--accent)',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }} />
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            {statusText}
          </p>
        </div>
      )}

      {stage === 'needs-download' && (
        <div style={{ animation: 'slideUp 0.4s ease' }}>
          <p style={{
            color: 'var(--text-secondary)',
            fontSize: 13,
            maxWidth: 300,
            lineHeight: 1.5,
            marginBottom: 20,
          }}>
            Yomeru needs to download language data and the OCR model (~20 MB) to work offline. This only happens once.
          </p>
          <button
            onClick={startDownload}
            style={{
              padding: '14px 40px',
              background: 'var(--accent)',
              borderRadius: 12,
              fontSize: 16,
              fontWeight: 600,
              boxShadow: '0 0 20px var(--accent-glow)',
              transition: 'transform 0.15s ease, box-shadow 0.15s ease',
            }}
            onPointerDown={(e) => {
              (e.currentTarget as HTMLElement).style.transform = 'scale(0.96)'
            }}
            onPointerUp={(e) => {
              (e.currentTarget as HTMLElement).style.transform = 'scale(1)'
            }}
            onPointerLeave={(e) => {
              (e.currentTarget as HTMLElement).style.transform = 'scale(1)'
            }}
          >
            Download
          </button>
        </div>
      )}

      {stage === 'downloading' && (
        <div style={{
          width: '100%',
          maxWidth: 300,
          animation: 'slideUp 0.3s ease',
        }}>
          <p style={{
            color: 'var(--text-secondary)',
            fontSize: 13,
            marginBottom: 16,
          }}>
            {statusText}
          </p>

          {/* Progress ring + bar combo */}
          <div style={{
            position: 'relative',
            width: '100%',
            height: 8,
            background: 'rgba(255,255,255,0.06)',
            borderRadius: 4,
            overflow: 'hidden',
            animation: 'progressGlow 2s ease-in-out infinite',
          }}>
            <div style={{
              width: `${pct}%`,
              height: '100%',
              background: 'linear-gradient(90deg, var(--accent), #f5a623)',
              borderRadius: 4,
              transition: 'width 0.3s ease',
            }} />
          </div>

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 10,
          }}>
            <span style={{
              color: 'var(--text-secondary)',
              fontSize: 12,
            }}>
              {pct < 40 ? 'Dictionary' : 'OCR model'}
            </span>
            <span style={{
              color: 'var(--text-primary)',
              fontSize: 14,
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {pct}%
            </span>
          </div>
        </div>
      )}

      {stage === 'ready' && (
        <div style={{ animation: 'slideUp 0.4s ease' }}>
          <div style={{
            width: 48,
            height: 48,
            margin: '0 auto 16px',
            borderRadius: '50%',
            background: 'rgba(76, 217, 100, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4cd964" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <p style={{
            color: 'var(--bbox-done)',
            fontSize: 14,
            fontWeight: 600,
            marginBottom: 20,
          }}>
            {statusText}
          </p>
          <button
            onClick={onReady}
            style={{
              padding: '14px 40px',
              background: 'var(--accent)',
              borderRadius: 12,
              fontSize: 16,
              fontWeight: 600,
              boxShadow: '0 0 20px var(--accent-glow)',
              transition: 'transform 0.15s ease',
            }}
            onPointerDown={(e) => {
              (e.currentTarget as HTMLElement).style.transform = 'scale(0.96)'
            }}
            onPointerUp={(e) => {
              (e.currentTarget as HTMLElement).style.transform = 'scale(1)'
            }}
            onPointerLeave={(e) => {
              (e.currentTarget as HTMLElement).style.transform = 'scale(1)'
            }}
          >
            Start Scanning
          </button>
        </div>
      )}

      {stage === 'error' && (
        <div style={{ animation: 'slideUp 0.3s ease' }}>
          <div style={{
            padding: '12px 16px',
            background: 'rgba(233, 69, 96, 0.1)',
            borderRadius: 10,
            border: '1px solid rgba(233, 69, 96, 0.2)',
            marginBottom: 16,
            maxWidth: 300,
          }}>
            <p style={{ color: 'var(--accent)', fontSize: 14 }}>
              {errorMsg}
            </p>
          </div>
          <button
            onClick={checkAssets}
            style={{
              padding: '12px 28px',
              background: 'rgba(255,255,255,0.1)',
              borderRadius: 10,
              fontSize: 14,
              transition: 'background 0.15s ease',
            }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  )
}
