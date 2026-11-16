import { useMemo, useState } from 'react'
import type { DentalArch } from '../../data/panoramic'
import { obliqueGeometry, resliceVolume } from '../../data/reslice'
import { translate } from '../../i18n'
import { useViewerStore } from '../../store/useViewerStore'
import type { Cursor, Vec3, VolumeData } from '../../types'
import { GrayImage } from './GrayImage'
import { PanoramaViewport } from './PanoramaViewport'

const CONTROLS = 'flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-b border-[#94a3b8]/15 bg-[#070d14] px-3 py-2 text-[11px] text-[#c9dcee]'

function RangeControl({
  label, value, readout, min, max, step, onChange,
}: {
  label: string
  value: number
  readout: string
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <label className="flex items-center gap-2 whitespace-nowrap">
      {label}
      <span className="flex w-20 sm:w-28">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          aria-valuetext={readout}
          onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
        />
      </span>
      <span className="w-16 font-mono text-teal-200">{readout}</span>
    </label>
  )
}

function directionLabel(vector: Vec3, sign: 1 | -1) {
  const directions = [['R', 'L'], ['A', 'P'], ['I', 'S']]
  return vector
    .map((value, axis) => ({ weight: Math.abs(value), label: directions[axis][Number(value * sign > 0)] }))
    .filter(({ weight }) => weight >= 0.25)
    .map(({ label }) => label)
    .join('')
}

export function ObliqueViewport({ volume }: { volume: VolumeData }) {
  const lang = useViewerStore((s) => s.lang)
  const cursor = useViewerStore((s) => s.cursor)
  const [yaw, setYaw] = useState(25)
  const [tilt, setTilt] = useState(0)
  const [offset, setOffset] = useState(0)
  const geometry = useMemo(() => obliqueGeometry(volume, cursor, yaw, tilt), [volume, cursor, yaw, tilt])
  const min = Math.ceil(geometry.min * 2) / 2
  const max = Math.floor(geometry.max * 2) / 2
  const distance = Math.min(max, Math.max(min, offset))
  const plane = useMemo(() => geometry.plane(distance), [geometry, distance])
  const raster = useMemo(() => resliceVolume(volume, plane), [volume, plane])

  return (
    <div className="flex h-full min-h-0 flex-col bg-black">
      <div className={CONTROLS}>
        <RangeControl label={translate(lang, 'oblique.yaw')} value={yaw} readout={`${yaw}°`} min={-180} max={180} step={1} onChange={setYaw} />
        <RangeControl label={translate(lang, 'oblique.tilt')} value={tilt} readout={`${tilt}°`} min={-90} max={90} step={1} onChange={setTilt} />
        <RangeControl label={translate(lang, 'oblique.distance')} value={distance} readout={`${distance} mm`} min={min} max={max} step={0.5} onChange={setOffset} />
      </div>
      <div className="relative min-h-0 flex-1 px-9 py-5 font-mono text-xs text-teal-200">
        <GrayImage raster={raster} label={translate(lang, 'layout.oblique')} />
        <span className="absolute inset-x-0 top-1 text-center">{directionLabel(plane.down, -1)}</span>
        <span className="absolute inset-x-0 bottom-1 text-center">{directionLabel(plane.down, 1)}</span>
        <span className="absolute left-2 top-1/2">{directionLabel(plane.right, -1)}</span>
        <span className="absolute right-2 top-1/2">{directionLabel(plane.right, 1)}</span>
      </div>
    </div>
  )
}

function nearestColumn(arch: DentalArch, cursor: Cursor, spacing: Vec3) {
  let closest = 0
  let distance = Infinity
  for (const [index, point] of arch.samples.entries()) {
    const squared = (point.x - cursor.x * spacing[0]) ** 2 + (point.y - cursor.y * spacing[1]) ** 2
    if (squared < distance) {
      distance = squared
      closest = index
    }
  }
  return closest
}

export function DentalSectionViewport({ volume, arch }: { volume: VolumeData; arch: DentalArch }) {
  const lang = useViewerStore((s) => s.lang)
  const setCursor = useViewerStore((s) => s.setCursor)
  const [column, setColumn] = useState(() => nearestColumn(arch, useViewerStore.getState().cursor, volume.spacing))
  const [sx, sy, sz] = volume.spacing
  const { top, bottom, samples } = arch
  const point = samples[column]
  const raster = useMemo(() => resliceVolume(volume, {
    center: [point.x, point.y, (top + bottom) * sz / 2],
    right: [point.nx, point.ny, 0],
    down: [0, 0, -1],
    widthMm: 48,
    heightMm: (top - bottom + 1) * sz,
  }), [volume, point, top, bottom, sz])

  const chooseColumn = (index: number, row?: number) => {
    setColumn(index)
    const location = samples[index]
    const rows = Math.ceil((top - bottom) * sz / arch.pixelSize)
    setCursor({
      x: location.x / sx,
      y: location.y / sy,
      ...(row !== undefined ? { z: top - (row / rows) * (top - bottom) } : {}),
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-black">
      <div className={CONTROLS}>
        <RangeControl
          label={translate(lang, 'section.position')}
          value={column}
          readout={`${(arch.length * column / (samples.length - 1)).toFixed(1)} mm`}
          min={0}
          max={samples.length - 1}
          step={1}
          onChange={chooseColumn}
        />
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-[1fr_1.2fr] gap-px bg-[#94a3b8]/15 min-[760px]:grid-cols-[1.5fr_1fr] min-[760px]:grid-rows-1">
        <PanoramaViewport arch={arch} marker={column} onPick={chooseColumn} />
        <div className="relative min-h-0 bg-black px-2 pb-1 pt-6">
          <GrayImage raster={raster} label={translate(lang, 'layout.dentalSection')} />
          <div className="absolute inset-x-2 top-1 flex justify-between gap-2 text-[10px] text-teal-200">
            <span>{translate(lang, 'section.outer')}</span>
            <span>{translate(lang, 'section.inner')}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
