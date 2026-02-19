/**
 * Parameter presets for different scanning scenarios.
 *
 * Each preset tunes both the image preprocessing and the OCR
 * filtering stages for a particular kind of source image.
 */

export interface PipelineParams {
  // Preprocessing
  adaptiveBlockSize: number
  adaptiveC: number
  blur: boolean

  // OCR filtering
  minConfidence: number
  minRegionArea: number
  maxAspectRatio: number

  // Content filtering
  requireJapanese: boolean
  minCharacters: number
}

export const PRESETS: Record<string, PipelineParams> = {
  default: {
    adaptiveBlockSize: 21,
    adaptiveC: 10,
    blur: true,
    minConfidence: 60,
    minRegionArea: 300,
    maxAspectRatio: 30,
    requireJapanese: true,
    minCharacters: 2,
  },
  reflective: {
    // For metallic/glass surfaces
    adaptiveBlockSize: 31,  // larger block to handle reflections
    adaptiveC: 15,          // higher C to ignore gradual gradients
    blur: true,
    minConfidence: 50,      // lower threshold since these are harder
    minRegionArea: 500,
    maxAspectRatio: 30,
    requireJapanese: true,
    minCharacters: 2,
  },
  highContrast: {
    // For printed menus, clear signs
    adaptiveBlockSize: 15,
    adaptiveC: 8,
    blur: false,
    minConfidence: 70,
    minRegionArea: 200,
    maxAspectRatio: 30,
    requireJapanese: true,
    minCharacters: 2,
  },
  dimLight: {
    // For dark restaurants, izakaya
    adaptiveBlockSize: 25,
    adaptiveC: 5,           // lower C to preserve more detail in dark images
    blur: true,
    minConfidence: 45,
    minRegionArea: 400,
    maxAspectRatio: 30,
    requireJapanese: true,
    minCharacters: 2,
  },
} as const
