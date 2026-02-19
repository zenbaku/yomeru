import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { segment } from '@/services/translation/segmenter.ts'
import { filterOCRLines } from '@/services/ocr/filters.ts'
import type { OCRLine } from '@/services/ocr/types.ts'
import { preprocessFrame } from '@/services/preprocessing.ts'
import {
  listSyntheticFixtures,
  loadFixtureMeta,
  loadFixtureImage,
  type FixtureMeta,
} from './helpers.ts'

// ---------------------------------------------------------------------------
// Load dictionary JSON directly (bypass IndexedDB)
// ---------------------------------------------------------------------------

type CompactEntry = [string, string, string, string]

let dictCache: Record<string, CompactEntry[]> | null = null

function loadDict(): Record<string, CompactEntry[]> {
  if (dictCache) return dictCache
  const dictPath = resolve(__dirname, '../public/dict/jmdict-lookup.json')
  dictCache = JSON.parse(readFileSync(dictPath, 'utf-8'))
  return dictCache!
}

function lookupDirect(word: string): CompactEntry[] | undefined {
  return loadDict()[word]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const syntheticFixtures = listSyntheticFixtures()

function loadSyntheticMeta(name: string): FixtureMeta & { groundTruth: NonNullable<FixtureMeta['groundTruth']> } {
  const meta = loadFixtureMeta(name)
  if (!meta?.groundTruth) throw new Error(`Missing groundTruth for fixture: ${name}`)
  return meta as FixtureMeta & { groundTruth: NonNullable<FixtureMeta['groundTruth']> }
}

function makeLine(
  text: string,
  confidence: number,
  bbox = { x: 0, y: 0, width: 200, height: 30 },
): OCRLine {
  return { text, confidence, bbox }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('synthetic fixtures', () => {
  it('should have at least one synthetic fixture', () => {
    expect(syntheticFixtures.length).toBeGreaterThan(0)
  })

  // -- Metadata validation --------------------------------------------------

  describe('metadata validation', () => {
    for (const name of syntheticFixtures) {
      it(`"${name}" should have complete ground truth schema`, () => {
        const meta = loadFixtureMeta(name)!
        expect(meta.synthetic).toBe(true)

        // Ground truth required fields
        expect(meta.groundTruth).toBeDefined()
        const gt = meta.groundTruth!
        expect(Array.isArray(gt.lines)).toBe(true)
        expect(gt.lines.length).toBeGreaterThan(0)
        expect(Array.isArray(gt.segmentation)).toBe(true)
        expect(gt.segmentation.length).toBe(gt.lines.length)
        expect(Array.isArray(gt.translations)).toBe(true)

        // Each translation entry has required shape
        for (const t of gt.translations) {
          expect(t).toHaveProperty('original')
          expect(t).toHaveProperty('reading')
          expect(Array.isArray(t.translations)).toBe(true)
          expect(t).toHaveProperty('partOfSpeech')
        }

        // Generation params
        expect(meta.generationParams).toBeDefined()
        const gp = meta.generationParams!
        expect(gp.fontSize).toBeGreaterThan(0)
        expect(gp.width).toBeGreaterThan(0)
        expect(gp.height).toBeGreaterThan(0)
        expect(typeof gp.font).toBe('string')
        expect(typeof gp.variant).toBe('string')
      })
    }
  })

  // -- Segmentation ---------------------------------------------------------

  describe('segmentation', () => {
    for (const name of syntheticFixtures) {
      it(`"${name}" segmentation matches ground truth`, () => {
        const meta = loadSyntheticMeta(name)
        const gt = meta.groundTruth

        // Re-segment each line and compare to stored ground truth
        for (let i = 0; i < gt.lines.length; i++) {
          const actual = segment(gt.lines[i])
          expect(actual).toEqual(gt.segmentation[i])
        }
      })
    }
  })

  // -- OCR filter preservation ----------------------------------------------

  describe('OCR filter preservation', () => {
    // Pick one variant per fixture id (e.g. the "clean" variant)
    const cleanFixtures = syntheticFixtures.filter((n) => n.endsWith('-clean'))

    for (const name of cleanFixtures) {
      it(`"${name}" Japanese text survives filterOCRLines`, () => {
        const meta = loadSyntheticMeta(name)
        const gt = meta.groundTruth

        // Build mock OCRLines from ground truth text (one per line)
        const mockLines: OCRLine[] = gt.lines.map((text, i) =>
          makeLine(text, 0.95, {
            x: 10,
            y: 10 + i * 40,
            width: 200,
            height: 30,
          }),
        )

        const filtered = filterOCRLines(mockLines)

        // All ground truth text should survive filtering (possibly merged)
        const filteredText = filtered.map((l) => l.text).join('\n')
        for (const line of gt.lines) {
          // stripNonJapanese removes non-Japanese chars, so filter expected text too
          const japaneseOnly = line.replace(/[^\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf\u3400-\u4dbf\uff00-\uffef\u30fc]/g, '')
          if (japaneseOnly.length > 0) {
            expect(filteredText).toContain(japaneseOnly)
          }
        }
      })
    }
  })

  // -- Dictionary translation -----------------------------------------------

  describe('dictionary translation', () => {
    const cleanFixtures = syntheticFixtures.filter((n) => n.endsWith('-clean'))

    for (const name of cleanFixtures) {
      it(`"${name}" ground truth translations match JMdict`, () => {
        const meta = loadSyntheticMeta(name)
        const gt = meta.groundTruth

        for (const entry of gt.translations) {
          const dictEntries = lookupDirect(entry.original)
          if (entry.translations.length > 0) {
            // Entry claims to have translations — verify they exist in dictionary
            expect(dictEntries).toBeDefined()
            expect(dictEntries!.length).toBeGreaterThan(0)
            const [word, reading, glossStr, pos] = dictEntries![0]
            expect(word).toBe(entry.original)
            expect(reading).toBe(entry.reading)
            expect(glossStr.split('; ')).toEqual(entry.translations)
            expect(pos).toBe(entry.partOfSpeech)
          } else {
            // Entry has no translations — segment wasn't found in dictionary
            // That's fine, just verify it's actually missing
            expect(dictEntries).toBeUndefined()
          }
        }
      })
    }
  })

  // -- Preprocessing (conditional on PNGs existing) -------------------------

  describe('preprocessing', () => {
    const cleanFixtures = syntheticFixtures.filter((n) => n.endsWith('-clean'))

    for (const name of cleanFixtures) {
      it(`"${name}" preprocesses to binary output`, () => {
        const imageData = loadFixtureImage(name)
        if (!imageData) {
          // Skip if PNG doesn't exist (not yet generated)
          return
        }

        // Use auto: false to keep dimensions predictable for assertions
        const output = preprocessFrame(imageData, { auto: false })

        // Output should be same dimensions
        expect(output.width).toBe(imageData.width)
        expect(output.height).toBe(imageData.height)

        // Output should be binary (0 or 255 only)
        for (let i = 0; i < output.data.length; i += 4) {
          const r = output.data[i]
          expect(r === 0 || r === 255).toBe(true)
          expect(output.data[i + 1]).toBe(r)
          expect(output.data[i + 2]).toBe(r)
          expect(output.data[i + 3]).toBe(255)
        }
      })
    }

    // Noisy variants should also preprocess cleanly
    const noisyFixtures = syntheticFixtures.filter((n) => n.endsWith('-noisy'))

    for (const name of noisyFixtures) {
      it(`"${name}" preprocesses noisy input to binary output`, () => {
        const imageData = loadFixtureImage(name)
        if (!imageData) return

        // Use auto: false to keep dimensions predictable for assertions
        const output = preprocessFrame(imageData, { auto: false })
        expect(output.width).toBe(imageData.width)
        expect(output.height).toBe(imageData.height)

        // Should still be binary
        for (let i = 0; i < output.data.length; i += 4) {
          const r = output.data[i]
          expect(r === 0 || r === 255).toBe(true)
        }
      })
    }
  })
})
