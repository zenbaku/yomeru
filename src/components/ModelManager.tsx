import { useState, useEffect, useCallback } from 'react'
import { ocrModels, getSelectedOCRModelId, setSelectedOCRModelId } from '../services/ocr/registry.ts'
import { translationModels } from '../services/translation/registry.ts'
import { neuralModels, getSelectedNeuralModelId, setSelectedNeuralModelId } from '../services/translation/neural-registry.ts'
import { DownloadError } from '../services/storage/model-cache.ts'
import type { NeuralModelInfo } from '../services/translation/types.ts'
import type { OCRModel } from '../services/ocr/types.ts'
import type { TranslationModel } from '../services/translation/types.ts'
import type { ModelInfo } from '../services/translation/types.ts'
import type { useNeuralTranslator } from '../hooks/useNeuralTranslator.ts'

/** Classify an error into an actionable user-facing message. */
function describeError(err: unknown): string {
  if (err instanceof DownloadError) return err.message
  if (!navigator.onLine) return 'You appear to be offline. Check your connection and try again.'
  if (err instanceof Error) return err.message
  return 'An unexpected error occurred. Please try again.'
}

function isLowMemoryDevice(): boolean {
  const mem = (navigator as { deviceMemory?: number }).deviceMemory
  return mem !== undefined && mem <= 2
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

interface ModelManagerProps {
  onBack: () => void
  neural: ReturnType<typeof useNeuralTranslator>
  onNeuralModelChange: (id: string) => void
}

export function ModelManager({ onBack, neural, onNeuralModelChange }: ModelManagerProps) {
  const [selectedNeuralId, setSelectedNeuralId] = useState(getSelectedNeuralModelId)
  const [selectedOcrId, setSelectedOcrId] = useState(getSelectedOCRModelId)
  const [storageEstimate, setStorageEstimate] = useState<{ usage: number; quota: number } | null>(null)

  useEffect(() => {
    if (navigator.storage?.estimate) {
      navigator.storage.estimate().then((est) => {
        setStorageEstimate({ usage: est.usage ?? 0, quota: est.quota ?? 0 })
      }).catch(() => {})
    }
  }, [])

  function handleSelectNeural(id: string) {
    setSelectedNeuralModelId(id)
    setSelectedNeuralId(id)
    neural.terminate()
    onNeuralModelChange(id)
  }

  function handleSelectOcr(id: string) {
    setSelectedOCRModelId(id)
    setSelectedOcrId(id)
  }

  return (
    <div style={{
      height: '100%',
      overflow: 'auto',
      background: 'var(--bg-primary)',
    }}>
      {/* Header */}
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        background: 'var(--bg-primary)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        padding: '0 20px',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)',
        paddingBottom: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={onBack}
            style={{
              width: 36,
              height: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255,255,255,0.06)',
              borderRadius: 8,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>Settings</h1>
        </div>
      </div>

      <div style={{
        padding: '16px 20px',
        paddingBottom: 'calc(var(--safe-bottom) + 32px)',
      }}>
        {/* OCR Engine Section */}
        <SectionHeader
          icon={<ScanIcon />}
          title="OCR Engine"
          description="Text recognition model for scanning Japanese"
        />
        {ocrModels.map((m) => (
          <SelectableModelCard
            key={m.id}
            model={m}
            isSelected={m.id === selectedOcrId}
            onSelect={() => handleSelectOcr(m.id)}
          />
        ))}

        {/* Dictionary Section */}
        <SectionHeader
          icon={<BookIcon />}
          title="Dictionary"
          description="Word-by-word lookup for scanned text"
          style={{ marginTop: 28 }}
        />
        {translationModels.map((m) => (
          <ModelCard key={m.id} model={m} />
        ))}

        {/* Neural Translation Section */}
        <SectionHeader
          icon={<BrainIcon />}
          title="Neural Translation"
          description="AI-powered full sentence translation"
          style={{ marginTop: 28 }}
        />
        {neuralModels.map((m) => (
          <NeuralCard
            key={m.id}
            model={m}
            isSelected={m.id === selectedNeuralId}
            neural={neural}
            onSelect={() => handleSelectNeural(m.id)}
          />
        ))}

        {/* Storage Section */}
        <SectionHeader
          icon={<StorageIcon />}
          title="Storage"
          description="Cached models and data for offline use"
          style={{ marginTop: 28 }}
        />
        <StorageCard storageEstimate={storageEstimate} />

        {/* About Section */}
        <SectionHeader
          icon={<InfoIcon />}
          title="About"
          style={{ marginTop: 28 }}
        />
        <AboutCard />
      </div>
    </div>
  )
}

/* ─── Storage Card ────────────────────────────────────────────── */

function StorageCard({ storageEstimate }: { storageEstimate: { usage: number; quota: number } | null }) {
  const [clearing, setClearing] = useState(false)
  const [cleared, setCleared] = useState(false)

  async function handleClearCache() {
    setClearing(true)
    try {
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.filter(k => !k.includes('workbox')).map(k => caches.delete(k)))
      }
      setCleared(true)
    } catch {
      // ignore
    } finally {
      setClearing(false)
    }
  }

  const usagePct = storageEstimate && storageEstimate.quota > 0
    ? Math.round((storageEstimate.usage / storageEstimate.quota) * 100)
    : null

  return (
    <div style={cardStyle}>
      {storageEstimate ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Cache usage</span>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {formatBytes(storageEstimate.usage)} / {formatBytes(storageEstimate.quota)}
            </span>
          </div>
          {/* Usage bar */}
          <div style={{
            width: '100%',
            height: 6,
            background: 'rgba(255,255,255,0.06)',
            borderRadius: 3,
            overflow: 'hidden',
            marginBottom: 12,
          }}>
            <div style={{
              width: `${Math.min(usagePct ?? 0, 100)}%`,
              height: '100%',
              background: (usagePct ?? 0) > 80 ? '#ffa726' : '#4cd964',
              borderRadius: 3,
              transition: 'width 0.3s ease',
            }} />
          </div>
        </>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
          Storage info unavailable
        </p>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <ActionButton
          onClick={handleClearCache}
          disabled={clearing || cleared}
          variant="danger"
        >
          {cleared ? 'Cache cleared' : clearing ? 'Clearing...' : 'Clear model cache'}
        </ActionButton>
      </div>
      {cleared && (
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
          Models will re-download on next use.
        </p>
      )}
    </div>
  )
}

/* ─── About Card ──────────────────────────────────────────────── */

function AboutCard() {
  const buildTime = __BUILD_TIMESTAMP__.replace('T', ' ').slice(0, 19)
  const mem = (navigator as { deviceMemory?: number }).deviceMemory

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <InfoRow label="App" value="Yomeru" />
        <InfoRow label="Build" value={buildTime} />
        <InfoRow label="Platform" value={navigator.userAgent.includes('iPhone') || navigator.userAgent.includes('iPad') ? 'iOS' : navigator.userAgent.includes('Android') ? 'Android' : 'Desktop'} />
        {mem !== undefined && <InfoRow label="Device memory" value={`${mem} GB`} />}
        <InfoRow label="Online" value={navigator.onLine ? 'Yes' : 'No'} />
      </div>
      <p style={{
        fontSize: 12,
        color: 'var(--text-secondary)',
        marginTop: 14,
        lineHeight: 1.5,
        opacity: 0.6,
      }}>
        Offline Japanese text scanner and translator. All processing happens on-device.
      </p>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{value}</span>
    </div>
  )
}

