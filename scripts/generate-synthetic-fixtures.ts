/**
 * Generate synthetic test fixture images with known Japanese text.
 *
 * Renders Japanese text onto PNG images using node-canvas, then writes
 * ground truth metadata (segmentation, dictionary translations) alongside
 * each image so tests can validate the pipeline without running OCR.
 *
 * Usage: npx tsx scripts/generate-synthetic-fixtures.ts
 */

import { createCanvas, type Canvas } from 'canvas'
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import TinySegmenter from 'tiny-segmenter'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const FIXTURES_DIR = resolve(__dirname, '../tests/fixtures')

interface FixtureSpec {
  id: string
  text: string
  difficulty: 'easy' | 'medium' | 'hard'
  description: string
}

const FIXTURES: FixtureSpec[] = [
  { id: 'emergency-exit', text: '非常口', difficulty: 'easy', description: 'Emergency exit sign — 3 kanji compound' },
  { id: 'exit', text: '出口', difficulty: 'easy', description: 'Exit — 2 kanji compound' },
  { id: 'ramen', text: 'ラーメン', difficulty: 'easy', description: 'Ramen — katakana' },
  { id: 'tokyo-station', text: '東京駅', difficulty: 'easy', description: 'Tokyo station — 3 kanji compound' },
  { id: 'water', text: 'お水', difficulty: 'easy', description: 'Water — hiragana prefix + kanji' },
  { id: 'menu-multiline', text: 'ラーメン\n餃子', difficulty: 'medium', description: 'Multi-line menu — katakana + kanji' },
  { id: 'business-hours', text: '営業時間', difficulty: 'medium', description: 'Business hours — 4 kanji compound' },
]

interface VariantSpec {
  name: string
  fontSize: number
  fg: string
  bg: string
  noise: number
}

const VARIANTS: VariantSpec[] = [
  { name: 'clean', fontSize: 32, fg: '#000000', bg: '#ffffff', noise: 0 },
  { name: 'large', fontSize: 48, fg: '#000000', bg: '#ffffff', noise: 0 },
  { name: 'small', fontSize: 18, fg: '#000000', bg: '#ffffff', noise: 0 },
  { name: 'noisy', fontSize: 32, fg: '#000000', bg: '#ffffff', noise: 0.05 },
]

// ---------------------------------------------------------------------------
// Font detection
// ---------------------------------------------------------------------------

/** macOS and Linux Japanese font candidates */
const FONT_CANDIDATES = [
  'Hiragino Sans',
  'Hiragino Kaku Gothic Pro',
  'Hiragino Kaku Gothic ProN',
  'Noto Sans CJK JP',
  'Noto Sans JP',
  'IPAGothic',
  'TakaoGothic',
]

function detectJapaneseFont(): string {
  // Try each candidate: render a known kanji and compare against a known-missing glyph
  const testChar = '漢' // common kanji
  const fallbackChar = 'A'

  for (const fontFamily of FONT_CANDIDATES) {
    if (canRenderJapanese(fontFamily, testChar, fallbackChar)) {
      return fontFamily
    }
  }

  // Last resort: try the default 'sans-serif' and hope the system maps to a CJK font
  if (canRenderJapanese('sans-serif', testChar, fallbackChar)) {
    return 'sans-serif'
  }

  throw new Error(
    'No Japanese font found. Install one of: ' + FONT_CANDIDATES.join(', '),
  )
}

