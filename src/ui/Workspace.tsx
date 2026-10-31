import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { MprAxis, PresetId } from '../types'
import { presetLabel, translate } from '../i18n'
import { useViewerStore } from '../store/useViewerStore'
import { VolumeViewport } from '../three/VolumeViewport'
import { MprViewport } from './viewport/MprViewport'

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

export function Workspace() {
  const volume = useViewerStore((s) => s.volume)
  const meta = useViewerStore((s) => s.meta)
  const cursor = useViewerStore((s) => s.cursor)
  const windowCenter = useViewerStore((s) => s.windowCenter)
  const windowWidth = useViewerStore((s) => s.windowWidth)
  const presetId = useViewerStore((s) => s.presetId)
  const fps = useViewerStore((s) => s.fps)
  const layout = useViewerStore((s) => s.layout)
  const lang = useViewerStore((s) => s.lang)
  const isCompact = useMediaQuery('(max-width: 899px)')
  const [mobilePane, setMobilePane] = useState<PaneId>('axial')

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
  const paneInfo: Record<MprAxis, string> = {
    axial: `Z ${cursor.z + 1}/${d} · ${(cursor.z * spacing[2]).toFixed(1)} mm · ${win}`,
    coronal: `Y ${cursor.y + 1}/${h} · ${(cursor.y * spacing[1]).toFixed(1)} mm · ${win}`,
    sagittal: `X ${cursor.x + 1}/${w} · ${(cursor.x * spacing[0]).toFixed(1)} mm · ${win}`,
  }

  const volumePane = (
    <Pane
      title={translate(lang, 'pane.volume').toUpperCase()}
      info={`${presetLabel(lang, presetId as PresetId)} · ${fps} FPS`}
    >
      <VolumeViewport key={`${meta.source.directory}|${meta.volume.dims.join('x')}`} />
    </Pane>
  )

  const mprPane = (axis: MprAxis) => (
    <Pane
      key={axis}
      title={translate(lang, axis).toUpperCase()}
      info={paneInfo[axis]}
    >
      <MprViewport axis={axis} />
    </Pane>
  )

  if (isCompact) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-1.5 pb-1.5">
        <div className="flex shrink-0 items-center gap-1">
          {MOBILE_TABS.map((pane) => (
            <button
              key={pane}
              type="button"
              onClick={() => setMobilePane(pane)}
              aria-pressed={mobilePane === pane}
              className={`flex-1 whitespace-nowrap rounded border px-2 py-1.5 font-mono text-[9px] uppercase tracking-[0.1em] transition ${
                mobilePane === pane
                  ? 'border-teal-300/45 bg-teal-300/10 text-teal-200'
                  : 'border-[#94a3b8]/15 bg-[#050a10]/60 text-[#7d93a8]'
              }`}
            >
              {pane === 'volume' ? '3D' : translate(lang, pane)}
            </button>
          ))}
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          {mobilePane === 'volume' ? volumePane : mprPane(mobilePane)}
        </div>
      </div>
    )
  }

  const gridClass =
    layout === 'quad'
      ? 'grid-cols-2 grid-rows-2'
      : layout === 'mpr'
        ? 'grid-cols-3 grid-rows-1'
        : 'grid-cols-1 grid-rows-1'

  const panes =
    layout === 'quad'
      ? [...MPR_AXES.map(mprPane), volumePane]
      : layout === 'mpr'
        ? MPR_AXES.map(mprPane)
        : [volumePane]

  return (
    <div className={`grid min-h-0 flex-1 gap-1.5 p-1.5 ${gridClass}`}>
      {panes.map((pane, index) => (
        <div key={index} className="flex min-h-0 min-w-0">
          {pane}
        </div>
      ))}
    </div>
  )
}
