import { openDB, type IDBPDatabase } from 'idb'

interface YomeruDB {
  dictionary: {
    key: string
    value: [string, string, string, string][] // CompactEntry[]
  }
  meta: {
    key: string
    value: unknown
  }
}

let dbPromise: Promise<IDBPDatabase<YomeruDB>> | null = null

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<YomeruDB>('yomeru-db', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('dictionary')) {
          db.createObjectStore('dictionary')
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta')
        }
      },
    })
  }
  return dbPromise
}

export async function isDictionaryLoaded(): Promise<boolean> {
  const db = await getDB()
  const val = await db.get('meta', 'dict-loaded')
  return val === true
}

export async function loadDictionaryFromJSON(
  onProgress?: (loaded: number, total: number) => void
): Promise<void> {
  const db = await getDB()

  // Check if already loaded
  if (await isDictionaryLoaded()) return

  // Fetch the dictionary JSON
  const res = await fetch('/dict/jmdict-lookup.json')
  if (!res.ok) {
    throw new Error(`Failed to fetch dictionary: HTTP ${res.status}`)
  }
  const json: Record<string, [string, string, string, string][]> = await res.json()

  const keys = Object.keys(json)
  const total = keys.length
  const BATCH_SIZE = 2000

  // Load in batches to avoid blocking.
  // If a batch fails (e.g. QuotaExceededError), clear the partial data so the
  // next attempt starts fresh rather than leaving an incomplete dictionary.
  try {
    for (let i = 0; i < total; i += BATCH_SIZE) {
      const tx = db.transaction('dictionary', 'readwrite')
      const batch = keys.slice(i, i + BATCH_SIZE)
      for (const key of batch) {
        tx.store.put(json[key], key)
      }
      await tx.done
      onProgress?.(Math.min(i + BATCH_SIZE, total), total)
    }
  } catch (err) {
    // Clean up partial data so the dictionary isn't left half-loaded
    try {
      const cleanupTx = db.transaction(['dictionary', 'meta'], 'readwrite')
      cleanupTx.objectStore('dictionary').clear()
      cleanupTx.objectStore('meta').delete('dict-loaded')
      await cleanupTx.done
    } catch {
      // If cleanup also fails, the DB may be in a bad state —
      // isDictionaryLoaded() will return false and the next attempt can retry.
    }

    const isQuota = err instanceof DOMException &&
      (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED')
    if (isQuota) {
      throw new Error('Not enough storage space to load the dictionary. Try freeing up space on your device.')
    }
    throw err
  }

  // Mark as loaded
  const metaTx = db.transaction('meta', 'readwrite')
  await metaTx.store.put(true, 'dict-loaded')
  await metaTx.done
}

export type CompactEntry = [string, string, string, string]

export async function lookupWord(key: string): Promise<CompactEntry[] | undefined> {
  const db = await getDB()
  return db.get('dictionary', key)
}

/**
 * Batch lookup: fetch multiple keys in a single IndexedDB read transaction.
 * Much faster than sequential lookupWord() calls — one transaction round-trip
 * instead of N, which matters on mobile where IDB latency is 2-5ms per tx.
 */
export async function lookupWords(keys: string[]): Promise<Map<string, CompactEntry[]>> {
  const db = await getDB()
  const tx = db.transaction('dictionary', 'readonly')
  const promises = keys.map((key) => tx.store.get(key).then((val) => [key, val] as const))
  const entries = await Promise.all(promises)
  const results = new Map<string, CompactEntry[]>()
  for (const [key, val] of entries) {
    if (val) results.set(key, val)
  }
  return results
}

export async function clearDictionary(): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['dictionary', 'meta'], 'readwrite')
  tx.objectStore('dictionary').clear()
  tx.objectStore('meta').delete('dict-loaded')
  await tx.done
}
