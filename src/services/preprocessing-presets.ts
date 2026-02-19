/**
 * Parameter presets for different scanning scenarios.
 *
 * Each preset tunes both the image preprocessing and the OCR
 * filtering stages for a particular kind of source image.
 */

export interface PipelineParams {
  // Preprocessing
  auto: boolean
  adaptiveBlockSize: number
  adaptiveC: number
  blur: boolean
  median: boolean
  morphOpen: boolean
  upscale: number

  // OCR filtering
  minConfidence: number
  minRegionArea: number
  maxAspectRatio: number

  // Content filtering
  requireJapanese: boolean
  minCharacters: number
}

export const PRESETS: Record<string, PipelineParams> = {
  auto: {
    // Auto-detect noise and size — works for any image type
    auto: true,
    adaptiveBlockSize: 21,
    adaptiveC: 10,
    blur: true,
    median: false,       // auto will enable if noisy
    morphOpen: false,    // auto will enable if needed
    upscale: 1,          // auto will increase if small
    minConfidence: 40,   // moderate — auto handles varied inputs
    minRegionArea: 200,
    maxAspectRatio: 30,
    requireJapanese: true,
    minCharacters: 1,
  },
  default: {
    auto: false,
    adaptiveBlockSize: 21,
    adaptiveC: 10,
    blur: true,
    median: false,
    morphOpen: false,
    upscale: 1,
    minConfidence: 60,
    minRegionArea: 300,
    maxAspectRatio: 30,
    requireJapanese: true,
    minCharacters: 2,
  },
  noisy: {
    // For images with salt-and-pepper noise or sensor noise
    auto: false,
    adaptiveBlockSize: 21,
    adaptiveC: 10,
    blur: true,
    median: true,            // median filter removes impulse noise
    morphOpen: true,         // despeckle removes remaining dots after threshold
    upscale: 2,              // upscale small images for better OCR
    minConfidence: 5,        // very low — let content filter (requireJapanese) do the work
    minRegionArea: 100,      // lower for small/noisy images
    maxAspectRatio: 30,
    requireJapanese: true,
    minCharacters: 1,
  },
  reflective: {
    // For metallic/glass surfaces
    auto: false,
    adaptiveBlockSize: 31,  // larger block to handle reflections
    adaptiveC: 15,          // higher C to ignore gradual gradients
    blur: true,
    median: false,
    morphOpen: false,
    upscale: 1,
    minConfidence: 50,      // lower threshold since these are harder
    minRegionArea: 500,
    maxAspectRatio: 30,
    requireJapanese: true,
    minCharacters: 2,
  },
  highContrast: {
    // For printed menus, clear signs
    auto: false,
    adaptiveBlockSize: 15,
    adaptiveC: 8,
    blur: false,
    median: false,
    morphOpen: false,
    upscale: 1,
    minConfidence: 70,
    minRegionArea: 200,
    maxAspectRatio: 30,
    requireJapanese: true,
    minCharacters: 2,
  },
  dimLight: {
    // For dark restaurants, izakaya
    auto: false,
    adaptiveBlockSize: 25,
    adaptiveC: 5,           // lower C to preserve more detail in dark images
    blur: true,
    median: false,
    morphOpen: false,
    upscale: 1,
    minConfidence: 45,
    minRegionArea: 400,
    maxAspectRatio: 30,
    requireJapanese: true,
    minCharacters: 2,
  },
} as const