/* ─── Section Header ──────────────────────────────────────────── */

function SectionHeader({ icon, title, description, style }: {
  icon?: React.ReactNode
  title: string
  description?: string
  style?: React.CSSProperties
}) {
  return (
    <div style={{ marginBottom: 10, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: description ? 4 : 0 }}>
        {icon && (
          <span style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}>
            {icon}
          </span>
        )}
        <h2 style={{
          fontSize: 13,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: 1,
          fontWeight: 600,
        }}>
          {title}
        </h2>
      </div>
      {description && (
        <p style={{
          fontSize: 12,
          color: 'var(--text-secondary)',
          opacity: 0.6,
          marginLeft: icon ? 24 : 0,
        }}>
          {description}
        </p>
      )}
    </div>
  )
}

/* ─── Section Icons (inline SVG) ──────────────────────────────── */

function ScanIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <line x1="7" y1="12" x2="17" y2="12" />
    </svg>
  )
}

function BookIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  )
}

function BrainIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a4 4 0 0 1 4 4 4 4 0 0 1-1 2.65A4 4 0 0 1 17 12a4 4 0 0 1-2 3.46A4 4 0 0 1 12 22a4 4 0 0 1-3-6.54A4 4 0 0 1 7 12a4 4 0 0 1 2-3.35A4 4 0 0 1 8 6a4 4 0 0 1 4-4z" />
      <path d="M12 2v20" />
    </svg>
  )
}

function StorageIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  )
}

function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  )
}

/* ─── Neural Card ─────────────────────────────────────────────── */

/** Card for a neural translation model with download + selection */
function NeuralCard({
  model,
  isSelected,
  neural,
  onSelect,
}: {
  model: NeuralModelInfo
  isSelected: boolean
  neural: ReturnType<typeof useNeuralTranslator>
  onSelect: () => void
}) {
  const [downloaded, setDownloaded] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const checkStatus = useCallback(() => {
    model.isDownloaded().then(setDownloaded).catch(() => setDownloaded(false))
  }, [model])

  useEffect(() => {
    checkStatus()
  }, [checkStatus])

  // Sync loading state from hook when this is the selected model
  useEffect(() => {
    if (isSelected && neural.isModelLoading) {
      setBusy(true)
      // Clamp to [0, 1] — downloadProgress is 0-100 but may exceed 100
      setProgress(Math.min(neural.downloadProgress / 100, 1))
    }
  }, [isSelected, neural.isModelLoading, neural.downloadProgress])

  useEffect(() => {
    if (isSelected && neural.isModelLoaded && busy) {
      setBusy(false)
      setProgress(0)
      setDownloaded(true)
    }
  }, [isSelected, neural.isModelLoaded, busy])

  const sizeMB = (model.size / 1024 / 1024).toFixed(0)

  async function handleDownload() {
    setBusy(true)
    setError(null)
    setProgress(0)
    try {
      await model.initialize((p) => setProgress(Math.min(p, 1)))
      setDownloaded(true)
      neural.recheckDownloaded()
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
      setProgress(0)
    }
  }

  async function handleDelete() {
    setBusy(true)
    setError(null)
    try {
      if (isSelected) neural.terminate()
      await model.clearCache()
      setDownloaded(false)
      neural.recheckDownloaded()
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      ...cardStyle,
      border: isSelected ? '1px solid rgba(76, 217, 100, 0.3)' : '1px solid transparent',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{model.name}</span>
            <span style={{
              fontSize: 11,
              color: 'var(--text-secondary)',
              background: 'rgba(255,255,255,0.06)',
              padding: '2px 6px',
              borderRadius: 4,
            }}>
              ~{sizeMB} MB
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          {downloaded !== null && (
            <StatusBadge installed={downloaded} />
          )}
          {isSelected && (
            <span style={{
              fontSize: 11,
              padding: '3px 8px',
              borderRadius: 4,
              background: 'rgba(77, 171, 247, 0.15)',
              color: '#4dabf7',
              fontWeight: 500,
            }}>
              Active
            </span>
          )}
        </div>
      </div>

      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.4 }}>
        {model.description}
      </p>

      {isLowMemoryDevice() && model.size > 100_000_000 && (
        <div style={{
          fontSize: 12,
          color: '#ffa726',
          marginTop: 8,
          lineHeight: 1.4,
          background: 'rgba(255, 167, 38, 0.08)',
          padding: '6px 10px',
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffa726" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>Low memory device. This model may cause crashes. Opus-MT recommended.</span>
        </div>
      )}

      <ProgressBar busy={busy} progress={progress} />

      {error && (
        <p style={{ fontSize: 12, color: 'var(--accent)', marginTop: 8, lineHeight: 1.4 }}>
          {error}
        </p>
      )}

      {downloaded !== null && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          {!downloaded && (
            <ActionButton onClick={handleDownload} disabled={busy}>
              {busy ? `Downloading ${Math.min(Math.round(progress * 100), 100)}%` : 'Download'}
            </ActionButton>
          )}
          {downloaded && !isSelected && (
            <ActionButton onClick={onSelect} disabled={busy} variant="primary">
              Use
            </ActionButton>
          )}
          {downloaded && (
            <ActionButton onClick={handleDelete} disabled={busy} variant="danger">
              {busy ? 'Deleting...' : 'Delete'}
            </ActionButton>
          )}
        </div>
      )}
    </div>
  )
}

