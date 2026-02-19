import { useState, useRef, useCallback, useEffect } from 'react'

interface Props {
  onCapture: (imageData: ImageData, objectUrl: string) => void
}

export function CameraCapture({ onCapture }: Props) {
  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const startCamera = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
      setActive(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Camera unavailable')
    }
  }, [])

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setActive(false)
  }, [])

  const capture = useCallback(() => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(video, 0, 0)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

    // Create an object URL for display
    canvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob)
        onCapture(imageData, url)
      }
    })

    stopCamera()
  }, [onCapture, stopCamera])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  if (!active) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <button onClick={startCamera} style={buttonStyle}>
          Camera
        </button>
        {error && <span style={{ color: '#e94560', fontSize: 13 }}>{error}</span>}
      </div>
    )
  }

  return (
    <div style={overlayStyle}>
      <div style={containerStyle}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={videoStyle}
        />
        <div style={controlsStyle}>
          <button onClick={capture} style={captureButtonStyle}>
            Capture
          </button>
          <button onClick={stopCamera} style={cancelButtonStyle}>
            Cancel
          </button>
        </div>
        <div style={hintStyle}>
          Point your camera at Japanese text, then click Capture
        </div>
      </div>
    </div>
  )
}

const buttonStyle: React.CSSProperties = {
  background: '#0f3460',
  color: '#e8e8e8',
  border: '1px solid #16213e',
  borderRadius: 6,
  padding: '8px 16px',
  fontSize: 14,
  cursor: 'pointer',
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.92)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 16,
  maxWidth: '90vw',
  maxHeight: '90vh',
}

const videoStyle: React.CSSProperties = {
  maxWidth: '80vw',
  maxHeight: '70vh',
  borderRadius: 8,
  border: '2px solid #0f3460',
}

const controlsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 12,
}

const captureButtonStyle: React.CSSProperties = {
  background: '#e94560',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  padding: '12px 32px',
  fontSize: 16,
  fontWeight: 600,
  cursor: 'pointer',
}

const cancelButtonStyle: React.CSSProperties = {
  background: 'transparent',
  color: '#a0a0b0',
  border: '1px solid #a0a0b0',
  borderRadius: 8,
  padding: '12px 24px',
  fontSize: 16,
  cursor: 'pointer',
}

const hintStyle: React.CSSProperties = {
  color: '#a0a0b0',
  fontSize: 14,
}
