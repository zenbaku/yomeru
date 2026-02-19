/**
 * Image preprocessing pipeline for OCR.
 * Converts camera frames to clean binary images for better Tesseract results.
 *
 * Steps: grayscale → [auto-detect] → contrast normalization → median (opt)
 *        → bilinear upscale (opt) → blur (opt) → adaptive threshold → despeckle (opt)
 *
 * When `auto` is true (default), the pipeline analyzes the image and
 * automatically enables median filtering for noisy images and upscaling
 * for small images. This removes the need to manually select presets.
 */

export interface PreprocessOptions {
  adaptiveBlockSize?: number  // default 21 (must be odd)
  adaptiveC?: number          // default 10
  blur?: boolean              // default true
  median?: boolean            // default false — 3x3 median filter for salt-and-pepper noise
  morphOpen?: boolean         // default false — despeckle to remove isolated noise from binary output
  upscale?: number            // default 1 — bilinear upscale factor (2 = 2x, 3 = 3x)
  auto?: boolean              // default true — auto-detect noise & size, overrides median/upscale/morphOpen
}

export interface ImageAnalysis {
  noiseLevel: number           // fraction of sampled pixels deviating >30 from local median (0–1)
  isNoisy: boolean             // noiseLevel > NOISE_THRESHOLD
  recommendedUpscale: number   // computed upscale factor based on image dimensions
  recommendedMedian: boolean
  recommendedDespeckle: boolean
}

const NOISE_THRESHOLD = 0.05  // 5% of pixels deviating from local median = noisy
const MIN_DIM_FOR_OCR = 400   // Tesseract needs text at least ~30px; target min dimension

const DEFAULTS: Required<PreprocessOptions> = {
  adaptiveBlockSize: 21,
  adaptiveC: 10,
  blur: true,
  median: false,
  morphOpen: false,
  upscale: 1,
  auto: true,
}

export function preprocessFrame(
  imageData: ImageData,
  options?: PreprocessOptions,
): ImageData {
  const opts = { ...DEFAULTS, ...options }
  const { width, height, data: src } = imageData

  // Step 1: Grayscale (luminance) — read directly from input, no copy needed
  const gray = new Uint8Array(width * height)
  for (let i = 0; i < gray.length; i++) {
    const r = src[i * 4]
    const g = src[i * 4 + 1]
    const b = src[i * 4 + 2]
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
  }

  // Auto-detection: analyze raw grayscale before normalization changes values
  if (opts.auto) {
    const noise = estimateNoiseLevel(gray, width, height)
    if (noise > NOISE_THRESHOLD) {
      opts.median = true
      opts.morphOpen = true
    }
    const autoScale = computeAutoUpscale(width, height)
    if (autoScale > opts.upscale) {
      opts.upscale = autoScale
      opts.morphOpen = true // despeckle helps after upscale
    }
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

  // Step 3: Optional median filter (3x3) at NATIVE resolution —
  // most effective here because noise is single-pixel at original scale
  let cur = gray
  if (opts.median) cur = medianFilter3x3(cur, width, height)

  // Step 4: Optional bilinear upscale — runs AFTER median (noise removed)
  // but BEFORE blur (so thin strokes are widened before blur smears them)
  const scale = Math.max(1, Math.round(opts.upscale))
  let finalW = width
  let finalH = height
  if (scale > 1) {
    finalW = width * scale
    finalH = height * scale
    cur = bilinearUpscale(cur, width, height, finalW, finalH)
  }

  // Step 5: Optional Gaussian blur (3x3 kernel) — on upscaled image where strokes are wider
  if (opts.blur) cur = gaussianBlur3x3(cur, finalW, finalH)

  // Step 6: Adaptive thresholding (mean-based)
  const thresholded = adaptiveThreshold(cur, finalW, finalH, opts.adaptiveBlockSize, opts.adaptiveC)

  // Step 7: Optional despeckle — remove isolated black pixels (< 2 neighbors)
  const binary = opts.morphOpen ? despeckle(thresholded, finalW, finalH) : thresholded

  // Convert back to RGBA ImageData
  const out = new ImageData(finalW, finalH)
  for (let i = 0; i < binary.length; i++) {
    const v = binary[i]
    out.data[i * 4] = v
    out.data[i * 4 + 1] = v
    out.data[i * 4 + 2] = v
    out.data[i * 4 + 3] = 255
  }

  return out
}

/**
 * Analyze an image and return recommended preprocessing settings.
 * Useful for inspecting what auto-detection would decide.
 */
export function analyzeImage(imageData: ImageData): ImageAnalysis {
  const { width, height, data: src } = imageData
  const gray = new Uint8Array(width * height)
  for (let i = 0; i < gray.length; i++) {
    gray[i] = Math.round(0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2])
  }

  const noiseLevel = estimateNoiseLevel(gray, width, height)
  const isNoisy = noiseLevel > NOISE_THRESHOLD
  const recommendedUpscale = computeAutoUpscale(width, height)

  return {
    noiseLevel,
    isNoisy,
    recommendedUpscale,
    recommendedMedian: isNoisy,
    recommendedDespeckle: isNoisy || recommendedUpscale > 1,
  }
}

