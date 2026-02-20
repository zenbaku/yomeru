import { useState, useEffect, useCallback } from 'react'
import { ocrModels } from '../services/ocr/registry.ts'
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

interface ModelManagerProps {
  onBack: () => void
  neural: ReturnType<typeof useNeuralTranslator>
  onNeuralModelChange: (id: string) => void
}

export function ModelManager({ onBack, neural, onNeuralModelChange }: ModelManagerProps) {
  const [selectedId, setSelectedId] = useState(getSelectedNeuralModelId)

  function handleSelect(id: string) {
    setSelectedNeuralModelId(id)
    setSelectedId(id)
    neural.terminate()
    onNeuralModelChange(id)
  }

  return (
    <div style={{
      height: '100%',
      overflow: 'auto',
      padding: 20,
      paddingTop: 'calc(env(safe-area-inset-top, 0px) + 20px)',
      paddingBottom: 'calc(var(--safe-bottom) + 20px)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
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
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Models</h1>
      </div>

      {/* OCR Models */}
      <SectionHeader>OCR Models</SectionHeader>
      {ocrModels.map((m) => (
        <ModelCard key={m.id} model={m} />
      ))}

      {/* Translation Models */}
      <SectionHeader style={{ marginTop: 24 }}>Translation Models</SectionHeader>
      {translationModels.map((m) => (
        <ModelCard key={m.id} model={m} />
      ))}

      {/* Neural Translation */}
      <SectionHeader style={{ marginTop: 24 }}>Neural Translation</SectionHeader>
      {neuralModels.map((m) => (
        <NeuralCard
          key={m.id}
          model={m}
          isSelected={m.id === selectedId}
          neural={neural}
          onSelect={() => handleSelect(m.id)}
        />
      ))}

      {/* Info */}
      <p style={{
        color: 'var(--text-secondary)',
        fontSize: 12,
        marginTop: 32,
        textAlign: 'center',
        lineHeight: 1.5,
      }}>
        Models are cached locally for offline use.
        Delete a model to free storage, then re-download when needed.
      </p>
      <p style={{
        color: 'var(--text-secondary)',
        fontSize: 11,
        opacity: 0.4,
        marginTop: 12,
        textAlign: 'center',
      }}>
        Build {__BUILD_TIMESTAMP__.replace('T', ' ').slice(0, 19)}
      </p>
    </div>
  )
}

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
      padding: 14,
      background: 'var(--bg-surface)',
      borderRadius: 10,
      marginBottom: 8,
      border: isSelected ? '1px solid rgba(76, 217, 100, 0.3)' : '1px solid transparent',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{model.name}</span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 8 }}>
            ~{sizeMB} MB
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {downloaded !== null && (
            <span style={{
              fontSize: 11,
              padding: '3px 8px',
              borderRadius: 4,
              background: downloaded ? 'rgba(76, 217, 100, 0.15)' : 'rgba(255,255,255,0.06)',
              color: downloaded ? '#4cd964' : 'var(--text-secondary)',
            }}>
              {downloaded ? 'Installed' : 'Not installed'}
            </span>
          )}
          {isSelected && (
            <span style={{
              fontSize: 11,
              padding: '3px 8px',
              borderRadius: 4,
              background: 'rgba(77, 171, 247, 0.15)',
              color: '#4dabf7',
            }}>
              Selected
            </span>
          )}
        </div>
      </div>

      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6 }}>
        {model.description}
      </p>

      {isLowMemoryDevice() && model.size > 100_000_000 && (
        <p style={{
          fontSize: 12,
          color: '#ffa726',
          marginTop: 6,
          lineHeight: 1.4,
          background: 'rgba(255, 167, 38, 0.08)',
          padding: '6px 10px',
          borderRadius: 6,
        }}>
          Your device has limited memory. This model may cause the app to crash or slow down.
          Opus-MT is recommended for this device.
        </p>
      )}

      {busy && progress > 0 && (
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
      )}

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

function SectionHeader({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <h2 style={{
      fontSize: 14,
      color: 'var(--text-secondary)',
      marginBottom: 10,
      textTransform: 'uppercase',
      letterSpacing: 1,
      ...style,
    }}>
      {children}
    </h2>
  )
}

type AnyModel = OCRModel | TranslationModel | ModelInfo

function ModelCard({ model }: { model: AnyModel }) {
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
      padding: 14,
      background: 'var(--bg-surface)',
      borderRadius: 10,
      marginBottom: 8,
    }}>
      {/* Top row: name + status */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{model.name}</span>
          <span style={{
            fontSize: 12,
            color: 'var(--text-secondary)',
            marginLeft: 8,
          }}>
            {sizeMB} MB
          </span>
        </div>
        {downloaded !== null && (
          <span style={{
            fontSize: 11,
            padding: '3px 8px',
            borderRadius: 4,
            background: downloaded ? 'rgba(76, 217, 100, 0.15)' : 'rgba(255,255,255,0.06)',
            color: downloaded ? '#4cd964' : 'var(--text-secondary)',
          }}>
            {downloaded ? 'Installed' : 'Not installed'}
          </span>
        )}
      </div>

      {/* Description */}
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6 }}>
        {model.description}
      </p>

      {/* Progress bar */}
      {busy && progress > 0 && (
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
      )}

      {/* Error message */}
      {error && (
        <p style={{ fontSize: 12, color: 'var(--accent)', marginTop: 8, lineHeight: 1.4 }}>
          {error}
        </p>
      )}

      {/* Action buttons */}
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
        padding: '6px 14px',
        fontSize: 12,
        fontWeight: 600,
        borderRadius: 6,
        background: bg,
        color: disabled ? 'rgba(255,255,255,0.25)' : color,
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}
