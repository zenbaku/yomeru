import type { TranslationModel, TranslationResult } from './types.ts'
import { segment } from './segmenter.ts'
import {
  isDictionaryLoaded,
  loadDictionaryFromJSON,
  lookupWords,
  clearDictionary,
} from '../storage/indexeddb.ts'

export const jmdictModel: TranslationModel = {
  id: 'jmdict-common',
  name: 'JMdict (Common)',
  description: 'Japanese-English dictionary with ~22K common entries',
  size: 4_200_000, // ~4.2MB

  async isDownloaded() {
    return isDictionaryLoaded()
  },

  async initialize(onProgress) {
    if (await isDictionaryLoaded()) return
    await loadDictionaryFromJSON((loaded, total) => {
      onProgress?.(loaded / total)
    })
  },

  async translate(text: string): Promise<TranslationResult[]> {
    const segments = segment(text)

    // Batch all lookups into a single IndexedDB transaction instead of
    // one transaction per segment. On mobile this reduces IDB overhead
    // from ~2-5ms × N segments to a single ~2-5ms round-trip.
    const uniqueKeys = [...new Set(segments)]
    const lookupMap = await lookupWords(uniqueKeys)

    return segments.map((seg) => {
      const entries = lookupMap.get(seg)
      if (entries && entries.length > 0) {
        const [word, reading, glossStr, pos] = entries[0]
        return {
          original: word,
          reading: reading || '',
          translations: glossStr.split('; '),
          partOfSpeech: pos,
        }
      }
      return {
        original: seg,
        reading: '',
        translations: [],
        partOfSpeech: '',
      }
    })
  },

  async terminate() {
    // Nothing to clean up — IndexedDB persists
  },

  async clearCache() {
    await clearDictionary()
  },
}