function canRenderJapanese(fontFamily: string, japaneseChar: string, asciiChar: string): boolean {
  try {
    const size = 24
    const canvas = createCanvas(size * 2, size * 2)
    const ctx = canvas.getContext('2d')
    ctx.font = `${size}px "${fontFamily}"`

    // Render Japanese character
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(japaneseChar, 2, size + 2)
    const jpData = ctx.getImageData(0, 0, canvas.width, canvas.height).data

    // Count white pixels for Japanese char
    let jpWhite = 0
    for (let i = 0; i < jpData.length; i += 4) {
      if (jpData[i] > 128) jpWhite++
    }

    // Render ASCII character on fresh canvas
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(asciiChar, 2, size + 2)
    const asciiData = ctx.getImageData(0, 0, canvas.width, canvas.height).data

    let asciiWhite = 0
    for (let i = 0; i < asciiData.length; i += 4) {
      if (asciiData[i] > 128) asciiWhite++
    }

    // If the Japanese char rendered something visible and different from ASCII, the font works
    // A tofu/missing glyph box typically has fewer white pixels than an actual rendered glyph,
    // OR the Japanese glyph should differ from ASCII in pixel count
    return jpWhite > 10 && jpWhite !== asciiWhite
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Ground truth computation
// ---------------------------------------------------------------------------

type CompactEntry = [string, string, string, string]

let dictCache: Record<string, CompactEntry[]> | null = null

function loadDictionary(): Record<string, CompactEntry[]> {
  if (dictCache) return dictCache
  const dictPath = resolve(__dirname, '../public/dict/jmdict-lookup.json')
  dictCache = JSON.parse(readFileSync(dictPath, 'utf-8'))
  return dictCache!
}

const segmenter = new TinySegmenter()

function computeSegmentation(text: string): string[][] {
  // Split by newlines (multi-line text), then segment each line
  const lines = text.split('\n')
  return lines.map((line) =>
    segmenter.segment(line).filter((s: string) => s.trim().length > 0),
  )
}

interface TranslationEntry {
  original: string
  reading: string
  translations: string[]
  partOfSpeech: string
}

function computeTranslations(text: string): TranslationEntry[] {
  const dict = loadDictionary()
  const lines = text.split('\n')
  const results: TranslationEntry[] = []

  for (const line of lines) {
    const segments = segmenter.segment(line).filter((s: string) => s.trim().length > 0)
    for (const seg of segments) {
      const entries = dict[seg]
      if (entries && entries.length > 0) {
        const [word, reading, glossStr, pos] = entries[0]
        results.push({
          original: word,
          reading: reading || '',
          translations: glossStr.split('; '),
          partOfSpeech: pos,
        })
      } else {
        results.push({
          original: seg,
          reading: '',
          translations: [],
          partOfSpeech: '',
        })
      }
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// Image rendering
// ---------------------------------------------------------------------------

function renderFixture(
  text: string,
  font: string,
  variant: VariantSpec,
): { canvas: Canvas; width: number; height: number } {
  const { fontSize, fg, bg } = variant
  const lines = text.split('\n')
  const padding = Math.round(fontSize * 0.5)

  // Measure text dimensions
  const measureCanvas = createCanvas(1, 1)
  const measureCtx = measureCanvas.getContext('2d')
  measureCtx.font = `${fontSize}px "${font}"`

  let maxWidth = 0
  const lineMetrics: { width: number }[] = []
  for (const line of lines) {
    const m = measureCtx.measureText(line)
    lineMetrics.push({ width: m.width })
    if (m.width > maxWidth) maxWidth = m.width
  }

  const lineHeight = Math.round(fontSize * 1.4)
  const width = Math.round(maxWidth + padding * 2)
  const height = Math.round(lines.length * lineHeight + padding * 2)

  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')

  // Background
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, width, height)

  // Text
  ctx.fillStyle = fg
  ctx.font = `${fontSize}px "${font}"`
  ctx.textBaseline = 'top'

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], padding, padding + i * lineHeight)
  }

  // Salt-and-pepper noise
  if (variant.noise > 0) {
    const imageData = ctx.getImageData(0, 0, width, height)
    const data = imageData.data
    for (let i = 0; i < data.length; i += 4) {
      if (Math.random() < variant.noise) {
        const v = Math.random() > 0.5 ? 255 : 0
        data[i] = v
        data[i + 1] = v
        data[i + 2] = v
      }
    }
    ctx.putImageData(imageData, 0, 0)
  }

  return { canvas, width, height }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  mkdirSync(FIXTURES_DIR, { recursive: true })

  console.log('Detecting Japanese font...')
  const font = detectJapaneseFont()
  console.log(`  Using font: ${font}`)

  // Validate: render a test glyph and check it's not tofu
  console.log('  Validating Japanese glyph rendering...')
  const testCanvas = createCanvas(64, 64)
  const testCtx = testCanvas.getContext('2d')
  testCtx.font = `32px "${font}"`
  testCtx.fillStyle = '#000000'
  testCtx.fillRect(0, 0, 64, 64)
  testCtx.fillStyle = '#ffffff'
  testCtx.fillText('漢', 8, 40)
  const testData = testCtx.getImageData(0, 0, 64, 64).data
  let whitePixels = 0
  for (let i = 0; i < testData.length; i += 4) {
    if (testData[i] > 128) whitePixels++
  }
  if (whitePixels < 20) {
    console.error('  WARNING: Font may not render Japanese glyphs correctly.')
    console.error('  Continuing anyway, but inspect generated PNGs.')
  } else {
    console.log('  Font validation passed.')
  }

  console.log('\nLoading JMdict...')
  loadDictionary()
  console.log('  Dictionary loaded.')

  let generated = 0

  for (const fixture of FIXTURES) {
    for (const variant of VARIANTS) {
      const baseName = `synthetic-${fixture.id}-${variant.name}`
      const pngPath = resolve(FIXTURES_DIR, `${baseName}.png`)
      const metaPath = resolve(FIXTURES_DIR, `${baseName}.meta.json`)

      // Render image
      const { canvas, width, height } = renderFixture(fixture.text, font, variant)
      const pngBuffer = canvas.toBuffer('image/png')
      writeFileSync(pngPath, pngBuffer)

      // Compute ground truth
      const lines = fixture.text.split('\n')
      const segmentation = computeSegmentation(fixture.text)
      const translations = computeTranslations(fixture.text)

      const meta = {
        description: `${fixture.description} [${variant.name}]`,
        expectedText: lines,
        difficulty: fixture.difficulty,
        synthetic: true,
        groundTruth: {
          lines,
          segmentation,
          translations,
        },
        generationParams: {
          font,
          fontSize: variant.fontSize,
          fg: variant.fg,
          bg: variant.bg,
          noise: variant.noise,
          width,
          height,
          variant: variant.name,
        },
      }

      writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n')
      generated++
      console.log(`  ${baseName} (${width}x${height})`)
    }
  }

  console.log(`\nGenerated ${generated} fixtures in ${FIXTURES_DIR}`)
}

main()
