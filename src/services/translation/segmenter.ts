import TinySegmenter from 'tiny-segmenter'

const segmenter = new TinySegmenter()

/**
 * Segments Japanese text into individual words/tokens.
 * Filters out whitespace-only segments.
 */
export function segment(text: string): string[] {
  return segmenter.segment(text).filter((s) => s.trim().length > 0)
}
