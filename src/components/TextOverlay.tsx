import { useRef, useEffect } from 'react'
import type { OCRResult } from '../services/ocr/types.ts'

interface TextOverlayProps {
  ocrResult: OCRResult | null
  imageSize: { width: number; height: number } | null
  translated: boolean
}

export function TextOverlay({ ocrResult, imageSize, translated }: TextOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !ocrResult || !imageSize) return

    const ctx = canvas.getContext('2d')!
    const rect = canvas.getBoundingClientRect()

    canvas.width = rect.width * devicePixelRatio
    canvas.height = rect.height * devicePixelRatio
    ctx.scale(devicePixelRatio, devicePixelRatio)

    ctx.clearRect(0, 0, rect.width, rect.height)

    const scaleX = rect.width / imageSize.width
    const scaleY = rect.height / imageSize.height

    const borderColor = translated ? '#4cd964' : '#f5a623'

    for (const line of ocrResult.lines) {
      const { x, y, width, height } = line.bbox
      const sx = x * scaleX
      const sy = y * scaleY
      const sw = width * scaleX
      const sh = height * scaleY

      // Semi-transparent background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
      ctx.fillRect(sx, sy, sw, sh)

      // Border
      ctx.strokeStyle = borderColor
      ctx.lineWidth = 2
      ctx.strokeRect(sx, sy, sw, sh)

      // Text
      const fontSize = Math.max(10, Math.min(sh * 0.7, 16))
      ctx.font = `${fontSize}px -apple-system, sans-serif`
      ctx.fillStyle = '#fff'
      ctx.textBaseline = 'middle'
      ctx.fillText(line.text, sx + 4, sy + sh / 2, sw - 8)
    }
  }, [ocrResult, imageSize, translated])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    />
  )
}