/**
 * Estimate noise level by comparing sampled pixels to their local 3x3 median.
 * Returns the fraction (0–1) of sampled pixels whose value deviates more than
 * 30 intensity levels from the neighborhood median (typical of salt-and-pepper noise).
 */
function estimateNoiseLevel(gray: Uint8Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 0

  const step = 2 // sample every 2nd pixel in each direction
  let outlierCount = 0
  let sampleCount = 0
  const buf = new Uint8Array(9)

  for (let y = 1; y < height - 1; y += step) {
    for (let x = 1; x < width - 1; x += step) {
      // Gather 3x3 neighborhood
      let k = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          buf[k++] = gray[(y + dy) * width + (x + dx)]
        }
      }
      // Partial sort to find median (5th of 9)
      for (let i = 0; i < 5; i++) {
        let minIdx = i
        for (let j = i + 1; j < 9; j++) {
          if (buf[j] < buf[minIdx]) minIdx = j
        }
        if (minIdx !== i) {
          const tmp = buf[i]
          buf[i] = buf[minIdx]
          buf[minIdx] = tmp
        }
      }
      const diff = Math.abs(gray[y * width + x] - buf[4])
      if (diff > 30) outlierCount++
      sampleCount++
    }
  }

  return sampleCount > 0 ? outlierCount / sampleCount : 0
}

/**
 * Compute an upscale factor that brings the image's shorter dimension
 * up to at least MIN_DIM_FOR_OCR pixels. Capped at 4x.
 */
function computeAutoUpscale(width: number, height: number): number {
  const minDim = Math.min(width, height)
  if (minDim >= MIN_DIM_FOR_OCR) return 1
  return Math.min(Math.ceil(MIN_DIM_FOR_OCR / minDim), 4)
}

function medianFilter3x3(gray: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(gray.length)
  const buf = new Uint8Array(9) // 3x3 neighborhood

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let k = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ny = Math.min(Math.max(y + dy, 0), height - 1)
          const nx = Math.min(Math.max(x + dx, 0), width - 1)
          buf[k++] = gray[ny * width + nx]
        }
      }
      // Partial sort to find median (5th element of 9)
      // Using a sorting network for 9 elements is fastest at this scale
      for (let i = 0; i < 5; i++) {
        let minIdx = i
        for (let j = i + 1; j < 9; j++) {
          if (buf[j] < buf[minIdx]) minIdx = j
        }
        if (minIdx !== i) {
          const tmp = buf[i]
          buf[i] = buf[minIdx]
          buf[minIdx] = tmp
        }
      }
      out[y * width + x] = buf[4]
    }
  }

  return out
}

/**
 * Despeckle a binary image (values 0 or 255).
 * Removes isolated black pixels that have fewer than 2 black neighbors
 * out of the 8-connected neighborhood. This is much gentler than
 * morphological opening — it preserves thin text strokes (which have
 * 2+ neighbors) while removing truly isolated noise dots.
 */
function despeckle(binary: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(binary)
  const MIN_NEIGHBORS = 2 // need at least 2 black neighbors to survive

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      if (binary[idx] !== 0) continue // only check black pixels

      // Count black neighbors in 8-connected neighborhood
      let count = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dy === 0 && dx === 0) continue
          const ny = y + dy
          const nx = x + dx
          if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
            if (binary[ny * width + nx] === 0) count++
          }
        }
      }

      if (count < MIN_NEIGHBORS) {
        out[idx] = 255 // remove isolated pixel
      }
    }
  }

  return out
}

function bilinearUpscale(
  gray: Uint8Array, srcW: number, srcH: number, dstW: number, dstH: number,
): Uint8Array {
  const out = new Uint8Array(dstW * dstH)

  for (let y = 0; y < dstH; y++) {
    // Map destination pixel to source coordinate
    const srcY = (y + 0.5) * srcH / dstH - 0.5
    const y0 = Math.max(0, srcY | 0)
    const y1 = Math.min(srcH - 1, y0 + 1)
    const fy = srcY - y0

    for (let x = 0; x < dstW; x++) {
      const srcX = (x + 0.5) * srcW / dstW - 0.5
      const x0 = Math.max(0, srcX | 0)
      const x1 = Math.min(srcW - 1, x0 + 1)
      const fx = srcX - x0

      // Bilinear interpolation
      const v =
        gray[y0 * srcW + x0] * (1 - fx) * (1 - fy) +
        gray[y0 * srcW + x1] * fx * (1 - fy) +
        gray[y1 * srcW + x0] * (1 - fx) * fy +
        gray[y1 * srcW + x1] * fx * fy

      out[y * dstW + x] = Math.round(v)
    }
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
  // Use integral image for fast mean computation.
  // Float32 is sufficient: max block sum ≈ 441*255 = 112K, well within Float32 integer precision.
  const integral = new Float32Array((width + 1) * (height + 1))

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
