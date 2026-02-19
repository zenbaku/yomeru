import { describe, it, expect } from 'vitest'
import { preprocessFrame } from '@/services/preprocessing.ts'
import type { PreprocessOptions } from '@/services/preprocessing.ts'
import {
  filterByConfidence,
  filterByContent,
  filterBySize,
  filterOverlapping,
  mergeAdjacentLines,
  filterOCRLines,
  stripNonJapanese,
} from '@/services/ocr/filters.ts'
import type { OCRLine } from '@/services/ocr/types.ts'
import { segment } from '@/services/translation/segmenter.ts'
import { PRESETS } from '@/services/preprocessing-presets.ts'
import {
  createImageData,
  createTextLikeImage,
  listFixtures,
  loadFixtureMeta,
} from './helpers.ts'

// ---- Preprocessing tests ----

describe('preprocessing', () => {
  it('should return an ImageData of the same dimensions', () => {
    const input = createImageData(100, 80)
    const output = preprocessFrame(input)
    expect(output.width).toBe(100)
    expect(output.height).toBe(80)
    expect(output.data.length).toBe(100 * 80 * 4)
  })

  it('should produce a binary image (only black and white pixels)', () => {
    const input = createTextLikeImage(200, 100)
    const output = preprocessFrame(input)

    for (let i = 0; i < output.data.length; i += 4) {
      const r = output.data[i]
      const g = output.data[i + 1]
      const b = output.data[i + 2]
      // Each channel should be either 0 or 255
      expect(r === 0 || r === 255).toBe(true)
      expect(g).toBe(r)
      expect(b).toBe(r)
      // Alpha should be 255
      expect(output.data[i + 3]).toBe(255)
    }
  })

  it('should preserve text-like regions as dark on light', () => {
    const input = createTextLikeImage(200, 100)
    const output = preprocessFrame(input)

    // The center of the image (where the "text" stripe is) should have
    // a significant number of black pixels
    let blackPixels = 0
    let totalCenter = 0
    const y1 = Math.floor(100 * 0.4)
    const y2 = Math.floor(100 * 0.6)
    const x1 = Math.floor(200 * 0.2)
    const x2 = Math.floor(200 * 0.8)

    for (let y = y1; y < y2; y++) {
      for (let x = x1; x < x2; x++) {
        totalCenter++
        if (output.data[(y * 200 + x) * 4] === 0) blackPixels++
      }
    }

    // At least 30% of the center region should be black (text)
    expect(blackPixels / totalCenter).toBeGreaterThan(0.3)
  })

  it('should accept custom options without errors', () => {
    const input = createImageData(50, 50)
    const opts: PreprocessOptions = {
      adaptiveBlockSize: 31,
      adaptiveC: 15,
      blur: false,
    }
    const output = preprocessFrame(input, opts)
    expect(output.width).toBe(50)
    expect(output.height).toBe(50)
  })

  it('should produce different output with different block sizes', () => {
    const input = createTextLikeImage(200, 100)
    const out1 = preprocessFrame(input, { adaptiveBlockSize: 11 })
    const out2 = preprocessFrame(input, { adaptiveBlockSize: 41 })

    // The outputs should differ in at least some pixels
    let diffCount = 0
    for (let i = 0; i < out1.data.length; i += 4) {
      if (out1.data[i] !== out2.data[i]) diffCount++
    }
    // With a text-like image and very different block sizes, we expect some difference
    expect(diffCount).toBeGreaterThan(0)
  })

  it('should not crash on a 1x1 image', () => {
    const input = createImageData(1, 1)
    const output = preprocessFrame(input)
    expect(output.width).toBe(1)
    expect(output.height).toBe(1)
  })

  it('should handle all-white input gracefully', () => {
    const input = createImageData(50, 50, [255, 255, 255, 255])
    const output = preprocessFrame(input)
    // All-white should threshold to all-white (since every pixel == mean)
    for (let i = 0; i < output.data.length; i += 4) {
      expect(output.data[i]).toBe(255)
    }
  })

  it('should handle all-black input gracefully', () => {
    const input = createImageData(50, 50, [0, 0, 0, 255])
    const output = preprocessFrame(input)
    // All-black, after normalization range=0, threshold produces all-white
    // (since pixel == mean and is NOT < mean - C)
    for (let i = 0; i < output.data.length; i += 4) {
      expect(output.data[i]).toBe(255)
    }
  })
})

