import type { PipelinePhase } from '../services/pipeline.ts'
import type { TranslationResult } from '../services/translation/types.ts'

interface InfoPanelProps {
  phase: PipelinePhase
  ocrText: string | null
  translations: TranslationResult[] | null
  phraseTranslation: string | null
  error: string | null
  ocrOnly: boolean
  onOcrOnlyChange: (value: boolean) => void
  onSettings: () => void
  onReset: () => void
}

export function InfoPanel({ phase, ocrText, translations, phraseTranslation, error, ocrOnly, onOcrOnlyChange, onSettings, onReset }: InfoPanelProps) {
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
        <PhaseStatus phase={phase} />
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
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
          <p style={{
            color: 'var(--text-secondary)',
            fontSize: 14,
            textAlign: 'center',
            padding: '24px 16px',
            lineHeight: 1.5,
          }}>
            Point at Japanese text and tap scan
          </p>
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

        {/* Phrase translation */}
        {phraseTranslation && (
          <div style={{
            padding: '10px 12px',
            marginBottom: 10,
            background: 'rgba(77, 171, 247, 0.08)',
            border: '1px solid rgba(77, 171, 247, 0.2)',
            borderRadius: 8,
            lineHeight: 1.5,
          }}>
            <span style={{
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              color: 'rgba(77, 171, 247, 0.7)',
            }}>
              Translation:
            </span>
            <div style={{
              fontSize: 15,
              color: '#4dabf7',
              marginTop: 2,
              fontWeight: 500,
            }}>
              {phraseTranslation}
            </div>
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

        {/* Word cards */}
        {translations && translations.length > 0 && !translations.some(t => t.translations.length > 0) && (
          <p style={{
            color: 'var(--text-secondary)',
            fontSize: 13,
            textAlign: 'center',
            padding: '4px 0 8px',
          }}>
            No dictionary matches found.
          </p>
        )}
        {translations?.map((t, i) => (
          <WordCard key={i} result={t} />
        ))}
      </div>
    </div>
  )
}

function PhaseStatus({ phase }: { phase: PipelinePhase }) {
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
    done: 'Done',
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

function WordCard({ result }: { result: TranslationResult }) {
  const { original, reading, translations, partOfSpeech } = result
  const hasTranslation = translations.length > 0

  if (!hasTranslation) {
    // Minimal display for unmatched tokens
    return (
      <div style={{
        padding: '6px 12px',
        marginBottom: 4,
        background: 'rgba(255,255,255,0.03)',
        borderRadius: 8,
        borderLeft: '3px solid transparent',
      }}>
        <span style={{ fontSize: 16, color: 'var(--text-secondary)' }}>
          {original}
        </span>
      </div>
    )
  }

  return (
    <div style={{
      padding: '10px 12px',
      marginBottom: 6,
      background: 'var(--bg-surface)',
      borderRadius: 8,
      borderLeft: '3px solid var(--bbox-done)',
    }}>
      {/* Line 1: Original Japanese (large, white) */}
      <div style={{
        fontSize: 18,
        fontWeight: 600,
        color: 'var(--text-primary)',
        marginBottom: 2,
      }}>
        {original}
      </div>
      {/* Line 2: Reading in hiragana (small, dimmed) */}
      {reading && (
        <div style={{
          fontSize: 12,
          color: 'var(--text-secondary)',
          marginBottom: 4,
        }}>
          {reading}
        </div>
      )}
      {/* Line 3: Translation + POS (medium, colored) */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 14, color: '#f5a623' }}>
          {translations.join(', ')}
        </span>
        {partOfSpeech && (
          <span style={{
            fontSize: 11,
            color: 'var(--text-secondary)',
            opacity: 0.7,
          }}>
            {partOfSpeech}
          </span>
        )}
      </div>
    </div>
  )
}
