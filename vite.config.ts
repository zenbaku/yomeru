import { defineConfig, type Plugin } from 'vite'
import { resolve, basename } from 'node:path'
import { existsSync, createReadStream, statSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Serve ONNX Runtime WASM & module files from node_modules during development.
 *
 * onnxruntime-web constructs URLs for its .wasm binary and .mjs module loader
 * relative to the bundled JS module.  In Vite's dev server the inferred URLs
 * don't map to real files, so requests 404 (returning HTML).  This plugin
 * intercepts any request whose filename matches `ort-wasm*.(wasm|mjs)` and
 * serves the real file from the nested node_modules directory.
 */
function serveOnnxWasm(): Plugin {
  const wasmDir = resolve(
    import.meta.dirname,
    'node_modules/@gutenye/ocr-browser/node_modules/onnxruntime-web/dist',
  )

  const contentTypes: Record<string, string> = {
    '.wasm': 'application/wasm',
    '.mjs': 'application/javascript',
  }

  return {
    name: 'serve-onnx-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? ''
        if (url.includes('ort-wasm') && (url.endsWith('.wasm') || url.endsWith('.mjs'))) {
          const filename = basename(url.split('?')[0])
          const filePath = resolve(wasmDir, filename)
          if (existsSync(filePath)) {
            const stat = statSync(filePath)
            const ext = filename.substring(filename.lastIndexOf('.'))
            res.writeHead(200, {
              'Content-Type': contentTypes[ext] ?? 'application/octet-stream',
              'Content-Length': stat.size,
            })
            createReadStream(filePath).pipe(res)
            return
          }
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [
    serveOnnxWasm(),
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
        // ONNX Runtime Web (used by PaddleOCR and Transformers.js) makes
        // the main JS bundle large — raise the limit so it can be precached.
        maximumFileSizeToCacheInBytes: 15_000_000,
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
  optimizeDeps: {
    include: ['@huggingface/transformers'],
  },
  build: {
    // ONNX Runtime WASM + transformers.js are large by design
    chunkSizeWarningLimit: 1000,
  },
  worker: {
    format: 'es',
  },
  server: {
    host: true,
    allowedHosts: ['.ts.net'],
    headers: {
      // Required for SharedArrayBuffer (multi-threaded ONNX Runtime WASM)
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
})
