import { useCallback, useEffect, useRef } from 'react'
import type { MprAxis } from '../types'
import { useViewerStore } from '../store/useViewerStore'
import { drawMpr, mprDisplay, pickMpr } from '../data/mpr'
import { huAtVoxel } from '../data/volumeLoader'
import { translate, windowLabel } from '../i18n'

const AXIS_NORMAL: Record<MprAxis, 'x' | 'y' | 'z'> = {
  axial: 'z',
  coronal: 'y',
  sagittal: 'x',
}

function MprView({ axis, compact = false }: { axis: MprAxis; compact?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const volume = useViewerStore((s) => s.volume)
  const cursor = useViewerStore((s) => s.cursor)
  const windowCenter = useViewerStore((s) => s.windowCenter)
  const windowWidth = useViewerStore((s) => s.windowWidth)
  const setCursor = useViewerStore((s) => s.setCursor)
  const nudgeCursor = useViewerStore((s) => s.nudgeCursor)
  const lang = useViewerStore((s) => s.lang)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !volume) return
    drawMpr(canvas, volume, axis, cursor, windowCenter, windowWidth)
  }, [volume, axis, cursor, windowCenter, windowWidth])

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      event.preventDefault()
      nudgeCursor(AXIS_NORMAL[axis], event.deltaY > 0 ? 1 : -1)
    },
    [axis, nudgeCursor],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  if (!volume) return null
  const [w, h, d] = volume.dims
  const display = mprDisplay(axis, volume.dims, cursor)
  const spacing = volume.spacing
  const normal = AXIS_NORMAL[axis]
  const spacingMm = normal === 'x' ? spacing[0] : normal === 'y' ? spacing[1] : spacing[2]
  const axisMax = normal === 'x' ? w - 1 : normal === 'y' ? h - 1 : d - 1
  const value = cursor[normal]
  const title = translate(lang, axis).toUpperCase()

  const setAxis = (next: number) => {
    const max = normal === 'x' ? w - 1 : normal === 'y' ? h - 1 : d - 1
    setCursor({ [normal]: Math.max(0, Math.min(max, next)) })
  }

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget
    const rect = canvas.getBoundingClientRect()
    const u = (event.clientX - rect.left) / rect.width
    const v = (event.clientY - rect.top) / rect.height
    setCursor(pickMpr(axis, volume.dims, u, v))
  }

  return (
    <div className={`mpr-view ${compact ? 'mpr-view--compact' : ''}`}>
      <div className="mpr-view__head">
        <span className="mpr-view__title">{title}</span>
        <span className="mpr-view__readout">
          {display.axisLabel} {value}
          {compact ? null : (
            <>
              <span className="dim"> / {axisMax}</span>
              <span className="dim">
                {' '}
                · {(value * spacingMm).toFixed(1)} {translate(lang, 'mm')}
              </span>
            </>
          )}
        </span>
      </div>
      <div className="mpr-view__canvas-wrap">
        <canvas ref={canvasRef} className="mpr-view__canvas" onClick={handleClick} />
      </div>
      <input
        className="mpr-view__slider"
        type="range"
        min={0}
        max={axisMax}
        step={1}
        value={value}
        aria-label={`${title} slice`}
        onChange={(event) => setAxis(Number(event.target.value))}
      />
      {compact ? null : (
        <div className="mpr-view__foot">
          <span className="dim">
            {display.width} × {display.height} {translate(lang, 'px')}
          </span>
          <span className="dim">{translate(lang, 'clickScroll')}</span>
        </div>
      )}
    </div>
  )
}

export function MprPanel() {
  const meta = useViewerStore((s) => s.meta)
  const volume = useViewerStore((s) => s.volume)
  const cursor = useViewerStore((s) => s.cursor)
  const windowCenter = useViewerStore((s) => s.windowCenter)
  const windowWidth = useViewerStore((s) => s.windowWidth)
  const setWindow = useViewerStore((s) => s.setWindow)
  const lang = useViewerStore((s) => s.lang)

  if (!meta || !volume) return null

  const hu = huAtVoxel(volume, cursor.x, cursor.y, cursor.z)
  const activeWindow = meta.windows.find(
    (w) => Math.abs(w.center - windowCenter) < 1 && Math.abs(w.width - windowWidth) < 1,
  )

  return (
    <div className="mpr">
      <div className="mpr__windows">
        <span className="field-label">{translate(lang, 'window')}</span>
        <div className="chips">
          {meta.windows.map((w) => (
            <button
              key={w.id}
              type="button"
              className={`chip ${activeWindow?.id === w.id ? 'is-active' : ''}`}
              onClick={() => setWindow(w.center, w.width)}
              title={`WW ${w.width} / WC ${w.center}`}
            >
              {windowLabel(lang, w.id, w.label)}
            </button>
          ))}
        </div>
      </div>
      <div className="mpr__window-readout">
        <span>
          WW <b>{Math.round(windowWidth)}</b>
        </span>
        <span>
          WC <b>{Math.round(windowCenter)}</b>
        </span>
        <span>
          HU <b>{Math.round(hu)}</b>
        </span>
      </div>

      <MprView axis="axial" />
      <div className="mpr-pair">
        <MprView axis="coronal" compact />
        <MprView axis="sagittal" compact />
      </div>

      <div className="mpr__cursor">
        <span className="dot" />
        {translate(lang, 'voxelCursor')} <b>{cursor.x}</b>, <b>{cursor.y}</b>, <b>{cursor.z}</b>
        <span className="dim">· HU {Math.round(hu)}</span>
      </div>
    </div>
  )
}
