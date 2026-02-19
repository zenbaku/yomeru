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
  const json: Record<string, [string, string, string, string][]> = await res.json()

  const keys = Object.keys(json)
  const total = keys.length
  const BATCH_SIZE = 2000

  // Load in batches to avoid blocking
  for (let i = 0; i < total; i += BATCH_SIZE) {
    const tx = db.transaction('dictionary', 'readwrite')
    const batch = keys.slice(i, i + BATCH_SIZE)
    for (const key of batch) {
      tx.store.put(json[key], key)
    }
    await tx.done
    onProgress?.(Math.min(i + BATCH_SIZE, total), total)
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

export async function clearDictionary(): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['dictionary', 'meta'], 'readwrite')
  tx.objectStore('dictionary').clear()
  tx.objectStore('meta').delete('dict-loaded')
  await tx.done
}