// ---- OCR filter tests ----

describe('ocr filters', () => {
  const makeLine = (
    text: string,
    confidence: number,
    bbox = { x: 0, y: 0, width: 100, height: 30 },
  ): OCRLine => ({ text, confidence, bbox })

  describe('filterByConfidence', () => {
    it('should remove lines below threshold', () => {
      const lines = [
        makeLine('高い', 90),
        makeLine('低い', 40),
        makeLine('中', 60),
      ]
      const result = filterByConfidence(lines, 60)
      expect(result).toHaveLength(2)
      expect(result.map((l) => l.text)).toEqual(['高い', '中'])
    })

    it('should include lines exactly at threshold', () => {
      const lines = [makeLine('ちょうど', 60)]
      expect(filterByConfidence(lines, 60)).toHaveLength(1)
    })
  })

  describe('filterByContent', () => {
    it('should keep lines with kanji', () => {
      const lines = [makeLine('漢字', 90)]
      expect(filterByContent(lines)).toHaveLength(1)
    })

    it('should keep lines with 2+ kana', () => {
      const lines = [makeLine('かな', 90)]
      expect(filterByContent(lines)).toHaveLength(1)
    })

    it('should reject pure ASCII', () => {
      const lines = [makeLine('hello', 90)]
      expect(filterByContent(lines)).toHaveLength(0)
    })

    it('should reject pure punctuation', () => {
      const lines = [makeLine('...!!!', 90)]
      expect(filterByContent(lines)).toHaveLength(0)
    })

    it('should reject single kana', () => {
      const lines = [makeLine('あ', 90)]
      expect(filterByContent(lines)).toHaveLength(0)
    })

    it('should reject empty strings', () => {
      const lines = [makeLine('', 90)]
      expect(filterByContent(lines)).toHaveLength(0)
    })
  })

  describe('filterBySize', () => {
    it('should reject tiny bounding boxes', () => {
      const lines = [
        makeLine('小さい', 90, { x: 0, y: 0, width: 5, height: 5 }),
      ]
      expect(filterBySize(lines)).toHaveLength(0)
    })

    it('should accept normal-sized bounding boxes', () => {
      const lines = [
        makeLine('普通', 90, { x: 0, y: 0, width: 100, height: 30 }),
      ]
      expect(filterBySize(lines)).toHaveLength(1)
    })

    it('should reject extreme aspect ratios', () => {
      const lines = [
        makeLine('細い', 90, { x: 0, y: 0, width: 1000, height: 1 }),
      ]
      expect(filterBySize(lines)).toHaveLength(0)
    })
  })

  describe('filterOverlapping', () => {
    it('should keep non-overlapping lines', () => {
      const lines = [
        makeLine('一', 90, { x: 0, y: 0, width: 50, height: 30 }),
        makeLine('二', 85, { x: 100, y: 0, width: 50, height: 30 }),
      ]
      expect(filterOverlapping(lines)).toHaveLength(2)
    })

    it('should remove dominated overlapping lines', () => {
      const lines = [
        makeLine('強い', 90, { x: 0, y: 0, width: 100, height: 30 }),
        makeLine('弱い', 70, { x: 5, y: 2, width: 90, height: 26 }),
      ]
      const result = filterOverlapping(lines)
      expect(result).toHaveLength(1)
      expect(result[0].text).toBe('強い')
    })
  })

  describe('mergeAdjacentLines', () => {
    it('should merge vertically adjacent lines with horizontal overlap', () => {
      const lines = [
        makeLine('上', 90, { x: 10, y: 10, width: 100, height: 20 }),
        makeLine('下', 85, { x: 10, y: 32, width: 100, height: 20 }),
      ]
      const result = mergeAdjacentLines(lines)
      expect(result).toHaveLength(1)
      expect(result[0].text).toBe('上\n下')
    })

    it('should not merge distant lines', () => {
      const lines = [
        makeLine('遠い一', 90, { x: 10, y: 10, width: 100, height: 20 }),
        makeLine('遠い二', 85, { x: 10, y: 200, width: 100, height: 20 }),
      ]
      expect(mergeAdjacentLines(lines)).toHaveLength(2)
    })
  })

  describe('stripNonJapanese', () => {
    it('should strip English characters from mixed text', () => {
      const lines = [
        makeLine('Exit 非常口 Emergency', 90),
      ]
      const result = stripNonJapanese(lines)
      expect(result).toHaveLength(1)
      expect(result[0].text).toBe('非常口')
    })

    it('should keep pure Japanese text unchanged', () => {
      const lines = [makeLine('日本語テスト', 90)]
      const result = stripNonJapanese(lines)
      expect(result[0].text).toBe('日本語テスト')
    })

    it('should drop lines that become empty after stripping', () => {
      const lines = [makeLine('Hello World', 90)]
      const result = stripNonJapanese(lines)
      expect(result).toHaveLength(0)
    })

    it('should keep katakana and hiragana', () => {
      const lines = [makeLine('カタカナ ひらがな ABC', 90)]
      const result = stripNonJapanese(lines)
      expect(result[0].text).toBe('カタカナひらがな')
    })

    it('should keep CJK punctuation', () => {
      const lines = [makeLine('「日本語」。', 90)]
      const result = stripNonJapanese(lines)
      expect(result[0].text).toBe('「日本語」。')
    })
  })

  describe('filterOCRLines (combined pipeline)', () => {
    it('should apply all filters in sequence', () => {
      const lines: OCRLine[] = [
        makeLine('日本語テスト', 90, { x: 0, y: 0, width: 200, height: 30 }),
        makeLine('noise', 30, { x: 0, y: 50, width: 200, height: 30 }),
        makeLine('...', 90, { x: 0, y: 100, width: 200, height: 30 }),
        makeLine('小', 90, { x: 0, y: 150, width: 3, height: 3 }),
      ]
      const result = filterOCRLines(lines)
      expect(result).toHaveLength(1)
      expect(result[0].text).toBe('日本語テスト')
    })
  })
})

