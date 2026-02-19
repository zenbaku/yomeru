import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { existsSync, readdirSync, statSync, createReadStream } from 'node:fs'

const fixturesDir = resolve(__dirname, '../fixtures')

/**
 * Vite plugin that serves test fixture files at `/fixtures/` and
 * exposes a `/fixtures/_list` endpoint returning all fixture names.
 */
function serveFixtures(): Plugin {
  return {
    name: 'serve-fixtures',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/fixtures/')) return next()

        const relPath = decodeURIComponent(req.url.slice('/fixtures/'.length))

        // List endpoint — returns JSON array of fixture names
        if (relPath === '_list') {
          const names = existsSync(fixturesDir)
            ? readdirSync(fixturesDir)
                .filter((f) => f.endsWith('.meta.json'))
                .map((f) => f.replace('.meta.json', ''))
                .sort()
            : []
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(names))
          return
        }

        // Serve individual fixture files
        const filePath = resolve(fixturesDir, relPath)
        if (
          !filePath.startsWith(fixturesDir) ||
          !existsSync(filePath) ||
          !statSync(filePath).isFile()
        ) {
          return next()
        }

        const ext = filePath.split('.').pop()?.toLowerCase()
        const contentTypes: Record<string, string> = {
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          webp: 'image/webp',
          json: 'application/json',
        }
        if (ext && contentTypes[ext]) {
          res.setHeader('Content-Type', contentTypes[ext])
        }
        createReadStream(filePath).pipe(res)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), serveFixtures()],
  root: resolve(__dirname),
  publicDir: resolve(__dirname, '../../public'),
  resolve: {
    alias: {
      '@': resolve(__dirname, '../../src'),
    },
  },
  server: {
    port: 5174,
    host: true,
  },
})
