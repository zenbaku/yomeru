/**
 * Lightweight diagnostic logger for mobile crash debugging.
 * Logs lifecycle events with timestamps and memory snapshots
 * so we can trace what leads up to OOM kills.
 *
 * Usage: import { log } from '../services/logger.ts'
 *        log.camera('started', { resolution: '720p' })
 */

interface MemoryInfo {
  usedJSHeapSize?: number
  totalJSHeapSize?: number
  jsHeapSizeLimit?: number
}

function getMemoryMB(): string | null {
  const mem = (performance as any).memory as MemoryInfo | undefined
  if (!mem?.usedJSHeapSize) return null
  const used = (mem.usedJSHeapSize / (1024 * 1024)).toFixed(1)
  const total = ((mem.totalJSHeapSize ?? 0) / (1024 * 1024)).toFixed(1)
  const limit = ((mem.jsHeapSizeLimit ?? 0) / (1024 * 1024)).toFixed(0)
  return `${used}/${total}MB (limit ${limit}MB)`
}

function getDeviceMemory(): string {
  const mem = (navigator as any).deviceMemory
  return mem !== undefined ? `${mem}GB` : 'unknown'
}

function fmt(tag: string, action: string, detail?: Record<string, unknown>): string {
  const mem = getMemoryMB()
  const parts = [`[yomeru:${tag}] ${action}`]
  if (detail) {
    const entries = Object.entries(detail)
      .map(([k, v]) => `${k}=${typeof v === 'number' ? (v > 1000 ? `${(v as number).toFixed(0)}ms` : v) : v}`)
      .join(' ')
    if (entries) parts.push(entries)
  }
  if (mem) parts.push(`| heap=${mem}`)
  return parts.join(' ')
}

function makeLogger(tag: string) {
  return (action: string, detail?: Record<string, unknown>) => {
    console.log(fmt(tag, action, detail))
  }
}

function makeErrorLogger(tag: string) {
  return (action: string, err: unknown, detail?: Record<string, unknown>) => {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(fmt(tag, `${action} ERROR: ${msg}`, detail))
  }
}

export const log = {
  camera: makeLogger('camera'),
  ocr: makeLogger('ocr'),
  pipeline: makeLogger('pipeline'),
  neural: makeLogger('neural'),
  worker: makeLogger('worker'),
  app: makeLogger('app'),

  cameraError: makeErrorLogger('camera'),
  ocrError: makeErrorLogger('ocr'),
  pipelineError: makeErrorLogger('pipeline'),
  neuralError: makeErrorLogger('neural'),
  workerError: makeErrorLogger('worker'),

  /** Log device info once at startup */
  deviceInfo() {
    const mem = getDeviceMemory()
    const ua = navigator.userAgent
    const cores = navigator.hardwareConcurrency ?? 'unknown'
    console.log(`[yomeru:device] memory=${mem} cores=${cores} ua=${ua}`)
  },
}
