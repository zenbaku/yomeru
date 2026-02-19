/**
 * Image preprocessing pipeline for OCR.
 * Converts camera frames to clean binary images for better Tesseract results.
 *
 * Steps: grayscale → contrast normalization → optional blur → adaptive threshold
 */

export interface PreprocessOptions {
  adaptiveBlockSize?: number  // default 21 (must be odd)
  adaptiveC?: number          // default 10
  blur?: boolean              // default true
}

const DEFAULTS: Required<PreprocessOptions> = {
  adaptiveBlockSize: 21,
  adaptiveC: 10,
  blur: true,
}

export function preprocessFrame(
  imageData: ImageData,
  options?: PreprocessOptions,
): ImageData {
  const opts = { ...DEFAULTS, ...options }
  const { width, height } = imageData

  // Work on a copy
  const src = new Uint8ClampedArray(imageData.data)

  // Step 1: Grayscale (luminance)
  const gray = new Uint8Array(width * height)
  for (let i = 0; i < gray.length; i++) {
    const r = src[i * 4]
    const g = src[i * 4 + 1]
    const b = src[i * 4 + 2]
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
  }

  // Step 2: Contrast normalization (histogram stretch)
  let min = 255, max = 0
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] < min) min = gray[i]
    if (gray[i] > max) max = gray[i]
  }
  const range = max - min
  if (range > 0 && range < 255) {
    const scale = 255 / range
    for (let i = 0; i < gray.length; i++) {
      gray[i] = Math.round((gray[i] - min) * scale)
    }
  }

  // Step 3: Optional Gaussian blur (3x3 kernel)
  let blurred = gray
  if (opts.blur) {
    blurred = gaussianBlur3x3(gray, width, height)
  }

  // Step 4: Adaptive thresholding (mean-based)
  const binary = adaptiveThreshold(blurred, width, height, opts.adaptiveBlockSize, opts.adaptiveC)

  // Convert back to RGBA ImageData
  const out = new ImageData(width, height)
  for (let i = 0; i < binary.length; i++) {
    const v = binary[i]
    out.data[i * 4] = v
    out.data[i * 4 + 1] = v
    out.data[i * 4 + 2] = v
    out.data[i * 4 + 3] = 255
  }

  return out
}

function gaussianBlur3x3(gray: Uint8Array, width: number, height: number): Uint8Array {
  // 3x3 Gaussian kernel (σ ≈ 0.85): [1 2 1; 2 4 2; 1 2 1] / 16
  const out = new Uint8Array(gray.length)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ny = Math.min(Math.max(y + dy, 0), height - 1)
          const nx = Math.min(Math.max(x + dx, 0), width - 1)
          const w = (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1) // center=4, edge=2, corner=1
          sum += gray[ny * width + nx] * w
        }
      }
      out[y * width + x] = (sum + 8) >> 4 // divide by 16 with rounding
    }
  }

  return out
}

function adaptiveThreshold(
  gray: Uint8Array,
  width: number,
  height: number,
  blockSize: number,
  C: number,
): Uint8Array {
  // Use integral image for fast mean computation
  const integral = new Float64Array((width + 1) * (height + 1))

  // Build integral image
  for (let y = 1; y <= height; y++) {
    let rowSum = 0
    for (let x = 1; x <= width; x++) {
      rowSum += gray[(y - 1) * width + (x - 1)]
      integral[y * (width + 1) + x] = rowSum + integral[(y - 1) * (width + 1) + x]
    }
  }

  const half = blockSize >> 1
  const out = new Uint8Array(width * height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const y1 = Math.max(0, y - half)
      const y2 = Math.min(height - 1, y + half)
      const x1 = Math.max(0, x - half)
      const x2 = Math.min(width - 1, x + half)

      const count = (y2 - y1 + 1) * (x2 - x1 + 1)
      const sum =
        integral[(y2 + 1) * (width + 1) + (x2 + 1)]
        - integral[y1 * (width + 1) + (x2 + 1)]
        - integral[(y2 + 1) * (width + 1) + x1]
        + integral[y1 * (width + 1) + x1]

      const mean = sum / count
      out[y * width + x] = gray[y * width + x] < mean - C ? 0 : 255
    }
  }

  return out
}
