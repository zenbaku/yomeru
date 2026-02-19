import { useState, useEffect } from 'react'
import { ocrModels } from '../services/ocr/registry.ts'
import { translationModels } from '../services/translation/registry.ts'
import type { OCRModel } from '../services/ocr/types.ts'
import type { TranslationModel } from '../services/translation/types.ts'

interface ModelManagerProps {
  onBack: () => void
}

export function ModelManager({ onBack }: ModelManagerProps) {
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
      <h2 style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
        OCR Models
      </h2>
      {ocrModels.map((m) => (
        <ModelCard key={m.id} model={m} />
      ))}

      {/* Translation Models */}
      <h2 style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 24, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
        Translation Models
      </h2>
      {translationModels.map((m) => (
        <ModelCard key={m.id} model={m} />
      ))}

      {/* Info */}
      <p style={{
        color: 'var(--text-secondary)',
        fontSize: 12,
        marginTop: 32,
        textAlign: 'center',
        lineHeight: 1.5,
      }}>
        More models coming soon. The architecture supports
        swapping in different OCR engines and dictionaries.
      </p>
    </div>
  )
}

function ModelCard({ model }: { model: OCRModel | TranslationModel }) {
  const [downloaded, setDownloaded] = useState<boolean | null>(null)

  useEffect(() => {
    model.isDownloaded().then(setDownloaded)
  }, [model])

  const sizeMB = (model.size / 1024 / 1024).toFixed(1)

  return (
    <div style={{
      padding: 14,
      background: 'var(--bg-surface)',
      borderRadius: 10,
      marginBottom: 8,
    }}>
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
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6 }}>
        {model.description}
      </p>
    </div>
  )
}
