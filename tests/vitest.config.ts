import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, '../src'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // Use jsdom so we get ImageData, Canvas, etc.
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
  },
})
