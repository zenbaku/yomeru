import { useState } from 'react'
import type { PipelinePhase } from '../services/pipeline.ts'
import type { TranslationResult } from '../services/translation/types.ts'

interface InfoPanelProps {
  phase: PipelinePhase
  ocrText: string | null
  /** Per-line word-by-word dictionary translations */
  translations: TranslationResult[][] | null
  /** Per-line neural translations (null entries = still translating) */
  neuralTranslations: (string | null)[] | null
  /** Whether NLLB is actively translating */
  isNeuralTranslating: boolean
  /** Whether the NLLB model is downloaded */
  isNeuralAvailable: boolean
  error: string | null
  ocrOnly: boolean
  onOcrOnlyChange: (value: boolean) => void
  onSettings: () => void
  onReset: () => void
}

export function InfoPanel({
  phase,
  ocrText,
  translations,
  neuralTranslations,
  isNeuralTranslating,
  isNeuralAvailable,
  error,
  ocrOnly,
  onOcrOnlyChange,
  onSettings,
  onReset,
}: InfoPanelProps) {
  return (
    <div style={{
      flex: 1,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-secondary)',
      borderTop: '1px solid rgba(255,255,255,0.06)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        flexShrink: 0,
      }}>
        <PhaseStatus phase={phase} isNeuralTranslating={isNeuralTranslating} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={() => onOcrOnlyChange(!ocrOnly)}
            style={{
              fontSize: 12,
              color: ocrOnly ? 'var(--accent)' : 'var(--text-secondary)',
              padding: '4px 10px',
              background: ocrOnly ? 'rgba(233, 69, 96, 0.15)' : 'rgba(255,255,255,0.06)',
              borderRadius: 6,
              border: ocrOnly ? '1px solid rgba(233, 69, 96, 0.3)' : '1px solid transparent',
            }}
          >
            OCR only
          </button>
          {(phase === 'done' || phase === 'error') && (
            <button
              onClick={onReset}
              style={{
                fontSize: 13,
                color: 'var(--text-secondary)',
                padding: '4px 10px',
                background: 'rgba(255,255,255,0.06)',
                borderRadius: 6,
              }}
            >
              Clear
            </button>
          )}
          <button
            onClick={onSettings}
            style={{
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255,255,255,0.06)',
              borderRadius: '50%',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: '0 16px 16px',
        paddingBottom: 'calc(16px + var(--safe-bottom))',
      }}>
        {phase === 'idle' && (
          <div style={{
            textAlign: 'center',
            padding: '24px 16px',
          }}>
            <p style={{
              color: 'var(--text-secondary)',
              fontSize: 14,
              lineHeight: 1.5,
            }}>
              Point at Japanese text and tap scan
            </p>
          </div>
        )}

        {phase === 'error' && (
          <div style={{
            padding: '12px',
            background: 'rgba(233, 69, 96, 0.1)',
            borderRadius: 8,
            marginBottom: 10,
          }}>
            <p style={{ color: '#e94560', fontSize: 14 }}>
              {error || 'Something went wrong'}
            </p>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
              Try scanning again
            </p>
          </div>
        )}

        {/* OCR text — show as soon as available */}
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

        {/* No text found */}
        {phase === 'done' && translations && translations.length === 0 && (
          <div style={{
            textAlign: 'center',
            padding: '16px 12px',
          }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 8 }}>
              No Japanese text detected.
            </p>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, opacity: 0.7 }}>
              Try moving closer, improving lighting, or adjusting the angle.
            </p>
          </div>
        )}

        {/* Per-line translation blocks */}
        {translations && translations.length > 0 && translations.map((lineWords, lineIndex) => (
          <LineBlock
            key={lineIndex}
            lineIndex={lineIndex}
            words={lineWords}
            neuralTranslation={neuralTranslations?.[lineIndex] ?? null}
            isTranslating={isNeuralTranslating && neuralTranslations !== null && neuralTranslations[lineIndex] === null}
          />
        ))}

        {/* Upgrade prompt — show once after first scan when NLLB not downloaded */}
        {phase === 'done' && !isNeuralAvailable && translations && translations.length > 0 && (
          <button
            onClick={onSettings}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '10px 12px',
              marginTop: 8,
              background: 'rgba(77, 171, 247, 0.06)',
              border: '1px solid rgba(77, 171, 247, 0.15)',
              borderRadius: 8,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <span style={{ fontSize: 16 }}>&#x2B06;</span>
            <div>
              <div style={{ fontSize: 13, color: '#4dabf7', fontWeight: 500 }}>
                Want better translations?
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                Download a neural translation model for natural English
              </div>
            </div>
          </button>
        )}
      </div>
    </div>
  )
}

