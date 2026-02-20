/**
 * Download a file with progress tracking and cache it.
 * Uses the Cache API so it persists across sessions.
 *
 * Features:
 * - Byte-level progress via ReadableStream
 * - Automatic retry with exponential backoff for transient network errors
 * - Download timeout to avoid silent stalls
 * - Progress clamped to avoid >100% display bugs
 */

/** Classifies download errors so callers can show actionable messages. */
export type DownloadErrorKind = 'offline' | 'network' | 'server' | 'timeout' | 'unknown'

export class DownloadError extends Error {
  kind: DownloadErrorKind
  constructor(message: string, kind: DownloadErrorKind) {
    super(message)
    this.name = 'DownloadError'
    this.kind = kind
  }
}

const MAX_RETRIES = 3
const RETRY_BASE_MS = 1000
const DOWNLOAD_TIMEOUT_MS = 120_000 // 2 minutes per file

function classifyError(err: unknown): DownloadErrorKind {
  if (!navigator.onLine) return 'offline'
  if (err instanceof DOMException && err.name === 'AbortError') return 'timeout'
  if (err instanceof TypeError) return 'network' // fetch network failure
  return 'unknown'
}

function friendlyMessage(kind: DownloadErrorKind, url?: string): string {
  const file = url ? url.split('/').pop() : 'file'
  switch (kind) {
    case 'offline':
      return 'You appear to be offline. Please check your internet connection and try again.'
    case 'network':
      return `Network error while downloading ${file}. Please check your connection and try again.`
    case 'server':
      return `Server returned an error while downloading ${file}. Please try again later.`
    case 'timeout':
      return `Download of ${file} timed out. Please check your connection speed and try again.`
    case 'unknown':
      return `An unexpected error occurred while downloading ${file}. Please try again.`
  }
}

async function fetchWithRetry(
  url: string,
  timeout: number,
): Promise<Response> {
  let lastError: unknown

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Wait before retry (not on first attempt)
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, RETRY_BASE_MS * 2 ** (attempt - 1)))
    }

    // Check online status before attempting
    if (!navigator.onLine) {
      throw new DownloadError(
        friendlyMessage('offline', url),
        'offline',
      )
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)

    try {
      const response = await fetch(url, { signal: controller.signal })
      clearTimeout(timer)

      if (!response.ok) {
        // Server errors (5xx) are retryable; client errors (4xx) are not
        if (response.status >= 500 && attempt < MAX_RETRIES) {
          lastError = new Error(`HTTP ${response.status}`)
          continue
        }
        throw new DownloadError(
          friendlyMessage('server', url),
          'server',
        )
      }

      return response
    } catch (err) {
      clearTimeout(timer)
      if (err instanceof DownloadError) throw err

      lastError = err
      const kind = classifyError(err)

      // Don't retry if offline or on last attempt
      if (kind === 'offline' || attempt === MAX_RETRIES) {
        throw new DownloadError(friendlyMessage(kind, url), kind)
      }
    }
  }

  // Should not reach here, but just in case
  const kind = classifyError(lastError)
  throw new DownloadError(friendlyMessage(kind, url), kind)
}

export async function downloadWithProgress(
  url: string,
  cacheName: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  const cache = await caches.open(cacheName)

  // Check if already cached
  const cached = await cache.match(url)
  if (cached) return

  const response = await fetchWithRetry(url, DOWNLOAD_TIMEOUT_MS)

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
    // Clamp loaded to contentLength to prevent >100% progress when
    // actual bytes exceed Content-Length (e.g. transfer-encoding mismatch)
    onProgress?.(Math.min(loaded, contentLength), contentLength)
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
