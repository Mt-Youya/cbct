import { create } from 'zustand'
import type { Cursor, DentalRoi, Lang, MprAxis, PresetId, VolumeData, VolumeMeta } from '../types'
import { defaultWindow, PRESET_BY_ID } from '../data/presets'
import { fetchDentalRoi, fetchVolumeData, fetchVolumeMeta } from '../data/volumeLoader'
import { importDicomFiles } from '../data/dicomImport'
import { clampCursor } from '../data/mprRange'
import type { ImportProgress } from '../data/dicomImport'
import type { MessageKey } from '../i18n'

type Status = 'idle' | 'loading' | 'ready' | 'error'

export type WorkspaceLayout = 'quad' | 'mpr' | '3d' | MprAxis | 'panorama' | 'dentalSection' | 'oblique'

interface ViewerState {
  status: Status
  phase: MessageKey | ''
  progress: number
  error: string | null
  meta: VolumeMeta | null
  volume: VolumeData | null
  dental: DentalRoi | null
  /** PNG data URL preview of a locally imported study (loading screen poster). */
  preview: string | null

  lang: Lang
  presetId: PresetId
  lastPreset: PresetId
  teethOnly: boolean
  opacity: number
  steps: number
  clip: number
  autoRotate: boolean
  showBox: boolean
  showGrid: boolean

  windowCenter: number
  windowWidth: number
  cursor: Cursor
  lockSliceRange: boolean

  layout: WorkspaceLayout
  settingsOpen: boolean
  /** Interface text scale (1 = 100%). Persisted in localStorage. */
  uiScale: number
  leftOpen: boolean
  rightOpen: boolean
  fps: number

  load: () => Promise<void>
  importFiles: (files: File[]) => Promise<void>
  setLang: (lang: Lang) => void
  toggleLang: () => void
  setPreset: (id: PresetId) => void
  setTeethOnly: (value: boolean) => void
  setOpacity: (value: number) => void
  setSteps: (value: number) => void
  setClip: (value: number) => void
  setAutoRotate: (value: boolean) => void
  setShowBox: (value: boolean) => void
  setShowGrid: (value: boolean) => void
  setWindow: (center: number, width: number) => void
  setCursor: (cursor: Partial<Cursor>) => void
  setLockSliceRange: (locked: boolean) => void
  nudgeCursor: (axis: 'x' | 'y' | 'z', delta: number) => void
  toggleLeft: () => void
  toggleRight: () => void
  setLayout: (layout: WorkspaceLayout) => void
  setSettingsOpen: (open: boolean) => void
  toggleSettings: () => void
  setUiScale: (scale: number) => void
  setFps: (fps: number) => void
}

const initialPreset = PRESET_BY_ID.bone

/** Phones/tablets only show one overlay panel at a time. */
function isNarrowViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 980px)').matches
}

function detectLang(): Lang {
  if (typeof window === 'undefined') return 'zh'
  const stored = window.localStorage.getItem('cbct-lang')
  if (stored === 'zh' || stored === 'en') return stored
  return 'zh'
}

function detectUiScale(): number {
  if (typeof window === 'undefined') return 1.18
  const stored = Number(window.localStorage.getItem('cbct-ui-scale'))
  if (Number.isFinite(stored) && stored >= 0.8 && stored <= 1.6) return stored
  return 1.18
}

