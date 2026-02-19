/**
 * Download a file with progress tracking and cache it.
 * Uses the Cache API so it persists across sessions.
 */
export async function downloadWithProgress(
  url: string,
  cacheName: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  const cache = await caches.open(cacheName)

  // Check if already cached
  const cached = await cache.match(url)
  if (cached) return

  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`)

  const contentLength = Number(response.headers.get('content-length') ?? 0)

  if (!contentLength || !response.body) {
    // No content-length or no readable stream — cache directly without progress
    await cache.put(url, response)
    return
  }

  // Only acquire the reader AFTER deciding we need streaming (locks the body)
  const reader = response.body.getReader()

  const chunks: Uint8Array[] = []
  let loaded = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    onProgress?.(loaded, contentLength)
  }

  // Reconstruct the response and cache it
  const blob = new Blob(chunks as BlobPart[])
  await cache.put(url, new Response(blob, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  }))
}

export async function isCached(url: string, cacheName: string): Promise<boolean> {
  const cache = await caches.open(cacheName)
  const match = await cache.match(url)
  return match !== undefined
}
