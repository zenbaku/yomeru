import { useRef, useState, useCallback, useEffect } from 'react'

export type CameraStatus = 'idle' | 'starting' | 'active' | 'denied' | 'error'

/**
 * Choose camera resolution and frame rate based on device memory.
 *
 * IMPORTANT: navigator.deviceMemory is only available in Chromium browsers.
 * iOS Safari and Firefox always return undefined — so the old code that only
 * branched on `mem <= 2` was silently giving ALL iPhones and Firefox users
 * 1080p with no frame rate cap, causing OOM kills during idle camera preview.
 *
 * We now default to 720p + capped frame rate unless the device explicitly
 * reports ample memory (≥4 GB).  720p is sufficient for OCR and halves the
 * per-frame memory vs 1080p (~3.7 MB vs ~8.3 MB).
 */
function getCameraConstraints(): MediaTrackConstraints {
  const mem = (navigator as { deviceMemory?: number }).deviceMemory

  // Only upgrade to 1080p when the device explicitly reports ample memory.
  if (mem !== undefined && mem >= 4) {
    return {
      facingMode: 'environment',
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 20, max: 30 },
    }
  }

  // Default: 720p + capped frame rate.
  // Covers iOS (no deviceMemory API), Firefox, and low-memory Chromium.
  return {
    facingMode: 'environment',
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 20, max: 24 },
  }
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
      const frame = ctx.getImageData(0, 0, w, h)
      // Release the GPU-backed canvas buffer immediately — it can be
      // 3-8 MB and there's no reason to keep it between scans.
      canvas.width = 0
      canvas.height = 0
      return frame
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
