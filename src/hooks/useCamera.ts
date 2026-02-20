import { useRef, useState, useCallback, useEffect } from 'react'

export type CameraStatus = 'idle' | 'starting' | 'active' | 'denied' | 'error'

/**
 * Choose camera resolution based on device memory.
 * High-res frames (1920x1080 = ~8MB ImageData) cause OOM on low-end devices
 * because the pipeline creates multiple copies during processing.
 */
function getCameraConstraints(): MediaTrackConstraints {
  const mem = (navigator as any).deviceMemory as number | undefined
  // Low-memory devices (≤2GB): use 720p to keep frame buffers manageable
  if (mem !== undefined && mem <= 2) {
    return { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
  }
  return { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
}

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [status, setStatus] = useState<CameraStatus>('idle')
  // Track whether the camera was active before being paused by visibility change
  const wasActiveRef = useRef(false)

  const start = useCallback(async () => {
    if (streamRef.current) return
    setStatus('starting')

    // Pre-check permission state to avoid unnecessary prompts.
    // If the user previously denied, show the denied state immediately
    // instead of triggering the browser prompt again.
    if (navigator.permissions) {
      try {
        const perm = await navigator.permissions.query({ name: 'camera' as PermissionName })
        if (perm.state === 'denied') {
          setStatus('denied')
          return
        }
      } catch {
        // Permissions API not supported for camera in this browser — proceed normally
      }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: getCameraConstraints(),
        audio: false,
      })
      streamRef.current = stream

      // Listen for tracks ending externally (e.g., OS-level revocation)
      for (const track of stream.getTracks()) {
        track.addEventListener('ended', () => {
          streamRef.current = null
          setStatus('idle')
        }, { once: true })
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setStatus('active')
    } catch (err) {
      const name = (err as DOMException).name
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setStatus('denied')
      } else {
        setStatus('error')
      }
    }
  }, [])

  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setStatus('idle')
  }, [])

  const captureFrame = useCallback((): ImageData | null => {
    const video = videoRef.current
    if (!video || video.readyState < 2) return null

    // Reuse a single offscreen canvas to avoid leaking GPU-backed surfaces
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas')
    }
    const canvas = canvasRef.current
    const w = video.videoWidth
    const h = video.videoHeight
    if (w === 0 || h === 0) return null

    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0)
    try {
      return ctx.getImageData(0, 0, w, h)
    } catch {
      return null
    }
  }, [])

  // Pause camera when the app is backgrounded to prevent OS from killing the process.
  // Mobile browsers aggressively reclaim resources from background tabs, and keeping
  // the camera stream alive while hidden is the #1 cause of tab/app crashes.
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.hidden) {
        // App backgrounded — release the camera stream to free memory
        if (streamRef.current) {
          wasActiveRef.current = true
          streamRef.current.getTracks().forEach((t) => t.stop())
          streamRef.current = null
          if (videoRef.current) {
            videoRef.current.srcObject = null
          }
          // Release canvas backing store too
          if (canvasRef.current) {
            canvasRef.current.width = 0
            canvasRef.current.height = 0
          }
        }
      } else {
        // App foregrounded — restart camera if it was active before
        if (wasActiveRef.current) {
          wasActiveRef.current = false
          start()
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [start])

  // Listen for permission changes (e.g., user revokes via browser settings)
  useEffect(() => {
    if (navigator.permissions) {
      navigator.permissions.query({ name: 'camera' as PermissionName }).then((perm) => {
        perm.addEventListener('change', () => {
          if (perm.state === 'denied') {
            // Stop stream and update status
            if (streamRef.current) {
              streamRef.current.getTracks().forEach((t) => t.stop())
              streamRef.current = null
            }
            setStatus('denied')
          } else if (perm.state === 'granted' && !streamRef.current) {
            // Permission re-granted — restart camera automatically
            start()
          }
        })
      }).catch(() => {
        // Permissions API not supported for camera — ignore
      })
    }

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
      }
      // Release canvas backing store
      if (canvasRef.current) {
        canvasRef.current.width = 0
        canvasRef.current.height = 0
        canvasRef.current = null
      }
    }
  }, [start])

  return { videoRef, status, start, stop, captureFrame }
}
