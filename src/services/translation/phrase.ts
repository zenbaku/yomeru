const API_URL = 'https://api.mymemory.translated.net/get'

/**
 * Translate a full Japanese phrase/sentence to English using MyMemory API.
 * Free tier: 1000 words/day without API key.
 * Returns null if the API is unavailable (e.g. offline).
 */
export async function translatePhrase(text: string): Promise<string | null> {
  if (!text.trim()) return null

  try {
    const params = new URLSearchParams({
      q: text,
      langpair: 'ja|en',
    })

    const res = await fetch(`${API_URL}?${params}`, {
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) return null

    const data = await res.json()

    if (data.responseStatus !== 200) return null

    const translated: string = data.responseData?.translatedText
    if (!translated) return null

    // MyMemory sometimes echoes back the input when it can't translate
    if (translated === text) return null

    return translated
  } catch {
    // Network error, timeout, or offline — silently fail
    return null
  }
}