/* ─── Selectable Model Card (OCR) ─────────────────────────────── */

function SelectableModelCard({ model, isSelected, onSelect }: {
  model: OCRModel | TranslationModel | ModelInfo
  isSelected: boolean
  onSelect: () => void
}) {
  const [downloaded, setDownloaded] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const checkStatus = useCallback(() => {
    model.isDownloaded().then(setDownloaded).catch(() => setDownloaded(false))
  }, [model])

  useEffect(() => {
    checkStatus()
  }, [checkStatus])

  const sizeMB = (model.size / 1024 / 1024).toFixed(1)

  async function handleDownload() {
    setBusy(true)
    setError(null)
    setProgress(0)
    try {
      await model.initialize((p) => setProgress(Math.min(p, 1)))
      setDownloaded(true)
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
      setProgress(0)
    }
  }

  async function handleDelete() {
    setBusy(true)
    setError(null)
    try {
      await model.clearCache()
      setDownloaded(false)
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      ...cardStyle,
      border: isSelected ? '1px solid rgba(76, 217, 100, 0.3)' : '1px solid transparent',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{model.name}</span>
            <span style={{
              fontSize: 11,
              color: 'var(--text-secondary)',
              background: 'rgba(255,255,255,0.06)',
              padding: '2px 6px',
              borderRadius: 4,
            }}>
              {sizeMB} MB
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          {downloaded !== null && (
            <StatusBadge installed={downloaded} />
          )}
          {isSelected && (
            <span style={{
              fontSize: 11,
              padding: '3px 8px',
              borderRadius: 4,
              background: 'rgba(77, 171, 247, 0.15)',
              color: '#4dabf7',
              fontWeight: 500,
            }}>
              Active
            </span>
          )}
        </div>
      </div>

      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.4 }}>
        {model.description}
      </p>

      <ProgressBar busy={busy} progress={progress} />

      {error && (
        <p style={{ fontSize: 12, color: 'var(--accent)', marginTop: 8, lineHeight: 1.4 }}>
          {error}
        </p>
      )}

      {downloaded !== null && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          {!downloaded && (
            <ActionButton onClick={handleDownload} disabled={busy}>
              {busy ? `Downloading ${Math.min(Math.round(progress * 100), 100)}%` : 'Download'}
            </ActionButton>
          )}
          {downloaded && !isSelected && (
            <ActionButton onClick={onSelect} disabled={busy} variant="primary">
              Use
            </ActionButton>
          )}
          {downloaded && (
            <ActionButton onClick={handleDelete} disabled={busy} variant="danger">
              {busy ? 'Deleting...' : 'Delete'}
            </ActionButton>
          )}
        </div>
      )}
    </div>
  )
}

/* ─── Simple Model Card (no selection) ────────────────────────── */

