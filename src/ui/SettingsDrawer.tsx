import { useEffect } from 'react'
import { translate } from '../i18n'
import { useViewerStore } from '../store/useViewerStore'
import { PatientSection, RenderSection } from './SidePanel'

export function SettingsDrawer() {
  const open = useViewerStore((s) => s.settingsOpen)
  const setOpen = useViewerStore((s) => s.setSettingsOpen)
  const lang = useViewerStore((s) => s.lang)
  const uiScale = useViewerStore((s) => s.uiScale)
  const setUiScale = useViewerStore((s) => s.setUiScale)

  const fontOptions: Array<{ value: number; key: Parameters<typeof translate>[1] }> = [
    { value: 1.0, key: 'ui.small' },
    { value: 1.18, key: 'ui.normal' },
    { value: 1.36, key: 'ui.large' },
    { value: 1.55, key: 'ui.xlarge' },
  ]

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, setOpen])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="close settings"
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        onClick={() => setOpen(false)}
      />
      <aside className="absolute right-0 top-0 flex h-full w-[360px] max-w-[94vw] flex-col border-l border-[#94a3b8]/20 bg-[#060b12] shadow-[-24px_0_60px_rgba(0,0,0,0.45)]">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-[#94a3b8]/15 px-4">
          <span className="font-mono text-[10px] tracking-[0.16em] text-teal-300/90">
            {translate(lang, 'settings.title')}
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={translate(lang, 'settings')}
            className="grid h-7 w-7 place-items-center rounded border border-[#94a3b8]/20 text-[#9fb4c8] transition hover:border-teal-300/40 hover:text-teal-200"
          >
            ✕
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <section className="mb-4 rounded-lg border border-[#94a3b8]/15 bg-[#0b1420]/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] tracking-[0.12em] text-[#c9dcee]">
                {translate(lang, 'ui.font')}
              </span>
              <span className="font-mono text-[9px] text-teal-300/80">
                {Math.round(uiScale * 100)}%
              </span>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-1">
              {fontOptions.map((option) => {
                const active = Math.abs(uiScale - option.value) < 0.03
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setUiScale(option.value)}
                    aria-pressed={active}
                    className={`rounded border px-1 py-2 font-mono text-[10px] transition ${
                      active
                        ? 'border-teal-300/50 bg-teal-300/10 text-teal-200'
                        : 'border-[#94a3b8]/15 bg-[#050a10]/60 text-[#9fb4c8] hover:border-[#94a3b8]/35 hover:text-[#dbe9f6]'
                    }`}
                    style={{ fontSize: `${10 * (0.8 + option.value * 0.28)}px` }}
                  >
                    {translate(lang, option.key)}
                  </button>
                )
              })}
            </div>
            <p className="mt-2 font-mono text-[9px] leading-relaxed text-[#566b80]">
              {translate(lang, 'ui.fontHint')}
            </p>
          </section>
          <PatientSection />
          <RenderSection />
          <p className="mt-4 border-t border-[#94a3b8]/10 pt-3 font-mono text-[9px] leading-relaxed text-[#566b80]">
            {translate(lang, 'renderNote')}
          </p>
        </div>
      </aside>
    </div>
  )
}
