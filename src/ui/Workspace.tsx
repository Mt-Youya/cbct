import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { mprDisplay } from '../data/mpr'
import { mprNavigation } from '../data/mprRange'
import { estimateDentalArch } from '../data/panoramic'
import type { MprAxis } from '../types'
import { presetLabel, translate } from '../i18n'
import { useViewerStore } from '../store/useViewerStore'
import { VolumeViewport } from '../three/VolumeViewport'
import { MprViewport } from './viewport/MprViewport'
import { PanoramaViewport } from './viewport/PanoramaViewport'
import { DentalSectionViewport, ObliqueViewport } from './viewport/ReformatViewport'

const MPR_AXES: MprAxis[] = ['axial', 'coronal', 'sagittal']
type PaneId = MprAxis | 'volume'
const MOBILE_TABS: PaneId[] = ['axial', 'coronal', 'sagittal', 'volume']

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  )
  useEffect(() => {
    const media = window.matchMedia(query)
    const handler = () => setMatches(media.matches)
    handler()
    media.addEventListener('change', handler)
    return () => media.removeEventListener('change', handler)
  }, [query])
  return matches
}

function Pane({
  title,
  info,
  children,
}: {
  title: string
  info: string
  children: ReactNode
}) {
  return (
    <section className="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-md border border-[#94a3b8]/15 bg-[#020508]">
      <header className="flex h-7 shrink-0 items-center justify-between gap-2 border-b border-[#94a3b8]/12 bg-[#070d14]/90 px-2">
        <span className="whitespace-nowrap font-mono text-[9px] font-medium tracking-[0.18em] text-teal-300/90">
          {title}
        </span>
        <span className="truncate text-right font-mono text-[9px] tracking-[0.04em] text-[#7d93a8]">{info}</span>
      </header>
      <div className="relative min-h-0 flex-1">{children}</div>
    </section>
  )
}

function fillPane(pane: ReactNode) {
  return <div className="min-h-0 flex-1 p-1.5">{pane}</div>
}

