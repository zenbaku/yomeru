import type { ReactNode } from 'react'

interface Props {
  title: string
  timing: number | null
  children: ReactNode
}

export function StagePanel({ title, timing, children }: Props) {
  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{title}</span>
        {timing !== null && (
          <span style={{ fontSize: 12, color: '#a0a0b0' }}>
            {timing.toFixed(0)}ms
          </span>
        )}
      </div>
      <div style={bodyStyle}>{children}</div>
    </div>
  )
}

const panelStyle: React.CSSProperties = {
  background: '#16213e',
  borderRadius: 8,
  overflow: 'hidden',
  border: '1px solid #0f3460',
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '8px 12px',
  borderBottom: '1px solid #0f3460',
}

const bodyStyle: React.CSSProperties = {
  minHeight: 200,
  overflow: 'auto',
  maxHeight: 500,
}
