import type { OCRLine } from './types.ts'

// --- Configurable thresholds ---

export const OCR_CONFIDENCE_THRESHOLD = 60

export const MIN_BBOX_WIDTH = 20
export const MIN_BBOX_HEIGHT = 10
export const MIN_BBOX_AREA = 300
export const MAX_ASPECT_RATIO = 30
export const MIN_ASPECT_RATIO = 0.03

export const OVERLAP_THRESHOLD = 0.7

// --- Japanese text detection ---

const KANJI_RE = /[\u4e00-\u9faf\u3400-\u4dbf]/
const KANA_RE = /[\u3040-\u309f\u30a0-\u30ff]/g
const JUNK_RE = /^[\s\p{P}\p{S}\d\x00-\x7f]+$/u

/** Returns true if the text contains meaningful Japanese content */
function hasJapaneseContent(text: string): boolean {
  // Keep if it has at least one kanji
  if (KANJI_RE.test(text)) return true
  // Keep if it has at least two kana characters
  const kanaMatches = text.match(KANA_RE)
  if (kanaMatches && kanaMatches.length >= 2) return true
  return false
}

// --- Filter functions ---

export function filterByConfidence(lines: OCRLine[], threshold = OCR_CONFIDENCE_THRESHOLD): OCRLine[] {
  return lines.filter((l) => l.confidence >= threshold)
}

export function filterByContent(lines: OCRLine[]): OCRLine[] {
  return lines.filter((l) => {
    const text = l.text.trim()
    if (text.length === 0) return false
    // Drop lines that are only punctuation/symbols/ASCII
    if (JUNK_RE.test(text)) return false
    // Must have meaningful Japanese content
    return hasJapaneseContent(text)
  })
}

export function filterBySize(lines: OCRLine[]): OCRLine[] {
  return lines.filter((l) => {
    const { width, height } = l.bbox
    if (width < MIN_BBOX_WIDTH || height < MIN_BBOX_HEIGHT) return false
    if (width * height < MIN_BBOX_AREA) return false
    const aspect = width / height
    if (aspect > MAX_ASPECT_RATIO || aspect < MIN_ASPECT_RATIO) return false
    return true
  })
}

function bboxOverlapRatio(a: OCRLine, b: OCRLine): number {
  const ax1 = a.bbox.x, ay1 = a.bbox.y
  const ax2 = ax1 + a.bbox.width, ay2 = ay1 + a.bbox.height
  const bx1 = b.bbox.x, by1 = b.bbox.y
  const bx2 = bx1 + b.bbox.width, by2 = by1 + b.bbox.height

  const ix1 = Math.max(ax1, bx1), iy1 = Math.max(ay1, by1)
  const ix2 = Math.min(ax2, bx2), iy2 = Math.min(ay2, by2)

  if (ix1 >= ix2 || iy1 >= iy2) return 0

  const intersection = (ix2 - ix1) * (iy2 - iy1)
  const areaA = a.bbox.width * a.bbox.height
  const areaB = b.bbox.width * b.bbox.height
  const smaller = Math.min(areaA, areaB)

  return smaller > 0 ? intersection / smaller : 0
}

export function filterOverlapping(lines: OCRLine[], threshold = OVERLAP_THRESHOLD): OCRLine[] {
  // Sort by confidence descending — keep higher-confidence lines
  const sorted = [...lines].sort((a, b) => b.confidence - a.confidence)
  const kept: OCRLine[] = []

  for (const line of sorted) {
    const dominated = kept.some((k) => bboxOverlapRatio(line, k) > threshold)
    if (!dominated) kept.push(line)
  }

  return kept
}

// --- Line merging ---

export function mergeAdjacentLines(lines: OCRLine[], maxGap = 10, minHOverlap = 0.5): OCRLine[] {
  if (lines.length <= 1) return lines

  // Sort top-to-bottom, then left-to-right
  const sorted = [...lines].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)
  const merged: OCRLine[] = []
  const used = new Set<number>()

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue

    let current = sorted[i]
    used.add(i)

    // Try to merge subsequent lines into current
    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue

      const next = sorted[j]
      const currentBottom = current.bbox.y + current.bbox.height
      const vertGap = next.bbox.y - currentBottom

      // Must be vertically adjacent (within maxGap)
      if (vertGap > maxGap) continue
      if (vertGap < -current.bbox.height * 0.5) continue // too much vertical overlap = same line, skip

      // Check horizontal overlap
      const overlapLeft = Math.max(current.bbox.x, next.bbox.x)
      const overlapRight = Math.min(current.bbox.x + current.bbox.width, next.bbox.x + next.bbox.width)
      const overlap = Math.max(0, overlapRight - overlapLeft)
      const minWidth = Math.min(current.bbox.width, next.bbox.width)

      if (minWidth > 0 && overlap / minWidth >= minHOverlap) {
        // Merge: expand bbox to encompass both
        const x = Math.min(current.bbox.x, next.bbox.x)
        const y = Math.min(current.bbox.y, next.bbox.y)
        const x2 = Math.max(current.bbox.x + current.bbox.width, next.bbox.x + next.bbox.width)
        const y2 = Math.max(currentBottom, next.bbox.y + next.bbox.height)

        current = {
          text: current.text + '\n' + next.text,
          confidence: Math.min(current.confidence, next.confidence),
          bbox: { x, y, width: x2 - x, height: y2 - y },
        }
        used.add(j)
      }
    }

    merged.push(current)
  }

  return merged
}

// --- Combined filter pipeline ---

export function filterOCRLines(lines: OCRLine[]): OCRLine[] {
  let filtered = filterByConfidence(lines)
  filtered = filterByContent(filtered)
  filtered = filterBySize(filtered)
  filtered = filterOverlapping(filtered)
  filtered = mergeAdjacentLines(filtered)
  return filtered
}
