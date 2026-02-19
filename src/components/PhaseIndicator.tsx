import type { PipelinePhase } from '../services/pipeline.ts'

const PHASE_LABELS: Record<PipelinePhase, string> = {
  idle: '',
  capturing: 'Capturing...',
  ocr: 'Reading text...',
  segmenting: 'Splitting words...',
  translating: 'Looking up...',
  done: 'Done',
  error: 'Error',
}

export function PhaseIndicator({ phase }: { phase: PipelinePhase }) {
  if (phase === 'idle') return null

  const steps: PipelinePhase[] = ['ocr', 'segmenting', 'translating', 'done']
  const currentIdx = steps.indexOf(phase)

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 14px',
      background: 'rgba(0,0,0,0.6)',
      borderRadius: 20,
      fontSize: 13,
      backdropFilter: 'blur(8px)',
    }}>
      {steps.map((step, i) => (
        <div
          key={step}
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: i <= currentIdx
              ? (phase === 'error' ? '#e94560' : '#4cd964')
              : 'rgba(255,255,255,0.3)',
            transition: 'background 0.2s',
          }}
        />
      ))}
      <span style={{ color: phase === 'error' ? '#e94560' : '#e8e8e8' }}>
        {PHASE_LABELS[phase]}
      </span>
    </div>
  )
}
