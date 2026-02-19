import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, basename } from 'node:path'

const FIXTURES_DIR = resolve(__dirname, 'fixtures')

export interface FixtureMeta {
  description: string
  expectedText: string[]
  difficulty: 'easy' | 'medium' | 'hard'
}

/**
 * Create a synthetic ImageData from a solid color.
 * Useful for tests that don't need a real photo.
 */
export function createImageData(
  width: number,
  height: number,
  fillRGBA: [number, number, number, number] = [128, 128, 128, 255],
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = fillRGBA[0]
    data[i * 4 + 1] = fillRGBA[1]
    data[i * 4 + 2] = fillRGBA[2]
    data[i * 4 + 3] = fillRGBA[3]
  }
  return new ImageData(data, width, height)
}

/**
 * Create an ImageData with a simple black-text-on-white pattern.
 * Draws a horizontal stripe of black pixels to simulate text.
 */
export function createTextLikeImage(
  width: number,
  height: number,
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  // Fill white
  data.fill(255)

  // Draw a band of black pixels in the middle third to simulate text
  const y1 = Math.floor(height * 0.35)
  const y2 = Math.floor(height * 0.65)
  const x1 = Math.floor(width * 0.1)
  const x2 = Math.floor(width * 0.9)

  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      const i = (y * width + x) * 4
      data[i] = 0      // R
      data[i + 1] = 0  // G
      data[i + 2] = 0  // B
      // Alpha already 255
    }
  }

  return new ImageData(data, width, height)
}

/**
 * Load a fixture's metadata JSON.
 */
export function loadFixtureMeta(name: string): FixtureMeta | null {
  const metaPath = resolve(FIXTURES_DIR, `${name}.meta.json`)
  if (!existsSync(metaPath)) return null
  return JSON.parse(readFileSync(metaPath, 'utf-8')) as FixtureMeta
}

/**
 * List all fixture names (based on .meta.json files).
 */
export function listFixtures(): string[] {
  if (!existsSync(FIXTURES_DIR)) return []
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.meta.json'))
    .map((f) => basename(f, '.meta.json'))
}

/**
 * Check if a fixture image file exists (tries common extensions).
 */
export function fixtureImageExists(name: string): string | null {
  const extensions = ['.jpg', '.jpeg', '.png', '.webp']
  for (const ext of extensions) {
    const p = resolve(FIXTURES_DIR, `${name}${ext}`)
    if (existsSync(p)) return p
  }
  return null
}
