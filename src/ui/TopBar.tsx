import type { MessageKey } from '../i18n'
import { translate } from '../i18n'
import type { WorkspaceLayout } from '../store/useViewerStore'
import { useViewerStore } from '../store/useViewerStore'

type IconProps = { className?: string }

const LAYOUT_OPTIONS: ReadonlyArray<{ id: WorkspaceLayout; key: MessageKey }> = [
  { id: 'quad', key: 'layout.quad' },
  { id: 'mpr', key: 'layout.mpr' },
  { id: 'axial', key: 'axial' },
  { id: 'coronal', key: 'coronal' },
  { id: 'sagittal', key: 'sagittal' },
  { id: 'panorama', key: 'layout.panorama' },
  { id: 'dentalSection', key: 'layout.dentalSection' },
  { id: 'oblique', key: 'layout.oblique' },
  { id: '3d', key: 'pane.volume' },
]

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1 rounded-md border px-1.5 py-[5px] font-mono text-[9px] leading-4 tracking-[0.08em] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-300/60'
const BUTTON_IDLE =
  'border-[#94a3b8]/15 bg-[#050a10]/60 text-[#9fb4c8] hover:border-[#94a3b8]/35 hover:text-[#e6f1fb]'
const BUTTON_ACTIVE =
  'border-teal-300/45 bg-teal-300/10 text-teal-200 shadow-[0_0_16px_rgba(45,212,191,0.14)]'

/** DICOM study dates arrive as YYYYMMDD; anything else passes through. */
function formatStudyDate(value: string | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '')
  if (digits.length === 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
  }
  return value || '—'
}

function LogoMark() {
  return (
    <span
      aria-hidden
      className="relative grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full border border-teal-300/40 bg-[#04121a]/40 shadow-[0_0_16px_rgba(45,212,191,0.16),inset_0_0_10px_rgba(45,212,191,0.12)]"
    >
      <span className="absolute left-[6px] right-[9px] top-[8px] h-[1.5px] rounded-full bg-teal-300/50" />
      <span className="absolute left-[6px] right-[7px] top-[12.5px] h-[1.5px] rounded-full bg-teal-300 shadow-[0_0_8px_rgba(45,212,191,0.85)]" />
      <span className="absolute left-[9px] right-[6px] top-[17px] h-[1.5px] rounded-full bg-teal-300/50" />
    </span>
  )
}

function FolderOpenIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 14l1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

function ToothIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3c-2.2 0-3 1.2-4.6 1.2S5 3.3 4.3 4.6C3 6.8 4.3 9.6 6 12c1 1.4 1.4 3.6 1.8 5.6.2 1.1 1.7 1.2 2 .1.3-1.3.6-3.2 1.2-3.2s.9 1.9 1.2 3.2c.3 1.1 1.7 1 2-.1.4-2 .8-4.2 1.8-5.6 1.7-2.4 3-5.2 1.7-7.4C17 3.3 15.9 4.2 14.4 4.2 13 4.2 12.2 3 12 3z" />
    </svg>
  )
}

function GearIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

