import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

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
