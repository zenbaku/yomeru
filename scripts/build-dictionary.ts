/**
 * Downloads jmdict-simplified (English, common-only) from GitHub releases
 * and transforms it into a compact lookup JSON keyed by kanji and kana forms.
 *
 * Usage: npx tsx scripts/build-dictionary.ts
 * Output: public/dict/jmdict-lookup.json
 */

import { writeFileSync, readFileSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'

const RELEASE_API = 'https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest'
const OUT_DIR = join(import.meta.dirname, '..', 'public', 'dict')
const OUT_FILE = join(OUT_DIR, 'jmdict-lookup.json')
const TMP_DIR = '/tmp/yomeru-dict-build'

// Short POS labels for common types
const POS_SHORT: Record<string, string> = {
  'n': 'n',
  'v1': 'v1',
  'v5': 'v5',
  'adj-i': 'adj',
  'adj-na': 'adj',
  'adj-no': 'adj',
  'adv': 'adv',
  'prt': 'prt',
  'conj': 'conj',
  'int': 'int',
  'pref': 'pref',
  'suf': 'suf',
  'exp': 'expr',
  'ctr': 'ctr',
  'pn': 'pron',
  'aux-v': 'aux',
  'aux-adj': 'aux',
  'cop': 'cop',
}

interface JMdictEntry {
  id: string
  kanji: { common: boolean; text: string; tags: string[] }[]
  kana: { common: boolean; text: string; tags: string[]; appliesToKanji: string[] }[]
  sense: {
    partOfSpeech: string[]
    gloss: { lang: string; text: string }[]
    misc: string[]
    field: string[]
  }[]
}

interface JMdictFile {
  version: string
  tags: Record<string, string>
  words: JMdictEntry[]
}

// Compact entry format: [word, reading|"", "gloss1; gloss2", "pos"]
type CompactEntry = [string, string, string, string]

async function main() {
  console.log('Fetching latest release info...')
  const releaseRes = await fetch(RELEASE_API)
  const release = await releaseRes.json() as { assets: { name: string; browser_download_url: string }[] }

  // Use common-only English dictionary (~22K entries, much smaller)
  const asset = release.assets.find(
    (a: { name: string }) => /^jmdict-eng-common-\d/.test(a.name) && a.name.endsWith('.json.tgz')
  )
  if (!asset) {
    throw new Error('Could not find jmdict-eng-common tgz in latest release')
  }

  console.log(`Downloading ${asset.name}...`)
  mkdirSync(TMP_DIR, { recursive: true })
  const tgzPath = join(TMP_DIR, 'jmdict-eng.tgz')
  execSync(`curl -sL "${asset.browser_download_url}" -o "${tgzPath}"`)

  console.log('Extracting...')
  execSync(`tar xzf "${tgzPath}" -C "${TMP_DIR}"`)

  const jsonFile = readdirSync(TMP_DIR).find((f) => f.endsWith('.json'))
  if (!jsonFile) throw new Error('No JSON file found after extraction')
  const jsonPath = join(TMP_DIR, jsonFile)
  console.log(`Reading ${jsonPath}...`)

  const raw: JMdictFile = JSON.parse(readFileSync(jsonPath, 'utf-8'))

  console.log(`Processing ${raw.words.length} entries...`)

  // Build lookup map: key (kanji/kana form) -> CompactEntry[]
  const lookup: Record<string, CompactEntry[]> = {}

  function addEntry(key: string, entry: CompactEntry) {
    if (!lookup[key]) lookup[key] = []
    // Avoid duplicate entries for the same word form
    if (!lookup[key].some((e) => e[0] === entry[0] && e[2] === entry[2])) {
      lookup[key].push(entry)
    }
  }

  for (const word of raw.words) {
    // Collect glosses (max 2 per sense, max 3 total) and POS
    const glosses: string[] = []
    const posLabels: string[] = []

    for (const sense of word.sense) {
      for (const g of sense.gloss) {
        if (glosses.length < 3) glosses.push(g.text)
      }
      for (const p of sense.partOfSpeech) {
        // Use short label, or take first word of the full tag description
        const short = POS_SHORT[p] ?? p.split(' ')[0]
        if (!posLabels.includes(short) && posLabels.length < 2) {
          posLabels.push(short)
        }
      }
    }

    if (glosses.length === 0) continue

    const primaryKana = word.kana[0]?.text ?? ''
    const glossStr = glosses.join('; ')
    const posStr = posLabels.join(', ')

    // Index by each kanji form
    for (const kanji of word.kanji) {
      const entry: CompactEntry = [
        kanji.text,
        primaryKana,
        glossStr,
        posStr,
      ]
      addEntry(kanji.text, entry)
    }

    // Index by each kana form
    for (const kana of word.kana) {
      const entry: CompactEntry = [
        kana.text,
        '',
        glossStr,
        posStr,
      ]
      addEntry(kana.text, entry)
    }
  }

  const keyCount = Object.keys(lookup).length
  console.log(`Built lookup with ${keyCount} keys`)

  mkdirSync(OUT_DIR, { recursive: true })
  const json = JSON.stringify(lookup)
  writeFileSync(OUT_FILE, json)

  const sizeMB = (Buffer.byteLength(json) / 1024 / 1024).toFixed(1)
  console.log(`Written to ${OUT_FILE} (${sizeMB} MB)`)

  // Cleanup
  execSync(`rm -rf "${TMP_DIR}"`)
  console.log('Done!')
}

main().catch((err) => {
  console.error('Build failed:', err)
  process.exit(1)
})
