import type { OCRLine } from '@/services/ocr/types.ts'
import type { TranslationResult } from '@/services/translation/types.ts'

type NeuralStatus = 'idle' | 'loading' | 'translating' | 'done' | 'error' | 'not-downloaded' | 'no-model'

interface Props {
  filteredLines: OCRLine[]
  translations: TranslationResult[]
  neuralTranslations: Map<number, string>
  neuralStatus: NeuralStatus
  neuralProgress: number
  neuralError: string | null
}

export function ResultsPanel({ filteredLines, translations, neuralTranslations, neuralStatus, neuralProgress, neuralError }: Props) {
  return (
    <div style={{ padding: 12, fontSize: 13 }}>
      {/* Detected lines */}
      <div style={{ marginBottom: 12 }}>
        <div style={sectionHeaderStyle}>Detected Lines</div>
        {filteredLines.map((line, i) => (
          <div key={i} style={lineStyle}>
            <span style={{ color: '#e8e8e8' }}>{line.text}</span>
            <span style={{ color: '#a0a0b0', marginLeft: 8 }}>
              ({(line.confidence * 100).toFixed(0)}%)
            </span>
          </div>
        ))}
      </div>

      {/* Neural translation */}
      <div style={{ marginBottom: 12 }}>
        <div style={sectionHeaderStyle}>Neural Translation</div>
        {neuralTranslations.size > 0 ? (
          filteredLines.map((_, i) => {
            const t = neuralTranslations.get(i)
            return t ? (
              <div key={i} style={neuralStyle}>{t}</div>
            ) : null
          })
        ) : (
          <NeuralStatusDisplay status={neuralStatus} progress={neuralProgress} error={neuralError} />
        )}
      </div>

      {/* Segmented words with translations */}
      <div style={{ marginBottom: 12 }}>
        <div style={sectionHeaderStyle}>Segmented Words</div>
        <div style={{ color: '#a0a0b0', marginBottom: 8 }}>
          {translations.map((t) => t.original).join(' | ')}
        </div>
      </div>

      {/* Dictionary lookups */}
      <div>
        <div style={sectionHeaderStyle}>Dictionary Lookups</div>
        {translations
          .filter((t) => t.translations.length > 0)
          .map((t, i) => (
            <div key={i} style={cardStyle}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: '#e8e8e8' }}>
                  {t.original}
                </span>
                {t.reading && (
                  <span style={{ fontSize: 12, color: '#a0a0b0' }}>{t.reading}</span>
                )}
                {t.partOfSpeech && (
                  <span style={posStyle}>{t.partOfSpeech}</span>
                )}
              </div>
              <div style={{ color: '#c0c0d0', marginTop: 4 }}>
                {t.translations.join('; ')}
              </div>
            </div>
          ))}
        {translations.filter((t) => t.translations.length > 0).length === 0 && (
          <div style={{ color: '#a0a0b0' }}>No dictionary matches</div>
        )}
      </div>
    </div>
  )
}

function NeuralStatusDisplay({ status, progress, error }: { status: NeuralStatus; progress: number; error: string | null }) {
  if (status === 'not-downloaded') {
    return <div style={{ color: '#a0a0b0', fontSize: 12 }}>Model not downloaded — use the bar above</div>
  }
  if (status === 'no-model') {
    return <div style={{ color: '#a0a0b0', fontSize: 12 }}>No model selected</div>
  }
  if (status === 'error') {
    return <div style={{ color: '#e94560', fontSize: 12 }}>Error: {error ?? 'Unknown error'}</div>
  }
  if (status === 'done') {
    return <div style={{ color: '#a0a0b0', fontSize: 12 }}>No translation produced</div>
  }
  if (status === 'loading') {
    return (
      <div>
        <div style={{ color: '#4dabf7', fontSize: 12, marginBottom: 4 }}>
          Loading model... {Math.round(progress)}%
        </div>
        <div style={progressBarTrackStyle}>
          <div style={{ ...progressBarFillStyle, width: `${Math.round(progress)}%` }} />
        </div>
      </div>
    )
  }
  if (status === 'translating') {
    return (
      <div style={{ color: '#4dabf7', fontSize: 12 }}>
        Translating...
      </div>
    )
  }
  return <div style={{ color: '#a0a0b0', fontSize: 12 }}>Idle</div>
}

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#e94560',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 6,
}

const lineStyle: React.CSSProperties = {
  padding: '4px 0',
  borderBottom: '1px solid rgba(255,255,255,0.05)',
}

const neuralStyle: React.CSSProperties = {
  color: '#4dabf7',
  padding: '4px 0',
  borderBottom: '1px solid rgba(255,255,255,0.05)',
}

const cardStyle: React.CSSProperties = {
  background: '#0f3460',
  borderRadius: 6,
  padding: '8px 12px',
  marginBottom: 6,
}

const posStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#e94560',
  background: 'rgba(233, 69, 96, 0.15)',
  padding: '1px 6px',
  borderRadius: 3,
}

const progressBarTrackStyle: React.CSSProperties = {
  width: '100%',
  height: 3,
  background: 'rgba(255,255,255,0.08)',
  borderRadius: 2,
  overflow: 'hidden',
}

const progressBarFillStyle: React.CSSProperties = {
  height: '100%',
  background: '#4dabf7',
  borderRadius: 2,
  transition: 'width 0.3s ease',
}
