import { useRef, useEffect, useState } from 'react'
import type { TranslationResult } from '../services/translation/types.ts'

interface ResultsPanelProps {
  translations: TranslationResult[] | null
  ocrText: string | null
  onClose: () => void
}

export function ResultsPanel({ translations, ocrText, onClose }: ResultsPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)

  const show = translations !== null
  useEffect(() => {
    if (show) setExpanded(true)
    else setExpanded(false)
  }, [show])

  if (!show) return null

  const hasResults = translations.some((t) => t.translations.length > 0)

  return (
    <div
      ref={panelRef}
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        maxHeight: expanded ? '60vh' : '0',
        background: 'var(--bg-secondary)',
        borderRadius: '16px 16px 0 0',
        transition: 'max-height 0.3s ease',
        overflow: 'hidden',
        zIndex: 20,
        boxShadow: '0 -4px 24px rgba(0,0,0,0.4)',
      }}
    >
      {/* Handle bar */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          justifyContent: 'center',
          padding: '10px 0 6px',
          cursor: 'pointer',
        }}
      >
        <div style={{
          width: 40,
          height: 4,
          borderRadius: 2,
          background: 'rgba(255,255,255,0.2)',
        }} />
      </div>

      {/* Close button */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 8,
          right: 12,
          padding: '4px 8px',
          fontSize: 18,
          color: 'var(--text-secondary)',
        }}
      >
        ×
      </button>

      {/* Word cards */}
      <div style={{
        overflowY: 'auto',
        maxHeight: 'calc(60vh - 40px)',
        padding: '0 16px 16px',
        paddingBottom: 'calc(16px + var(--safe-bottom))',
      }}>
        {/* Show raw OCR text */}
        {ocrText && (
          <div style={{
            padding: '8px 12px',
            marginBottom: 10,
            background: 'rgba(255,255,255,0.04)',
            borderRadius: 8,
            fontSize: 13,
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
          }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Recognized:
            </span>{' '}
            <span style={{ color: 'var(--text-primary)' }}>{ocrText}</span>
          </div>
        )}
        {translations.length === 0 && (
          <p style={{
            color: 'var(--text-secondary)',
            fontSize: 14,
            textAlign: 'center',
            padding: '12px 0',
          }}>
            No text recognized. Try moving closer or improving lighting.
          </p>
        )}
        {translations.length > 0 && !hasResults && (
          <p style={{
            color: 'var(--text-secondary)',
            fontSize: 13,
            textAlign: 'center',
            padding: '4px 0 8px',
          }}>
            No dictionary matches found.
          </p>
        )}
        {translations.map((t, i) => (
          <WordCard key={i} result={t} />
        ))}
      </div>
    </div>
  )
}

function WordCard({ result }: { result: TranslationResult }) {
  const { original, reading, translations, partOfSpeech } = result
  const hasTranslation = translations.length > 0

  return (
    <div style={{
      display: 'flex',
      gap: 12,
      padding: '10px 12px',
      marginBottom: 6,
      background: hasTranslation ? 'var(--bg-surface)' : 'rgba(255,255,255,0.03)',
      borderRadius: 8,
      alignItems: 'baseline',
      borderLeft: hasTranslation ? '3px solid var(--bbox-done)' : '3px solid transparent',
    }}>
      {/* Japanese */}
      <div style={{ minWidth: 60, flexShrink: 0 }}>
        <span style={{
          fontSize: 18,
          fontWeight: 600,
          color: hasTranslation ? 'var(--text-primary)' : 'var(--text-secondary)',
        }}>
          {original}
        </span>
        {reading && (
          <div style={{
            fontSize: 11,
            color: 'var(--text-secondary)',
            marginTop: 1,
          }}>
            {reading}
          </div>
        )}
      </div>

      {/* English */}
      {hasTranslation && (
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>
            {translations.join(', ')}
          </span>
          {partOfSpeech && (
            <span style={{
              fontSize: 11,
              color: 'var(--text-secondary)',
              marginLeft: 8,
            }}>
              {partOfSpeech}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