export function TopBar() {
  const lang = useViewerStore((s) => s.lang)
  const meta = useViewerStore((s) => s.meta)
  const layout = useViewerStore((s) => s.layout)
  const setLayout = useViewerStore((s) => s.setLayout)
  const teethOnly = useViewerStore((s) => s.teethOnly)
  const setTeethOnly = useViewerStore((s) => s.setTeethOnly)
  const dental = useViewerStore((s) => s.dental)
  const toggleLang = useViewerStore((s) => s.toggleLang)
  const settingsOpen = useViewerStore((s) => s.settingsOpen)
  const toggleSettings = useViewerStore((s) => s.toggleSettings)

  const patientName = meta ? meta.patient.name || meta.patient.latinName || '—' : ''
  const patientId = meta?.patient.id ?? ''
  const studyDate = formatStudyDate(meta?.study.date)
  const modality = meta?.study.modality || 'CT'
  const importLabel = lang === 'zh' ? '打开' : 'Import'

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2.5 overflow-hidden border-b border-[#94a3b8]/15 bg-[#04070c] px-3 min-[900px]:gap-3 min-[900px]:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span className="flex shrink-0 items-center gap-2.5">
          <LogoMark />
          <span className="hidden min-w-0 flex-col justify-center min-[900px]:flex">
            <span className="whitespace-nowrap font-mono text-[11px] font-semibold leading-none tracking-[0.26em] text-[#eef7fe]">
              CBCT <span className="font-medium text-teal-300">VOLUME LAB</span>
            </span>
            <span className="mt-1 whitespace-nowrap font-mono text-[7.5px] uppercase leading-none tracking-[0.22em] text-[#566b80]">
              clinical reading
            </span>
          </span>
        </span>

        <span aria-hidden className="h-6 w-px shrink-0 bg-[#94a3b8]/15 max-[480px]:hidden" />

        <div className="flex min-w-0 items-center gap-2 rounded-md border border-[#94a3b8]/15 bg-[#050a10]/55 px-2 py-[5px] max-[480px]:hidden">
          <span
            aria-hidden
            className="grid h-4 w-4 shrink-0 place-items-center rounded-full border border-teal-300/25 bg-teal-300/10"
          >
            <span className="h-1 w-1 rounded-full bg-teal-300/80" />
          </span>
          {meta ? (
            <span className="flex min-w-0 items-center gap-2.5">
              <b className="block min-w-0 max-w-[24vw] truncate text-[11px] font-semibold leading-none tracking-[0.01em] text-[#eef7fe] min-[900px]:max-w-[18vw]">
                {patientName}
              </b>
              <span className="shrink-0 whitespace-nowrap font-mono text-[9px] leading-none tracking-[0.1em] text-[#7d93a8]">
                {patientId || '—'}
              </span>
              <span className="hidden shrink-0 items-center gap-2 border-l border-[#94a3b8]/15 pl-2.5 font-mono text-[9px] leading-none tracking-[0.08em] text-[#566b80] min-[1100px]:flex">
                <span className="whitespace-nowrap">{studyDate}</span>
                <span aria-hidden className="text-[#94a3b8]/25">
                  ·
                </span>
                <span className="whitespace-nowrap text-teal-300/80">{modality}</span>
              </span>
            </span>
          ) : (
            <span aria-hidden className="flex items-center gap-2.5">
              <span className="h-2 w-16 animate-pulse rounded-sm bg-[#94a3b8]/15" />
              <span className="h-2 w-20 animate-pulse rounded-sm bg-[#94a3b8]/10" />
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 min-[900px]:gap-1.5">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event('cbct:import'))}
          aria-label="打开 CBCT / Import CBCT"
          title="打开 CBCT / Import CBCT"
          className={`${BUTTON_BASE} ${BUTTON_IDLE} hover:text-teal-200`}
        >
          <FolderOpenIcon className="h-3 w-3 shrink-0" />
          <span className="whitespace-nowrap max-[620px]:hidden">{importLabel}</span>
        </button>

        <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-[#94a3b8]/15 max-[900px]:hidden" />

        <label className="flex items-center gap-1.5 whitespace-nowrap rounded-md border border-teal-300/35 bg-teal-300/5 px-1.5 py-0.5 text-[10px] text-teal-200">
          <span className="max-[380px]:sr-only">{translate(lang, 'layout.selector')}</span>
          <select
            value={layout}
            onChange={(event) => setLayout(event.currentTarget.value as WorkspaceLayout)}
            className="h-6 w-[9.2em] rounded bg-[#07121a] px-1 text-teal-100 focus-visible:outline focus-visible:outline-teal-300 min-[620px]:w-[12em]"
          >
            {LAYOUT_OPTIONS.map(({ id, key }) => (
              <option key={id} value={id}>{translate(lang, key)}</option>
            ))}
          </select>
        </label>

        <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-[#94a3b8]/15 max-[900px]:hidden" />

        <button
          type="button"
          onClick={() => setTeethOnly(!teethOnly)}
          aria-pressed={teethOnly}
          aria-label={translate(lang, 'teethOnly')}
          title={dental ? translate(lang, 'teethOnlyHint') : translate(lang, 'teethUnavailable')}
          disabled={!dental}
          className={`${BUTTON_BASE} ${
            teethOnly
              ? 'border-amber-300/55 bg-amber-300/10 text-amber-200 shadow-[0_0_16px_rgba(251,191,36,0.12)]'
              : 'border-[#94a3b8]/15 bg-[#050a10]/60 text-[#9fb4c8] hover:border-amber-300/40 hover:text-amber-100'
          } ${dental ? '' : 'cursor-not-allowed opacity-40'}`}
        >
          <ToothIcon className="h-3 w-3 shrink-0" />
          <span className="whitespace-nowrap max-[620px]:hidden">
            {translate(lang, 'teethOnly')}
          </span>
        </button>

        <button
          type="button"
          onClick={toggleLang}
          aria-label="切换语言 / Switch language"
          title="中文 / English"
          className={`${BUTTON_BASE} ${BUTTON_IDLE} min-w-[30px] hover:border-teal-300/40 hover:text-teal-200`}
        >
          <span className="whitespace-nowrap">{translate(lang, 'top.lang')}</span>
        </button>

        <button
          type="button"
          onClick={toggleSettings}
          aria-pressed={settingsOpen}
          aria-label={translate(lang, 'settings')}
          title={translate(lang, 'settings')}
          className={`${BUTTON_BASE} ${settingsOpen ? BUTTON_ACTIVE : BUTTON_IDLE}`}
        >
          <GearIcon className="h-3 w-3 shrink-0" />
          <span className="whitespace-nowrap max-[620px]:hidden">
            {translate(lang, 'settings')}
          </span>
        </button>
      </div>
    </header>
  )
}
