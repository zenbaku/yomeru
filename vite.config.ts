import { defineConfig, type Plugin } from 'vite'
import { resolve, basename } from 'node:path'
import { existsSync, readFileSync, createReadStream, statSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Handle ONNX Runtime WASM & module files for both dev and production.
 *
 * onnxruntime-web constructs URLs for its .wasm binary and .mjs module loader
 * relative to the bundled JS module (via import.meta.url).  In development the
 * inferred URLs don't map to real files, so we intercept and serve them from
 * node_modules.  In production builds we emit them into the assets directory
 * so they sit next to the bundled JS chunks where onnxruntime-web expects them.
 */
function onnxWasmPlugin(): Plugin {
  const wasmDir = resolve(
    import.meta.dirname,
    'node_modules/@gutenye/ocr-browser/node_modules/onnxruntime-web/dist',
  )

  const wasmFiles = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']

  const contentTypes: Record<string, string> = {
    '.wasm': 'application/wasm',
    '.mjs': 'application/javascript',
  }

  return {
    name: 'onnx-wasm',

    // Dev: intercept requests and serve from node_modules
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

    // Build: emit .wasm and .mjs into the assets directory so they are
    // co-located with the JS chunks that reference them via import.meta.url.
    generateBundle() {
      for (const file of wasmFiles) {
        const filePath = resolve(wasmDir, file)
        if (existsSync(filePath)) {
          this.emitFile({
            type: 'asset',
            fileName: `assets/${file}`,
            source: readFileSync(filePath),
          })
        }
      }
    },
  }
}

export default defineConfig({
  define: {
    __BUILD_TIMESTAMP__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    onnxWasmPlugin(),
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