/** A single OCR line with dictionary / neural translation */
function LineBlock({
  lineIndex: _lineIndex,
  words,
  neuralTranslation,
  isTranslating,
}: {
  lineIndex: number
  words: TranslationResult[]
  neuralTranslation: string | null
  isTranslating: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const hasAnyTranslation = words.some((w) => w.translations.length > 0)
  const japanese = words.map((w) => w.original).join('')

  return (
    <div style={{
      marginBottom: 8,
      background: 'var(--bg-surface)',
      borderRadius: 10,
      overflow: 'hidden',
      borderLeft: `3px solid ${neuralTranslation ? '#4cd964' : 'var(--bbox-done)'}`,
      transition: 'border-color 0.3s ease',
    }}>
      {/* Japanese text */}
      <div style={{
        padding: '10px 12px 4px',
        fontSize: 17,
        fontWeight: 600,
        color: 'var(--text-primary)',
      }}>
        {japanese}
      </div>

      {/* Neural translation (fades in over dictionary) */}
      {neuralTranslation ? (
        <div
          onClick={() => setExpanded(!expanded)}
          style={{
            padding: '4px 12px 10px',
            cursor: 'pointer',
          }}
        >
          <div style={{
            fontSize: 15,
            color: '#4dabf7',
            fontWeight: 500,
            animation: 'fadeIn 0.3s ease',
          }}>
            {neuralTranslation}
          </div>
          <div style={{
            fontSize: 11,
            color: 'var(--text-secondary)',
            opacity: 0.6,
            marginTop: 2,
          }}>
            Tap for word details
          </div>
        </div>
      ) : isTranslating ? (
        /* Translating shimmer */
        <div style={{ padding: '4px 12px 10px' }}>
          <DictionaryBreakdown words={words} />
          <div style={{
            height: 2,
            marginTop: 6,
            background: 'linear-gradient(90deg, transparent, rgba(77, 171, 247, 0.3), transparent)',
            backgroundSize: '200% 100%',
            animation: 'shimmer 1.5s infinite',
            borderRadius: 1,
          }} />
        </div>
      ) : (
        /* Dictionary-only display */
        <div style={{ padding: '4px 12px 10px' }}>
          <DictionaryBreakdown words={words} />
        </div>
      )}

      {/* Expanded word details (when neural translation is shown and tapped) */}
      {neuralTranslation && expanded && hasAnyTranslation && (
        <div style={{
          padding: '0 12px 10px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          animation: 'fadeIn 0.2s ease',
        }}>
          <div style={{
            fontSize: 11,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            padding: '8px 0 4px',
          }}>
            Word breakdown
          </div>
          {words.map((word, i) => (
            <CompactWordCard key={i} result={word} />
          ))}
        </div>
      )}
    </div>
  )
}

/** Inline dictionary breakdown: word(meaning) word(meaning) */
function DictionaryBreakdown({ words }: { words: TranslationResult[] }) {
  return (
    <div style={{
      fontSize: 13,
      lineHeight: 1.6,
      color: '#f5a623',
    }}>
      {words.map((word, i) => (
        <span key={i}>
          <span style={{ color: 'var(--text-primary)', opacity: 0.8 }}>{word.original}</span>
          {word.translations.length > 0 && (
            <span style={{ color: '#f5a623', opacity: 0.7, fontSize: 12 }}>
              ({word.translations[0]})
            </span>
          )}
          {i < words.length - 1 && ' '}
        </span>
      ))}
    </div>
  )
}

/** Compact word card for expanded details view */
function CompactWordCard({ result }: { result: TranslationResult }) {
  const { original, reading, translations, partOfSpeech } = result
  if (translations.length === 0) return null

  return (
    <div style={{
      padding: '4px 0',
      display: 'flex',
      alignItems: 'baseline',
      gap: 8,
      fontSize: 13,
    }}>
      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{original}</span>
      {reading && (
        <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{reading}</span>
      )}
      <span style={{ color: '#f5a623' }}>{translations.join(', ')}</span>
      {partOfSpeech && (
        <span style={{ color: 'var(--text-secondary)', fontSize: 10, opacity: 0.6 }}>
          {partOfSpeech}
        </span>
      )}
    </div>
  )
}

function PhaseStatus({ phase, isNeuralTranslating }: { phase: PipelinePhase; isNeuralTranslating: boolean }) {
  if (phase === 'idle') {
    return <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Ready</span>
  }

  const steps: PipelinePhase[] = ['preprocessing', 'ocr', 'segmenting', 'translating', 'done']
  const currentIdx = steps.indexOf(phase)

  const label: Record<string, string> = {
    preprocessing: 'Optimizing image...',
    ocr: 'Reading Japanese text...',
    segmenting: 'Analyzing words...',
    translating: 'Translating...',
    done: isNeuralTranslating ? 'Improving translation...' : 'Done',
    error: 'Error',
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {steps.map((step, i) => (
        <div
          key={step}
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: i <= currentIdx
              ? (phase === 'error' ? '#e94560' : '#4cd964')
              : 'rgba(255,255,255,0.2)',
            transition: 'background 0.2s',
          }}
        />
      ))}
      <span style={{
        fontSize: 13,
        color: phase === 'error' ? '#e94560' : 'var(--text-secondary)',
      }}>
        {label[phase] ?? ''}
      </span>
    </div>
  )
}
