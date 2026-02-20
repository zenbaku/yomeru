/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies'

declare let self: ServiceWorkerGlobalScope

// Precache app shell (injected by vite-plugin-pwa at build time)
precacheAndRoute(self.__WB_MANIFEST)

// Cache Tesseract WASM core and trained data from CDN
registerRoute(
  ({ url }) =>
    url.hostname.includes('cdn.jsdelivr.net') &&
    (url.pathname.includes('tesseract') || url.pathname.includes('traineddata')),
  new CacheFirst({
    cacheName: 'tesseract-assets',
  }),
)

// Cache dictionary JSON
registerRoute(
  ({ url }) => url.pathname.startsWith('/dict/'),
  new CacheFirst({
    cacheName: 'dictionary-data',
  }),
)

// Cache HuggingFace model files (ONNX weights, tokenizer, config)
registerRoute(
  ({ url }) =>
    url.hostname.includes('huggingface.co') || url.hostname.includes('hf.co'),
  new CacheFirst({
    cacheName: 'hf-models',
  }),
)

// Cache ONNX WASM runtime (large, excluded from precache)
registerRoute(
  ({ url, sameOrigin }) =>
    sameOrigin && url.pathname.endsWith('.wasm'),
  new CacheFirst({
    cacheName: 'wasm-runtime',
  }),
)

// Cache other same-origin assets
registerRoute(
  ({ request, sameOrigin }) =>
    sameOrigin && (request.destination === 'script' || request.destination === 'style' || request.destination === 'image'),
  new StaleWhileRevalidate({
    cacheName: 'static-assets',
  }),
)

// Known cache names managed by this service worker.
// On activation, delete any caches not in this set to prevent unbounded
// storage growth (e.g. renamed caches from older versions of the app).
const MANAGED_CACHES = new Set([
  'tesseract-assets',
  'dictionary-data',
  'hf-models',
  'wasm-runtime',
  'static-assets',
  'transformers-cache',
  'paddleocr-models',
])

// Activate immediately
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Clean up orphaned caches from previous app versions
      caches.keys().then((names) =>
        Promise.all(
          names
            .filter((name) => !MANAGED_CACHES.has(name) && !name.startsWith('workbox-'))
            .map((name) => caches.delete(name)),
        ),
      ),
    ]),
  )
})