export const useViewerStore = create<ViewerState>()((set, get) => ({
  status: 'idle',
  phase: '',
  progress: 0,
  error: null,
  meta: null,
  volume: null,
  dental: null,
  preview: null,

  lang: detectLang(),
  presetId: 'bone',
  lastPreset: 'bone',
  teethOnly: false,
  opacity: initialPreset.opacity,
  steps: initialPreset.steps,
  clip: 1,
  autoRotate: true,
  showBox: true,
  showGrid: true,

  windowCenter: 600,
  windowWidth: 2600,
  cursor: { x: 160, y: 160, z: 100 },
  lockSliceRange: true,

  layout: 'quad',
  settingsOpen: false,
  uiScale: detectUiScale(),
  leftOpen: !isNarrowViewport(),
  rightOpen: !isNarrowViewport(),
  fps: 0,

  load: async () => {
    const { status } = get()
    if (status === 'loading' || status === 'ready') return
    set({ status: 'loading', phase: 'loading.meta', progress: 0, error: null, preview: null })
    try {
      const meta = await fetchVolumeMeta()
      set({ meta, phase: 'loading.volume' })
      const [volume, dental] = await Promise.all([
        fetchVolumeData(meta, (progress) => set({ progress })),
        fetchDentalRoi(meta),
      ])
      const [w, h, d] = meta.volume.dims
      const window = defaultWindow(meta)
      set({
        volume,
        dental,
        status: 'ready',
        phase: 'loading.ready',
        progress: 1,
        windowCenter: window.center,
        windowWidth: window.width,
        cursor: clampCursor(volume, { x: Math.floor(w / 2), y: Math.floor(h / 2), z: Math.floor(d / 2) }, get().lockSliceRange),
      })
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },

  importFiles: async (files) => {
    if (!files.length) return
    const phaseByStep: Record<ImportProgress['phase'], MessageKey> = {
      read: 'loading.import',
      parse: 'loading.parse',
      volume: 'loading.importVolume',
      roi: 'loading.importRoi',
      done: 'loading.ready',
    }
    set({ status: 'loading', phase: 'loading.import', progress: 0, error: null, preview: null })
    try {
      const result = await importDicomFiles(files, (progress) => {
        set({
          phase: phaseByStep[progress.phase] ?? 'loading.parse',
          progress: progress.total > 0 ? Math.min(0.99, progress.done / progress.total) : 0,
        })
      })
      const [w, h, d] = result.meta.volume.dims
      const window = defaultWindow(result.meta)
      set({
        meta: result.meta,
        volume: result.volume,
        dental: result.dental,
        preview: result.previewDataUrl,
        status: 'ready',
        phase: 'loading.ready',
        progress: 1,
        windowCenter: window.center,
        windowWidth: window.width,
        cursor: clampCursor(result.volume, { x: Math.floor(w / 2), y: Math.floor(h / 2), z: Math.floor(d / 2) }, get().lockSliceRange),
        teethOnly: false,
        presetId: 'bone',
        lastPreset: 'bone',
        opacity: PRESET_BY_ID.bone.opacity,
        steps: PRESET_BY_ID.bone.steps,
      })
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },

  setLang: (lang) => {
    if (typeof window !== 'undefined') window.localStorage.setItem('cbct-lang', lang)
    set({ lang })
  },
  toggleLang: () => get().setLang(get().lang === 'zh' ? 'en' : 'zh'),

  setPreset: (id) => {
    const preset = PRESET_BY_ID[id]
    const teethOnly = id === 'teeth' && Boolean(get().dental)
    set({
      presetId: id,
      teethOnly,
      opacity: preset.opacity,
      steps: preset.steps,
      lastPreset: id === 'teeth' ? get().lastPreset : id,
    })
  },
  setTeethOnly: (value) => {
    if (value) {
      if (!get().dental) return
      set({
        teethOnly: true,
        lastPreset: get().presetId === 'teeth' ? get().lastPreset : get().presetId,
        presetId: 'teeth',
        opacity: PRESET_BY_ID.teeth.opacity,
        steps: PRESET_BY_ID.teeth.steps,
      })
    } else {
      const preset = PRESET_BY_ID[get().lastPreset]
      set({
        teethOnly: false,
        presetId: get().lastPreset,
        opacity: preset.opacity,
        steps: preset.steps,
      })
    }
  },
  setOpacity: (value) => set({ opacity: value }),
  setSteps: (value) => set({ steps: value }),
  setClip: (value) => set({ clip: value }),
  setAutoRotate: (value) => set({ autoRotate: value }),
  setShowBox: (value) => set({ showBox: value }),
  setShowGrid: (value) => set({ showGrid: value }),
  setWindow: (center, width) => set({ windowCenter: center, windowWidth: Math.max(1, width) }),
  setCursor: (cursor) => {
    const { volume, cursor: current, lockSliceRange } = get()
    if (!volume) return
    const next = clampCursor(volume, {
      x: cursor.x ?? current.x,
      y: cursor.y ?? current.y,
      z: cursor.z ?? current.z,
    }, lockSliceRange)
    if (next.x !== current.x || next.y !== current.y || next.z !== current.z) set({ cursor: next })
  },
  setLockSliceRange: (lockSliceRange) => set(({ volume, cursor }) => ({
    lockSliceRange,
    cursor: volume ? clampCursor(volume, cursor, lockSliceRange) : cursor,
  })),
  nudgeCursor: (axis, delta) => {
    const cursor = get().cursor
    get().setCursor({ [axis]: cursor[axis] + delta } as Partial<Cursor>)
  },
  toggleLeft: () =>
    set((state) => {
      const opening = !state.leftOpen
      return { leftOpen: opening, rightOpen: opening && isNarrowViewport() ? false : state.rightOpen }
    }),
  toggleRight: () =>
    set((state) => {
      const opening = !state.rightOpen
      return { rightOpen: opening, leftOpen: opening && isNarrowViewport() ? false : state.leftOpen }
    }),
  setFps: (fps) => set({ fps }),
  setLayout: (layout) => set({ layout }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  toggleSettings: () => set((state) => ({ settingsOpen: !state.settingsOpen })),
  setUiScale: (scale) => {
    const clamped = Math.min(1.6, Math.max(0.8, scale))
    if (typeof window !== 'undefined') window.localStorage.setItem('cbct-ui-scale', String(clamped))
    set({ uiScale: clamped })
  },
}))