export function Workspace() {
  const volume = useViewerStore((s) => s.volume)
  const meta = useViewerStore((s) => s.meta)
  const dental = useViewerStore((s) => s.dental)
  const cursor = useViewerStore((s) => s.cursor)
  const setCursor = useViewerStore((s) => s.setCursor)
  const lockSliceRange = useViewerStore((s) => s.lockSliceRange)
  const windowCenter = useViewerStore((s) => s.windowCenter)
  const windowWidth = useViewerStore((s) => s.windowWidth)
  const presetId = useViewerStore((s) => s.presetId)
  const fps = useViewerStore((s) => s.fps)
  const layout = useViewerStore((s) => s.layout)
  const lang = useViewerStore((s) => s.lang)
  const isCompact = useMediaQuery('(max-width: 899px)')
  const [mobilePane, setMobilePane] = useState<PaneId>('axial')
  const needsArch = layout === 'panorama' || layout === 'dentalSection'
  const arch = useMemo(
    () => needsArch && volume && dental ? estimateDentalArch(volume, dental) : null,
    [needsArch, volume, dental],
  )

  if (!volume || !meta) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-[11px] text-[#566b80]">
        {translate(lang, 'loading.initializing')}
      </div>
    )
  }

  const [w, h, d] = volume.dims
  const spacing = volume.spacing
  const win = `WW ${Math.round(windowWidth)} · WC ${Math.round(windowCenter)}`
  const studyKey = `${meta.generatedAt}|${meta.source.directory}|${meta.volume.dims.join('x')}`
  if (layout === 'panorama') {
    return fillPane(
      <Pane title={translate(lang, 'panorama.reconstruction')} info={win}>
        <PanoramaViewport key={studyKey} arch={arch} />
      </Pane>,
    )
  }
  if (layout === 'dentalSection') {
    return fillPane(
      <Pane title={translate(lang, 'layout.dentalSection')} info={win}>
        {arch ? <DentalSectionViewport key={studyKey} volume={volume} arch={arch} /> : <PanoramaViewport arch={null} />}
      </Pane>,
    )
  }
  if (layout === 'oblique') {
    return fillPane(
      <Pane title={translate(lang, 'layout.oblique')} info={win}>
        <ObliqueViewport key={studyKey} volume={volume} />
      </Pane>,
    )
  }

  const paneInfo: Record<MprAxis, string> = {
    axial: `Z ${cursor.z + 1}/${d} · ${(cursor.z * spacing[2]).toFixed(1)} mm · ${win}`,
    coronal: `Y ${cursor.y + 1}/${h} · ${(cursor.y * spacing[1]).toFixed(1)} mm · ${win}`,
    sagittal: `X ${cursor.x + 1}/${w} · ${(cursor.x * spacing[0]).toFixed(1)} mm · ${win}`,
  }

  const volumePane = (
    <Pane
      key="volume"
      title={translate(lang, 'pane.volume').toUpperCase()}
      info={`${presetLabel(lang, presetId)} · ${fps} FPS`}
    >
      <VolumeViewport key={studyKey} />
    </Pane>
  )

  const mprPane = (axis: MprAxis, showSlider = false) => {
    const display = mprDisplay(axis, volume.dims, cursor)
    const normal = axis === 'axial' ? 'z' : axis === 'coronal' ? 'y' : 'x'
    const bounds = lockSliceRange ? mprNavigation(volume).limits[normal] : { min: 0, max: display.max }
    return (
      <Pane key={axis} title={translate(lang, axis).toUpperCase()} info={paneInfo[axis]}>
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1">
            <MprViewport key={studyKey} axis={axis} />
          </div>
          {showSlider && (
            <label className="flex shrink-0 items-center gap-3 border-t border-[#94a3b8]/15 bg-[#070d14] px-3 py-2 text-[11px] text-[#c9dcee]">
              <span className="whitespace-nowrap">{translate(lang, 'slices')}</span>
              <input
                type="range"
                min={bounds.min}
                max={bounds.max}
                value={display.index}
                onChange={(event) => setCursor({ [normal]: event.currentTarget.valueAsNumber })}
                aria-label={translate(lang, 'slices')}
                aria-valuetext={`${display.index + 1} / ${display.max + 1}`}
              />
              <span className="shrink-0 font-mono text-teal-200">{display.index + 1} / {display.max + 1}</span>
            </label>
          )}
        </div>
      </Pane>
    )
  }

  if (layout === '3d') return fillPane(volumePane)
  if (layout === 'axial' || layout === 'coronal' || layout === 'sagittal') return fillPane(mprPane(layout, true))

  if (isCompact) {
    const tabs = layout === 'mpr' ? MPR_AXES : MOBILE_TABS
    const activePane = layout === 'mpr' && mobilePane === 'volume' ? 'axial' : mobilePane
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-1.5 pb-1.5">
        <div className="flex shrink-0 items-center gap-1">
          {tabs.map((pane) => (
            <button
              key={pane}
              type="button"
              onClick={() => setMobilePane(pane)}
              aria-pressed={activePane === pane}
              className={`flex-1 whitespace-nowrap rounded border px-2 py-1.5 font-mono text-[9px] uppercase tracking-[0.1em] transition ${
                activePane === pane
                  ? 'border-teal-300/45 bg-teal-300/10 text-teal-200'
                  : 'border-[#94a3b8]/15 bg-[#050a10]/60 text-[#7d93a8]'
              }`}
            >
              {pane === 'volume' ? '3D' : translate(lang, pane)}
            </button>
          ))}
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          {activePane === 'volume' ? volumePane : mprPane(activePane, true)}
        </div>
      </div>
    )
  }

  const gridClass = layout === 'quad' ? 'grid-cols-2 grid-rows-2' : 'grid-cols-3 grid-rows-1'
  const panes = MPR_AXES.map((axis) => mprPane(axis))
  if (layout === 'quad') panes.push(volumePane)

  return (
    <div className={`grid min-h-0 flex-1 gap-1.5 p-1.5 ${gridClass}`}>
      {panes}
    </div>
  )
}
