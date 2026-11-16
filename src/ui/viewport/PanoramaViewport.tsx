import { useMemo, useState } from 'react'
import { type DentalArch, reconstructPanorama } from '../../data/panoramic'
import { translate } from '../../i18n'
import { useViewerStore } from '../../store/useViewerStore'
import { GrayImage } from './GrayImage'

export function PanoramaViewport({
  arch,
  marker,
  onPick,
}: {
  arch: DentalArch | null
  marker?: number
  onPick?: (column: number, row: number) => void
}) {
  const volume = useViewerStore((s) => s.volume)
  const lang = useViewerStore((s) => s.lang)
  const [thickness, setThickness] = useState(12)
  const [offset, setOffset] = useState(0)

  const projection = useMemo(
    () => volume && arch ? reconstructPanorama(volume, arch, thickness, offset) : null,
    [volume, arch, thickness, offset],
  )

  if (!projection) {
    return (
      <p className="flex h-full items-center justify-center px-5 text-center text-sm text-[#9fb4c8]">
        {translate(lang, 'panorama.unavailable')}
      </p>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-black">
      {onPick ? (
        <p className="shrink-0 border-b border-[#94a3b8]/15 bg-[#070d14] px-3 py-2 text-[11px] text-[#c9dcee]">
          {translate(lang, 'section.pick')}
        </p>
      ) : (
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-[#94a3b8]/15 bg-[#070d14] px-3 py-2 text-[11px] text-[#c9dcee]">
        <label className="flex items-center gap-2 whitespace-nowrap">
          {translate(lang, 'panorama.thickness')}
          <span className="w-20 sm:w-28">
            <input
              type="range"
              min={2}
              max={30}
              step={1}
              value={thickness}
              aria-label={translate(lang, 'panorama.thickness')}
              aria-valuetext={`${thickness} mm`}
              onChange={(event) => setThickness(event.currentTarget.valueAsNumber)}
            />
          </span>
          <span className="w-11 font-mono text-teal-200">{thickness} mm</span>
        </label>
        <label className="flex items-center gap-2 whitespace-nowrap">
          {translate(lang, 'panorama.offset')}
          <span className="w-20 sm:w-28">
            <input
              type="range"
              min={-10}
              max={10}
              step={0.5}
              value={offset}
              aria-label={translate(lang, 'panorama.offset')}
              aria-valuetext={`${offset} mm`}
              onChange={(event) => setOffset(event.currentTarget.valueAsNumber)}
            />
          </span>
          <span className="w-14 font-mono text-teal-200">{offset} mm</span>
        </label>
      </div>
      )}
      <div className="min-h-0 flex-1 px-2 py-1">
        <GrayImage raster={projection} label={translate(lang, 'panorama.reconstruction')} marker={marker} onPick={onPick} />
      </div>
    </div>
  )
}
