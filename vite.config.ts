import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      injectManifest: {
        // Exclude large ONNX WASM files from precache — they are cached
        // at runtime by the service worker's CacheFirst strategy instead.
        globPatterns: ['**/*.{js,css,html,webmanifest,png}'],
      },
      manifest: {
        name: 'Yomeru',
        short_name: 'Yomeru',
        description: 'Offline Japanese text scanner and translator',
        theme_color: '#1a1a2e',
        background_color: '#1a1a2e',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
  build: {
    // ONNX Runtime WASM + transformers.js are large by design
    chunkSizeWarningLimit: 1000,
  },
  server: {
    host: true,
    allowedHosts: ['.ts.net'],
  },
})
