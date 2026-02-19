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

// Cache other same-origin assets
registerRoute(
  ({ request, sameOrigin }) =>
    sameOrigin && (request.destination === 'script' || request.destination === 'style' || request.destination === 'image'),
  new StaleWhileRevalidate({
    cacheName: 'static-assets',
  }),
)

// Activate immediately
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})
