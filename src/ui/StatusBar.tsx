import { huAtVoxel } from '../data/volumeLoader'
import { presetLabel, translate } from '../i18n'
import { useViewerStore } from '../store/useViewerStore'

export function StatusBar() {
  const volume = useViewerStore((s) => s.volume)
  const meta = useViewerStore((s) => s.meta)
  const cursor = useViewerStore((s) => s.cursor)
  const windowCenter = useViewerStore((s) => s.windowCenter)
  const windowWidth = useViewerStore((s) => s.windowWidth)
  const fps = useViewerStore((s) => s.fps)
  const lang = useViewerStore((s) => s.lang)
  const presetId = useViewerStore((s) => s.presetId)
  const teethOnly = useViewerStore((s) => s.teethOnly)

  if (!volume || !meta) return null
  const hu = Math.round(huAtVoxel(volume, cursor.x, cursor.y, cursor.z))
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key)

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between gap-3 border-t border-[#94a3b8]/15 bg-[#050a10] px-3 font-mono text-[9px] tracking-[0.04em] text-[#7d93a8]">
      <div className="flex min-w-0 items-center gap-3 overflow-hidden whitespace-nowrap">
        <span className="text-[#9fb4c8]">
          {t('status.cursor')}{' '}
          <b className="font-medium text-[#d7e7f5]">
            {cursor.x}, {cursor.y}, {cursor.z}
          </b>
        </span>
        <span className="hidden text-[#566b80] sm:inline">|</span>
        <span className="hidden sm:inline">
          HU <b className="font-medium text-teal-200">{hu}</b>
        </span>
        <span className="hidden text-[#566b80] md:inline">|</span>
        <span className="hidden md:inline">
          {t('status.window')} <b className="font-medium text-[#d7e7f5]">WW {Math.round(windowWidth)} / WC {Math.round(windowCenter)}</b>
        </span>
        <span className="hidden text-[#566b80] lg:inline">|</span>
        <span className="hidden lg:inline">
          {presetLabel(lang, presetId)}
          {teethOnly ? ` · ${t('teethOnly')}` : ''}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-3 whitespace-nowrap">
        <span className="hidden xl:inline">{t('status.tips')}</span>
        <span className="hidden text-[#566b80] md:inline">|</span>
        <span>
          {meta.volume.dims.join('×')} · {(meta.volume.spacing[0] ?? 0.5).toFixed(2)} mm · {fps} FPS
        </span>
      </div>
    </footer>
  )
}
