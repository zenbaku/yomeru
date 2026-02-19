import { useEffect } from 'react'
import { useCamera } from '../hooks/useCamera.ts'
import type { PipelinePhase } from '../services/pipeline.ts'
import { PhaseIndicator } from './PhaseIndicator.tsx'

interface CameraProps {
  phase: PipelinePhase
  onCapture: (frame: ImageData) => void
  scanning: boolean
}

export function Camera({ phase, onCapture, scanning }: CameraProps) {
  const { videoRef, status, start, captureFrame } = useCamera()

  useEffect(() => {
    start()
  }, [start])

  const handleScan = () => {
    if (scanning) return
    const frame = captureFrame()
    if (frame) onCapture(frame)
  }

  if (status === 'denied') {
    return (
      <div style={overlayStyle}>
        <p style={{ fontSize: 18, marginBottom: 8 }}>Camera access denied</p>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
          Please allow camera access in your browser settings to use Yomeru.
        </p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div style={overlayStyle}>
        <p style={{ fontSize: 18, marginBottom: 8 }}>Camera unavailable</p>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
          Could not access the camera. Make sure no other app is using it.
        </p>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#000' }}>
      <video
        ref={videoRef}
        playsInline
        muted
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        }}
      />

      {/* Phase indicator - top center */}
      <div style={{
        position: 'absolute',
        top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10,
      }}>
        <PhaseIndicator phase={phase} />
      </div>

      {/* Scan button - bottom center */}
      <div style={{
        position: 'absolute',
        bottom: 'calc(var(--safe-bottom) + 24px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10,
      }}>
        <ScanButton
          onClick={handleScan}
          disabled={status !== 'active' || scanning}
          loading={scanning}
        />
      </div>
    </div>
  )
}

function ScanButton({ onClick, disabled, loading }: {
  onClick: () => void
  disabled: boolean
  loading: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 72,
        height: 72,
        borderRadius: '50%',
        background: loading ? 'rgba(233, 69, 96, 0.5)' : 'var(--accent)',
        boxShadow: loading ? 'none' : '0 0 20px var(--accent-glow)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.2s',
        opacity: disabled && !loading ? 0.4 : 1,
      }}
    >
      {loading ? (
        <div style={{
          width: 28,
          height: 28,
          border: '3px solid rgba(255,255,255,0.3)',
          borderTopColor: '#fff',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
      ) : (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
          {/* Camera/scan icon */}
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <line x1="8" y1="2" x2="8" y2="4" />
          <line x1="16" y1="2" x2="16" y2="4" />
          <line x1="7" y1="9" x2="7" y2="9.01" />
          <line x1="7" y1="12" x2="7" y2="12.01" />
          <line x1="7" y1="15" x2="7" y2="15.01" />
          <rect x="10" y="8" width="8" height="8" rx="1" />
        </svg>
      )}
    </button>
  )
}

const overlayStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  padding: 32,
  textAlign: 'center',
}
