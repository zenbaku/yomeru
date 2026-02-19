import type { TranslationModel, TranslationResult } from './types.ts'
import { segment } from './segmenter.ts'
import {
  isDictionaryLoaded,
  loadDictionaryFromJSON,
  lookupWord,
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
    const results: TranslationResult[] = []

    for (const seg of segments) {
      const entries = await lookupWord(seg)

      if (entries && entries.length > 0) {
        // Use first (most relevant) entry
        const [word, reading, glossStr, pos] = entries[0]
        results.push({
          original: word,
          reading: reading || '',
          translations: glossStr.split('; '),
          partOfSpeech: pos,
        })
      } else {
        // No dictionary match — show the segment as-is
        results.push({
          original: seg,
          reading: '',
          translations: [],
          partOfSpeech: '',
        })
      }
    }

    return results
  },

  async terminate() {
    // Nothing to clean up — IndexedDB persists
  },
}
