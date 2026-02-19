import type { PipelineParams } from '@/services/preprocessing-presets.ts'

interface Props {
  params: PipelineParams
  onChange: (params: PipelineParams) => void
  presets: Record<string, PipelineParams>
}

export function ParameterPanel({ params, onChange, presets }: Props) {
  function update(patch: Partial<PipelineParams>) {
    onChange({ ...params, ...patch })
  }

  return (
    <div style={containerStyle}>
      {/* Preset selector */}
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ fontSize: 13, color: '#a0a0b0' }}>Preset:</label>
        <select
          onChange={(e) => {
            const preset = presets[e.target.value]
            if (preset) onChange({ ...preset })
          }}
          defaultValue="auto"
          style={selectStyle}
        >
          {Object.keys(presets).map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
        {/* Preprocessing section */}
        <fieldset style={fieldsetStyle}>
          <legend style={legendStyle}>Preprocessing</legend>

          <Checkbox
            label="Auto-detect"
            checked={params.auto}
            onChange={(v) => update({ auto: v })}
          />

          <div style={{ opacity: params.auto ? 0.4 : 1, pointerEvents: params.auto ? 'none' : 'auto' }}>
            <Slider
              label="Adaptive block size"
              value={params.adaptiveBlockSize}
              min={3}
              max={51}
              step={2}
              onChange={(v) => update({ adaptiveBlockSize: v })}
            />
            <Slider
              label="Adaptive C constant"
              value={params.adaptiveC}
              min={0}
              max={30}
              step={1}
              onChange={(v) => update({ adaptiveC: v })}
            />
            <Checkbox
              label="Blur enabled"
              checked={params.blur}
              onChange={(v) => update({ blur: v })}
            />
            <Checkbox
              label="Median filter"
              checked={params.median}
              onChange={(v) => update({ median: v })}
            />
            <Checkbox
              label="Despeckle"
              checked={params.morphOpen}
              onChange={(v) => update({ morphOpen: v })}
            />
            <Slider
              label="Upscale"
              value={params.upscale}
              min={1}
              max={4}
              step={1}
              onChange={(v) => update({ upscale: v })}
            />
          </div>
        </fieldset>

        {/* OCR Filtering section */}
        <fieldset style={fieldsetStyle}>
          <legend style={legendStyle}>OCR Filtering</legend>

          <Slider
            label="Min confidence"
            value={params.minConfidence}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => update({ minConfidence: v })}
          />
          <Slider
            label="Min region area"
            value={params.minRegionArea}
            min={50}
            max={2000}
            step={50}
            onChange={(v) => update({ minRegionArea: v })}
          />
          <Slider
            label="Max aspect ratio"
            value={params.maxAspectRatio}
            min={1}
            max={50}
            step={1}
            onChange={(v) => update({ maxAspectRatio: v })}
          />
        </fieldset>

        {/* Content Filtering section */}
        <fieldset style={fieldsetStyle}>
          <legend style={legendStyle}>Content Filtering</legend>

          <Checkbox
            label="Require Japanese"
            checked={params.requireJapanese}
            onChange={(v) => update({ requireJapanese: v })}
          />
          <Slider
            label="Min characters"
            value={params.minCharacters}
            min={1}
            max={10}
            step={1}
            onChange={(v) => update({ minCharacters: v })}
          />
        </fieldset>
      </div>
    </div>
  )
}

// --- Sub-components ---

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
        <span style={{ color: '#a0a0b0' }}>{label}</span>
        <span style={{ color: '#e8e8e8', fontWeight: 600 }}>{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: '#e94560' }}
      />
    </div>
  )
}

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 13,
        color: '#a0a0b0',
        marginBottom: 8,
        cursor: 'pointer',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: '#e94560' }}
      />
      {label}
    </label>
  )
}

// --- Styles ---

const containerStyle: React.CSSProperties = {
  background: '#16213e',
  borderRadius: 8,
  padding: 16,
}

const fieldsetStyle: React.CSSProperties = {
  border: '1px solid #0f3460',
  borderRadius: 6,
  padding: '8px 12px',
  margin: 0,
}

const legendStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#e94560',
  padding: '0 6px',
}

const selectStyle: React.CSSProperties = {
  background: '#0f3460',
  color: '#e8e8e8',
  border: '1px solid #16213e',
  borderRadius: 4,
  padding: '4px 8px',
  fontSize: 13,
}
