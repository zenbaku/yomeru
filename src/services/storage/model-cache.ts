/**
 * Download a file with progress tracking and cache it.
 * Uses the Cache API so it persists across sessions.
 */
export async function downloadWithProgress(
  url: string,
  cacheName: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Response> {
  const cache = await caches.open(cacheName)

  // Check if already cached
  const cached = await cache.match(url)
  if (cached) return cached

  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`)

  const contentLength = Number(response.headers.get('content-length') ?? 0)
  const reader = response.body?.getReader()

  if (!reader || !contentLength) {
    // No streaming support — just cache directly
    const clone = response.clone()
    await cache.put(url, clone)
    return response
  }

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
  const cachedResponse = new Response(blob, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
  await cache.put(url, cachedResponse.clone())
  return cachedResponse
}

export async function isCached(url: string, cacheName: string): Promise<boolean> {
  const cache = await caches.open(cacheName)
  const match = await cache.match(url)
  return match !== undefined
}