function ModelCard({ model }: { model: OCRModel | TranslationModel | ModelInfo }) {
  const [downloaded, setDownloaded] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const checkStatus = useCallback(() => {
    model.isDownloaded().then(setDownloaded).catch(() => setDownloaded(false))
  }, [model])

  useEffect(() => {
    checkStatus()
  }, [checkStatus])

  const sizeMB = (model.size / 1024 / 1024).toFixed(1)

  async function handleDownload() {
    setBusy(true)
    setError(null)
    setProgress(0)
    try {
      await model.initialize((p) => setProgress(Math.min(p, 1)))
      setDownloaded(true)
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
      setProgress(0)
    }
  }

  async function handleDelete() {
    setBusy(true)
    setError(null)
    try {
      await model.clearCache()
      setDownloaded(false)
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{model.name}</span>
            <span style={{
              fontSize: 11,
              color: 'var(--text-secondary)',
              background: 'rgba(255,255,255,0.06)',
              padding: '2px 6px',
              borderRadius: 4,
            }}>
              {sizeMB} MB
            </span>
          </div>
        </div>
        {downloaded !== null && (
          <StatusBadge installed={downloaded} />
        )}
      </div>

      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.4 }}>
        {model.description}
      </p>

      <ProgressBar busy={busy} progress={progress} />

      {error && (
        <p style={{ fontSize: 12, color: 'var(--accent)', marginTop: 8, lineHeight: 1.4 }}>
          {error}
        </p>
      )}

      {downloaded !== null && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          {!downloaded && (
            <ActionButton onClick={handleDownload} disabled={busy}>
              {busy ? `Downloading ${Math.min(Math.round(progress * 100), 100)}%` : 'Download'}
            </ActionButton>
          )}
          {downloaded && (
            <ActionButton onClick={handleDelete} disabled={busy} variant="danger">
              {busy ? 'Deleting...' : 'Delete'}
            </ActionButton>
          )}
        </div>
      )}
    </div>
  )
}

/* ─── Shared Components ───────────────────────────────────────── */

function StatusBadge({ installed }: { installed: boolean }) {
  return (
    <span style={{
      fontSize: 11,
      padding: '3px 8px',
      borderRadius: 4,
      background: installed ? 'rgba(76, 217, 100, 0.15)' : 'rgba(255,255,255,0.06)',
      color: installed ? '#4cd964' : 'var(--text-secondary)',
      fontWeight: 500,
    }}>
      {installed ? 'Installed' : 'Not installed'}
    </span>
  )
}

function ProgressBar({ busy, progress }: { busy: boolean; progress: number }) {
  if (!busy || progress <= 0) return null
  return (
    <div style={{
      width: '100%',
      height: 4,
      background: 'rgba(255,255,255,0.08)',
      borderRadius: 2,
      marginTop: 10,
      overflow: 'hidden',
    }}>
      <div style={{
        width: `${Math.min(Math.round(progress * 100), 100)}%`,
        height: '100%',
        background: 'var(--accent)',
        borderRadius: 2,
        transition: 'width 0.3s ease',
      }} />
    </div>
  )
}

function ActionButton({
  children,
  onClick,
  disabled,
  variant = 'default',
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  variant?: 'default' | 'danger' | 'primary'
}) {
  const bg = variant === 'danger'
    ? 'rgba(233, 69, 96, 0.15)'
    : variant === 'primary'
      ? 'rgba(77, 171, 247, 0.15)'
      : 'rgba(255,255,255,0.08)'
  const color = variant === 'danger'
    ? '#e94560'
    : variant === 'primary'
      ? '#4dabf7'
      : 'var(--text-secondary)'

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '7px 16px',
        fontSize: 12,
        fontWeight: 600,
        borderRadius: 6,
        background: bg,
        color: disabled ? 'rgba(255,255,255,0.25)' : color,
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'opacity 0.15s ease',
      }}
    >
      {children}
    </button>
  )
}

/* ─── Shared Styles ───────────────────────────────────────────── */

const cardStyle: React.CSSProperties = {
  padding: 14,
  background: 'var(--bg-surface)',
  borderRadius: 10,
  marginBottom: 8,
}
