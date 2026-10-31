import type { CSSProperties } from 'react'
import { PRESETS } from '../data/presets'
import { presetLabel, translate } from '../i18n'
import { useViewerStore } from '../store/useViewerStore'

function formatDate(date: string): string {
  if (date.length !== 8) return date || '—'
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
}

function formatTime(time: string): string {
  if (time.length < 6) return time || '—'
  return `${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}`
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className="stat__value">
        {value}
        {sub ? <span className="stat__sub">{sub}</span> : null}
      </span>
    </div>
  )
}

export function PatientSection() {
  const meta = useViewerStore((s) => s.meta)
  const lang = useViewerStore((s) => s.lang)
  if (!meta) return null
  const { patient, study, volume } = meta
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key)
  const sex = patient.sex === 'M' ? (lang === 'zh' ? '男' : 'Male') : patient.sex === 'F' ? (lang === 'zh' ? '女' : 'Female') : patient.sex || '—'

  return (
    <>
      <section className="panel-section patient">
        <div className="section-kicker">
          <span className="dot" /> {t('patient')}
        </div>
        <div className="patient__name">
          {patient.name || patient.latinName || 'Anonymous'}
          {patient.latinName && patient.name ? <span className="patient__latin">{patient.latinName}</span> : null}
        </div>
        <div className="patient__meta">
          <span className="tag">{patient.id}</span>
          <span className="tag">{sex}</span>
          <span className="tag">{patient.age || '—'}</span>
        </div>
        <div className="stat-grid">
          <Stat label={t('studyDate')} value={formatDate(study.date)} sub={formatTime(study.time)} />
          <Stat label={t('modality')} value={study.modality || 'CT'} sub={study.scanType || undefined} />
          <Stat label={t('scanner')} value={study.manufacturer || '—'} sub={study.model || undefined} />
          <Stat
            label={t('exposure')}
            value={study.kvp ? `${study.kvp} kVp` : '—'}
            sub={
              study.xrayCurrent
                ? `${study.xrayCurrent} mA · ${((study.exposureTime ?? 0) / 1000).toFixed(1)} s`
                : undefined
            }
          />
        </div>
      </section>

      <section className="panel-section">
        <div className="section-kicker">
          <span className="dot" /> {t('volume')}
        </div>
        <div className="stat-grid">
          <Stat
            label={t('matrix')}
            value={volume.dims.join(' × ')}
            sub={`${volume.originalDims.join(' × ')} ${t('native')}`}
          />
          <Stat label={t('voxel')} value={`${volume.spacing[0].toFixed(2)} mm`} sub="iso" />
          <Stat label={t('huRange')} value={`${volume.huRange[0]} … ${volume.huRange[1]}`} sub={t('quantized')} />
          <Stat label={t('slices')} value={`${meta.source.sliceCount}`} sub={t('axialDicom')} />
        </div>
      </section>
    </>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  onChange: (value: number) => void
}) {
  return (
    <label className="slider">
      <span className="slider__head">
        <span>{label}</span>
        <b>{display}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <button
      type="button"
      className={`toggle ${checked ? 'is-on' : ''}`}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle__dot" />
      {label}
    </button>
  )
}

export function RenderSection() {
  const lang = useViewerStore((s) => s.lang)
  const presetId = useViewerStore((s) => s.presetId)
  const setPreset = useViewerStore((s) => s.setPreset)
  const opacity = useViewerStore((s) => s.opacity)
  const setOpacity = useViewerStore((s) => s.setOpacity)
  const steps = useViewerStore((s) => s.steps)
  const setSteps = useViewerStore((s) => s.setSteps)
  const clip = useViewerStore((s) => s.clip)
  const setClip = useViewerStore((s) => s.setClip)
  const autoRotate = useViewerStore((s) => s.autoRotate)
  const setAutoRotate = useViewerStore((s) => s.setAutoRotate)
  const showBox = useViewerStore((s) => s.showBox)
  const setShowBox = useViewerStore((s) => s.setShowBox)
  const showGrid = useViewerStore((s) => s.showGrid)
  const setShowGrid = useViewerStore((s) => s.setShowGrid)
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key)

  return (
    <section className="panel-section">
      <div className="section-kicker">
        <span className="dot" /> {t('rayMarchLook')}
      </div>

      <div className="preset-grid">
        {PRESETS.map((preset, index) => (
          <button
            key={preset.id}
            type="button"
            className={`preset ${presetId === preset.id ? 'is-active' : ''}`}
            onClick={() => setPreset(preset.id)}
            title={preset.hint}
            style={{ '--preset-accent': preset.accent } as CSSProperties}
          >
            <span className="preset__swatch" />
            <span className="preset__name">{presetLabel(lang, preset.id)}</span>
            <span className="preset__key">{index + 1}</span>
          </button>
        ))}
      </div>

      <div className="sliders">
        <Slider
          label={t('opacity')}
          value={opacity}
          min={0.15}
          max={2.5}
          step={0.05}
          display={`${opacity.toFixed(2)}×`}
          onChange={setOpacity}
        />
        <Slider
          label={t('samples')}
          value={steps}
          min={64}
          max={320}
          step={8}
          display={`${steps}`}
          onChange={setSteps}
        />
        <Slider
          label={t('cutPlane')}
          value={clip}
          min={0.25}
          max={1}
          step={0.01}
          display={clip >= 0.999 ? t('off') : `${Math.round((1 - clip) * 100)}%`}
          onChange={setClip}
        />
      </div>

      <div className="toggles">
        <Toggle label={t('autoRotate')} checked={autoRotate} onChange={setAutoRotate} />
        <Toggle label={t('bounds')} checked={showBox} onChange={setShowBox} />
        <Toggle label={t('grid')} checked={showGrid} onChange={setShowGrid} />
      </div>
    </section>
  )
}
