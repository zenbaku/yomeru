/**
 * Download / copy test fixture images into tests/fixtures/.
 *
 * Usage:
 *   npx tsx tests/download-fixtures.ts <url-or-path> [url-or-path...]
 *
 * Each source is downloaded (if URL) or copied (if local path) into the
 * fixtures directory.  A companion .meta.json sidecar is created with
 * placeholder values if one doesn't already exist.
 */

import { copyFileSync, existsSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const FIXTURES_DIR = resolve(import.meta.dirname!, 'fixtures')

interface FixtureMeta {
  description: string
  expectedText: string[]
  difficulty: 'easy' | 'medium' | 'hard'
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  if (!res.body) throw new Error(`Empty body from ${url}`)

  const nodeStream = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream)
  const out = new Writable({
    write(chunk, _encoding, cb) {
      try {
        const { appendFileSync } = require('node:fs') as typeof import('node:fs')
        appendFileSync(dest, chunk)
        cb()
      } catch (e) {
        cb(e as Error)
      }
    },
  })

  // Ensure file is empty before streaming
  writeFileSync(dest, '')
  await pipeline(nodeStream, out)
}

function createPlaceholderMeta(metaPath: string, name: string): void {
  if (existsSync(metaPath)) return

  const meta: FixtureMeta = {
    description: `Test fixture: ${name}`,
    expectedText: [],
    difficulty: 'medium',
  }
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n')
  console.log(`  Created ${basename(metaPath)}`)
}

async function addFixture(source: string): Promise<void> {
  const isUrl = source.startsWith('http://') || source.startsWith('https://')
  const name = basename(isUrl ? new URL(source).pathname : source)
  const dest = resolve(FIXTURES_DIR, name)
  const metaPath = dest.replace(/\.[^.]+$/, '') + '.meta.json'

  console.log(`\nProcessing: ${source}`)

  if (isUrl) {
    console.log(`  Downloading to ${name}...`)
    await downloadFile(source, dest)
  } else {
    const absSource = resolve(source)
    if (!existsSync(absSource)) {
      console.error(`  ERROR: File not found: ${absSource}`)
      return
    }
    console.log(`  Copying to ${name}...`)
    copyFileSync(absSource, dest)
  }

  createPlaceholderMeta(metaPath, name)
  console.log(`  Done: ${dest}`)
}

// --- Main ---

const args = process.argv.slice(2)

if (args.length === 0) {
  console.log('Usage: npx tsx tests/download-fixtures.ts <url-or-path> [url-or-path...]')
  console.log('')
  console.log('Downloads or copies images into tests/fixtures/ and creates')
  console.log('placeholder .meta.json sidecar files.')
  process.exit(0)
}

for (const arg of args) {
  await addFixture(arg)
}

console.log('\nAll fixtures processed.')
