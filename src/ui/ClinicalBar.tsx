import { PRESETS } from '../data/presets'
import { presetLabel, translate, windowLabel } from '../i18n'
import type { PresetId } from '../types'
import { useViewerStore } from '../store/useViewerStore'

const SECTION_LABEL =
  'shrink-0 whitespace-nowrap font-mono text-[9px] uppercase leading-none tracking-[0.16em] text-[#566b80]'
const CHIP_BASE =
  'inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded border px-2 font-mono text-[9.5px] leading-none tracking-[0.05em] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-300/60'
const CHIP_IDLE =
  'border-[#94a3b8]/15 bg-[#050a10]/60 text-[#9fb4c8] hover:border-[#94a3b8]/35 hover:text-[#e6f1fb]'
const CHIP_ACTIVE =
  'border-teal-300/45 bg-teal-300/10 text-teal-200 shadow-[0_0_14px_rgba(45,212,191,0.12)]'

const SKELETON_CHIPS = [
  { id: 'bone', width: 'w-12' },
  { id: 'soft', width: 'w-16' },
  { id: 'dental', width: 'w-12' },
  { id: 'full', width: 'w-16' },
]

function ChevronDown({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

export function ClinicalBar() {
  const meta = useViewerStore((s) => s.meta)
  const lang = useViewerStore((s) => s.lang)
  const windowCenter = useViewerStore((s) => s.windowCenter)
  const windowWidth = useViewerStore((s) => s.windowWidth)
  const setWindow = useViewerStore((s) => s.setWindow)
  const presetId = useViewerStore((s) => s.presetId)
  const setPreset = useViewerStore((s) => s.setPreset)

  if (!meta) {
    return (
      <div
        aria-hidden
        className="flex h-11 shrink-0 items-center gap-2 overflow-hidden border-b border-[#94a3b8]/15 bg-[#0a1118] px-3 min-[900px]:gap-3"
      >
        <span className="hidden h-2 w-24 animate-pulse rounded-sm bg-[#94a3b8]/10 min-[900px]:block" />
        {SKELETON_CHIPS.map((chip) => (
          <span
            key={chip.id}
            className={`h-6 ${chip.width} animate-pulse rounded border border-[#94a3b8]/10 bg-[#94a3b8]/10`}
          />
        ))}
        <span className="h-2 w-20 animate-pulse rounded-sm bg-[#94a3b8]/10" />
        <span className="hidden h-5 w-px bg-[#94a3b8]/15 min-[900px]:block" />
        <span className="hidden h-2 w-20 animate-pulse rounded-sm bg-[#94a3b8]/10 min-[900px]:block" />
        <span className="h-6 w-24 animate-pulse rounded border border-[#94a3b8]/10 bg-[#94a3b8]/10" />
      </div>
    )
  }

  return (
    <div
      role="group"
      aria-label={`${translate(lang, 'toolbar.window')} · ${translate(lang, 'toolbar.render')}`}
      className="flex h-11 shrink-0 items-center gap-2 overflow-x-auto overflow-y-hidden border-b border-[#94a3b8]/15 bg-[#0a1118] px-3 [scrollbar-width:none] min-[900px]:gap-3 [&::-webkit-scrollbar]:hidden"
    >
      <span className={`${SECTION_LABEL} max-[900px]:hidden`}>
        {translate(lang, 'toolbar.window')}
      </span>

      <div className="flex shrink-0 items-center gap-1">
        {meta.windows.map((preset) => {
          const active =
            Math.abs(preset.center - windowCenter) < 1 &&
            Math.abs(preset.width - windowWidth) < 1
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => setWindow(preset.center, preset.width)}
              aria-pressed={active}
              title={`${preset.center} / ${preset.width}`}
              className={`${CHIP_BASE} ${active ? CHIP_ACTIVE : CHIP_IDLE}`}
            >
              {windowLabel(lang, preset.id, preset.label)}
            </button>
          )
        })}
      </div>

      <span className="shrink-0 whitespace-nowrap font-mono text-[9px] leading-none tracking-[0.08em] text-[#7d93a8]">
        <span className="text-teal-300/80">WW</span> {Math.round(windowWidth)}
        <span aria-hidden className="px-1.5 text-[#94a3b8]/30">
          |
        </span>
        <span className="text-teal-300/80">WC</span> {Math.round(windowCenter)}
      </span>

      <span aria-hidden className="h-5 w-px shrink-0 bg-[#94a3b8]/15" />

      <span className={`${SECTION_LABEL} max-[900px]:hidden`}>
        {translate(lang, 'toolbar.render')}
      </span>

      <div className="relative shrink-0">
        <select
          aria-label={translate(lang, 'toolbar.render')}
          value={presetId}
          onChange={(event) => setPreset(event.target.value as PresetId)}
          className="h-6 w-[8.5rem] cursor-pointer appearance-none rounded border border-[#94a3b8]/15 bg-[#050a10]/80 py-0 pl-2 pr-6 font-mono text-[9.5px] leading-none tracking-[0.05em] text-[#c9dcee] outline-none transition-colors duration-150 hover:border-[#94a3b8]/35 focus:border-teal-300/50 focus-visible:ring-1 focus-visible:ring-teal-300/50"
        >
          {PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id} className="bg-[#0a1118] text-[#c9dcee]">
              {presetLabel(lang, preset.id)}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[#566b80]">
          <ChevronDown className="h-3 w-3" />
        </span>
      </div>
    </div>
  )
}
