import { translate } from '../i18n'
import { useViewerStore } from '../store/useViewerStore'

const THUMB = `${import.meta.env.BASE_URL}data/thumbnail.png`

export function LoadingOverlay() {
  const status = useViewerStore((s) => s.status)
  const phase = useViewerStore((s) => s.phase)
  const progress = useViewerStore((s) => s.progress)
  const error = useViewerStore((s) => s.error)
  const meta = useViewerStore((s) => s.meta)
  const preview = useViewerStore((s) => s.preview)
  const lang = useViewerStore((s) => s.lang)
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key)

  if (status === 'ready') return null

  if (status === 'idle') {
    return (
      <div className="loader">
        <div className="max-h-[92dvh] w-full max-w-[880px] overflow-y-auto rounded-2xl border border-[#94a3b8]/20 bg-[#060b12]/95 shadow-[0_40px_120px_rgba(0,0,0,0.6)]">
          <div className="grid md:grid-cols-[280px_1fr]">
            <div
              className="relative hidden min-h-[360px] bg-[#020509] bg-cover bg-center md:block"
              style={{ backgroundImage: `linear-gradient(180deg, rgba(4,10,16,0.15), rgba(4,10,16,0.92)), url(${THUMB})` }}
            >
              <div className="absolute bottom-4 left-4 right-4">
                <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-teal-300/80">CBCT</div>
                <div className="mt-1 font-mono text-[10px] leading-relaxed text-[#9fb4c8]">
                  WebGL2 · MPR · 3D
                </div>
              </div>
            </div>

            <div className="p-7 md:p-8">
              <div className="loader__kicker">
                <span className="dot" /> DICOM · LOCAL IMPORT
              </div>
              <h1 className="mt-3 text-[22px] font-semibold tracking-tight text-[#eef7fe] md:text-[26px]">
                {t('start.title')}
              </h1>
              <p className="mt-2 max-w-[46ch] text-[12px] leading-relaxed text-[#8fa4b8]">
                {t('start.subtitle')}
              </p>

              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new Event('cbct:import'))}
                  className="flex items-center justify-center gap-2 rounded-lg border border-teal-300/50 bg-teal-300/10 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.14em] text-teal-200 transition hover:border-teal-300/80 hover:bg-teal-300/15"
                >
                  <span aria-hidden className="text-[13px]">▣</span>
                  {t('start.openFolder')}
                </button>
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new Event('cbct:import-files'))}
                  className="flex items-center justify-center gap-2 rounded-lg border border-[#94a3b8]/20 bg-[#0b1420]/60 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.14em] text-[#a9bdce] transition hover:border-teal-300/40 hover:text-teal-200"
                >
                  <span aria-hidden className="text-[13px]">＋</span>
                  {t('start.pickFiles')}
                </button>
              </div>

              <button
                type="button"
                onClick={() => window.dispatchEvent(new Event('cbct:sample'))}
                className="mt-2 w-full rounded-lg border border-transparent px-4 py-2.5 font-mono text-[9px] uppercase tracking-[0.16em] text-[#7d93a8] transition hover:text-teal-200"
              >
                {t('start.sample')} →
              </button>

              <div className="mt-5 rounded-lg border border-dashed border-[#94a3b8]/20 px-4 py-3 text-center font-mono text-[10px] text-[#7d93a8]">
                {t('start.drop')}
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[9px] text-[#566b80]">
                <span>{t('start.formats')}</span>
                <span className="text-teal-300/70">{t('start.privacy')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="loader is-error">
        <div className="max-h-[92dvh] w-full max-w-[640px] overflow-y-auto rounded-2xl border border-red-400/40 bg-[#0b0d12]/95 p-7 shadow-[0_40px_120px_rgba(0,0,0,0.6)]">
          <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-red-300/80">CBCT · ERROR</div>
          <h1 className="mt-3 text-[20px] font-semibold text-[#f6e8e8]">{t('loading.errorTitle')}</h1>
          <p className="mt-3 rounded border border-red-400/20 bg-red-500/5 p-3 font-mono text-[10px] leading-relaxed text-red-200/90">
            {error}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event('cbct:import'))}
              className="rounded-lg border border-red-300/40 bg-red-300/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-red-100 transition hover:bg-red-300/20"
            >
              {t('start.openFolder')}
            </button>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event('cbct:import-files'))}
              className="rounded-lg border border-[#94a3b8]/20 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#a9bdce] transition hover:text-teal-200"
            >
              {t('start.pickFiles')}
            </button>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event('cbct:sample'))}
              className="rounded-lg border border-[#94a3b8]/20 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#a9bdce] transition hover:text-teal-200"
            >
              {t('start.sample')}
            </button>
          </div>
          <p className="mt-4 font-mono text-[9px] leading-relaxed text-[#566b80]">{t('loading.errorHint')}</p>
        </div>
      </div>
    )
  }

  const pct = Math.round(progress * 100)
  const phaseText = phase ? t(phase) : t('loading.initializing')
  const poster = preview ?? THUMB

  return (
    <div className="loader">
      <div className="loader__card">
        <div className="loader__thumb" style={{ backgroundImage: `url(${poster})` }}>
          <div className="loader__thumb-shade" />
          <div className="loader__thumb-label">
            {meta ? `CBCT ${meta.volume.dims.join(' × ')}` : 'CBCT SERIES'}
          </div>
        </div>
        <div className="loader__body">
          <div className="loader__kicker">
            <span className="dot" /> {translate(lang, 'loading.kicker')}
          </div>
          <h1>
            {meta?.patient.name || 'CBCT'} <span>· {phaseText}</span>
          </h1>
          <div className="progress">
            <span style={{ width: `${Math.max(pct, 2)}%` }} />
          </div>
          <div className="loader__meta">
            <span>{pct}%</span>
            <span>
              {phaseText}
              {meta ? ` · ${meta.source.sliceCount} ${t('loading.slices')}` : ''}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