// ---- Segmentation tests ----

describe('segmentation', () => {
  it('should segment Japanese text into tokens', () => {
    const tokens = segment('東京は大きい')
    expect(tokens.length).toBeGreaterThan(1)
    expect(tokens.join('')).toBe('東京は大きい')
  })

  it('should handle empty input', () => {
    const tokens = segment('')
    expect(tokens).toHaveLength(0)
  })

  it('should filter whitespace-only segments', () => {
    const tokens = segment('東京 は')
    expect(tokens.every((t) => t.trim().length > 0)).toBe(true)
  })
})

// ---- Presets validation ----

describe('preprocessing presets', () => {
  it('should have all required fields in every preset', () => {
    const requiredKeys: (keyof typeof PRESETS.default)[] = [
      'adaptiveBlockSize',
      'adaptiveC',
      'blur',
      'minConfidence',
      'minRegionArea',
      'maxAspectRatio',
      'requireJapanese',
      'minCharacters',
    ]

    for (const [name, preset] of Object.entries(PRESETS)) {
      for (const key of requiredKeys) {
        expect(preset).toHaveProperty(key)
      }
      // Block size must be odd
      expect(preset.adaptiveBlockSize % 2).toBe(1)
      // Confidence in valid range
      expect(preset.minConfidence).toBeGreaterThanOrEqual(0)
      expect(preset.minConfidence).toBeLessThanOrEqual(100)
      // Area must be positive
      expect(preset.minRegionArea).toBeGreaterThan(0)

      // Log for debugging
      void name
    }
  })
})

// ---- Fixture regression tests ----

describe('fixture metadata', () => {
  const fixtureNames = listFixtures()

  it('should have at least one fixture defined', () => {
    expect(fixtureNames.length).toBeGreaterThan(0)
  })

  for (const name of fixtureNames) {
    it(`fixture "${name}" should have valid metadata`, () => {
      const meta = loadFixtureMeta(name)
      expect(meta).not.toBeNull()
      expect(meta!.description).toBeTruthy()
      expect(Array.isArray(meta!.expectedText)).toBe(true)
      expect(['easy', 'medium', 'hard']).toContain(meta!.difficulty)
    })
  }
})
