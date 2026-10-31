import type { PresetId, RenderMode, VolumeMeta } from '../types'

export interface TransferStop {
  /** Hounsfield units at which this stop sits. */
  hu: number
  /** RGB in display (sRGB-ish) space, 0..1. */
  color: [number, number, number]
  /** Opacity 0..1 used by the composite renderer. */
  alpha: number
}

export interface VolumePreset {
  id: PresetId
  label: string
  hint: string
  mode: RenderMode
  stops: TransferStop[]
  /** Suggested sampling budget for this look. */
  steps: number
  /** Default global opacity multiplier. */
  opacity: number
  /** Normalized density trimmed away (MIP / X-ray cutoff). */
  densityMin: number
  /** X-ray absorption gain. */
  exposure: number
  /** UI accent color. */
  accent: string
}const BONE: TransferStop[] = [
  { hu: -1024, color: [0.02, 0.03, 0.05], alpha: 0 },
  { hu: -320, color: [0.2, 0.16, 0.12], alpha: 0.0015 },
  { hu: 110, color: [0.35, 0.28, 0.22], alpha: 0.004 },
  { hu: 240, color: [0.7, 0.56, 0.4], alpha: 0.022 },
  { hu: 420, color: [0.97, 0.89, 0.75], alpha: 0.3 },
  { hu: 760, color: [1, 0.97, 0.9], alpha: 0.74 },
  { hu: 1400, color: [1, 1, 0.98], alpha: 0.93 },
  { hu: 3400, color: [1, 1, 1], alpha: 0.97 },
]

export const PRESETS: VolumePreset[] = [
  {
    id: 'teeth',
    label: 'Teeth',
    hint: 'Dental arch only — teeth & roots',
    mode: 'composite',
    stops: [
      { hu: -1024, color: [0.01, 0.01, 0.02], alpha: 0 },
      { hu: 700, color: [0.28, 0.23, 0.19], alpha: 0 },
      { hu: 850, color: [0.5, 0.42, 0.34], alpha: 0 },
      { hu: 1250, color: [0.9, 0.86, 0.78], alpha: 0.18 },
      { hu: 1650, color: [1, 0.98, 0.94], alpha: 0.65 },
      { hu: 2200, color: [1, 1, 1], alpha: 0.96 },
      { hu: 3200, color: [1, 1, 1], alpha: 1 },
    ],
    steps: 224,
    opacity: 1,
    densityMin: 0.28,
    exposure: 1,
    accent: '#fbbf24',
  },
  {
    id: 'bone',
    label: 'Bone',
    hint: 'Cortical / trabecular bone',
    mode: 'composite',
    stops: BONE,
    steps: 192,
    opacity: 1,
    densityMin: 0.18,
    exposure: 1,
    accent: '#f3e6cf',
  },
  {
    id: 'dental',
    label: 'Dental',
    hint: 'Teeth & implants, cooler white',
    mode: 'composite',
    stops: [
      { hu: -1024, color: [0.02, 0.03, 0.05], alpha: 0 },
      { hu: 130, color: [0.3, 0.32, 0.36], alpha: 0.001 },
      { hu: 350, color: [0.55, 0.65, 0.8], alpha: 0.012 },
      { hu: 700, color: [0.86, 0.94, 1], alpha: 0.38 },
      { hu: 1200, color: [0.94, 0.98, 1], alpha: 0.82 },
      { hu: 2200, color: [1, 1, 1], alpha: 0.96 },
      { hu: 3400, color: [1, 1, 1], alpha: 0.98 },
    ],
    steps: 208,
    opacity: 1,
    densityMin: 0.24,
    exposure: 1,
    accent: '#cfe6ff',
  },
  {
    id: 'soft',
    label: 'Soft',
    hint: 'Translucent body, bone inside',
    mode: 'composite',
    stops: [
      { hu: -1024, color: [0.01, 0.02, 0.04], alpha: 0 },
      { hu: -400, color: [0.35, 0.18, 0.16], alpha: 0.0006 },
      { hu: -140, color: [0.62, 0.3, 0.26], alpha: 0.0014 },
      { hu: -20, color: [0.85, 0.45, 0.4], alpha: 0.0026 },
      { hu: 70, color: [0.95, 0.58, 0.5], alpha: 0.004 },
      { hu: 220, color: [0.8, 0.55, 0.48], alpha: 0.006 },
      { hu: 650, color: [0.95, 0.9, 0.84], alpha: 0.06 },
      { hu: 3400, color: [1, 1, 1], alpha: 0.5 },
    ],
    steps: 224,
    opacity: 1,
    densityMin: 0,
    exposure: 1,
    accent: '#f0a8a0',
  },
  {
    id: 'mip',
    label: 'MIP',
    hint: 'Maximum intensity projection',
    mode: 'mip',
    stops: [
      { hu: -1024, color: [0.01, 0.02, 0.04], alpha: 0 },
      { hu: 100, color: [0.04, 0.07, 0.11], alpha: 0 },
      { hu: 350, color: [0.1, 0.18, 0.26], alpha: 0 },
      { hu: 700, color: [0.35, 0.5, 0.65], alpha: 0 },
      { hu: 1200, color: [0.8, 0.9, 1], alpha: 0 },
      { hu: 2000, color: [1, 1, 1], alpha: 0 },
      { hu: 3400, color: [1, 1, 1], alpha: 0 },
    ],
    steps: 208,
    opacity: 1,
    densityMin: 0.3,
    exposure: 1,
    accent: '#a5b4fc',
  },
  {
    id: 'xray',
    label: 'X-ray',
    hint: 'Integrated absorption (DRR)',
    mode: 'xray',
    stops: [
      { hu: -1024, color: [0.01, 0.03, 0.06], alpha: 0 },
      { hu: 200, color: [0.08, 0.26, 0.55], alpha: 0 },
      { hu: 900, color: [0.32, 0.62, 0.92], alpha: 0 },
      { hu: 2000, color: [0.8, 0.92, 1], alpha: 0 },
      { hu: 3400, color: [1, 1, 1], alpha: 0 },
    ],
    steps: 224,
    opacity: 1,
    densityMin: 0.1,
    exposure: 3.2,
    accent: '#7dd3fc',
  },
  {
    id: 'heat',
    label: 'Heat',
    hint: 'Thermal density map',
    mode: 'composite',
    stops: [
      { hu: -1024, color: [0.02, 0.0, 0.08], alpha: 0 },
      { hu: 160, color: [0.2, 0.02, 0.3], alpha: 0.005 },
      { hu: 320, color: [0.55, 0.05, 0.5], alpha: 0.05 },
      { hu: 550, color: [0.9, 0.2, 0.25], alpha: 0.22 },
      { hu: 900, color: [1, 0.55, 0.1], alpha: 0.5 },
      { hu: 1500, color: [1, 0.9, 0.4], alpha: 0.8 },
      { hu: 2600, color: [1, 1, 0.92], alpha: 0.95 },
      { hu: 3400, color: [1, 1, 1], alpha: 0.98 },
    ],
    steps: 192,
    opacity: 1,
    densityMin: 0.18,
    exposure: 1,
    accent: '#fb923c',
  },
  {
    id: 'teal',
    label: 'Teal',
    hint: 'Surgical / holographic look',
    mode: 'composite',
    stops: [
      { hu: -1024, color: [0.0, 0.03, 0.05], alpha: 0 },
      { hu: 140, color: [0.05, 0.25, 0.3], alpha: 0.005 },
      { hu: 330, color: [0.1, 0.6, 0.62], alpha: 0.05 },
      { hu: 600, color: [0.3, 0.85, 0.82], alpha: 0.24 },
      { hu: 1000, color: [0.62, 0.98, 0.94], alpha: 0.62 },
      { hu: 1800, color: [0.88, 1, 0.99], alpha: 0.9 },
      { hu: 3400, color: [1, 1, 1], alpha: 0.96 },
    ],
    steps: 192,
    opacity: 1,
    densityMin: 0.2,
    exposure: 1,
    accent: '#2dd4bf',
  },
]

export const PRESET_BY_ID = Object.fromEntries(PRESETS.map((p) => [p.id, p])) as Record<PresetId, VolumePreset>

export function huToNorm(hu: number, quantRange: [number, number]): number {
  const [lo, hi] = quantRange
  return Math.min(1, Math.max(0, (hu - lo) / (hi - lo)))
}

/**
 * Rasterize a preset's transfer function into a 256 x 1 RGBA LUT.
 * The LUT is indexed by normalized density, matching the 8-bit volume texture.
 */
export function buildTransferLut(preset: VolumePreset, quantRange: [number, number]): Uint8Array {
  const [lo, hi] = quantRange
  const stops = [...preset.stops].sort((a, b) => a.hu - b.hu)
  const lut = new Uint8Array(256 * 4)
  let seg = 0
  for (let i = 0; i < 256; i++) {
    const hu = lo + (i / 255) * (hi - lo)
    while (seg < stops.length - 2 && hu > stops[seg + 1].hu) seg++
    const a = stops[seg]
    const b = stops[seg + 1] ?? a
    const t = b.hu === a.hu ? 0 : Math.min(1, Math.max(0, (hu - a.hu) / (b.hu - a.hu)))
    const o = i * 4
    lut[o] = Math.round(255 * (a.color[0] + (b.color[0] - a.color[0]) * t))
    lut[o + 1] = Math.round(255 * (a.color[1] + (b.color[1] - a.color[1]) * t))
    lut[o + 2] = Math.round(255 * (a.color[2] + (b.color[2] - a.color[2]) * t))
    lut[o + 3] = Math.round(255 * (a.alpha + (b.alpha - a.alpha) * t))
  }
  return lut
}

export function defaultWindow(meta: VolumeMeta): { center: number; width: number } {
  const bone = meta.windows.find((w) => w.id === 'bone') ?? meta.windows[0]
  return { center: bone?.center ?? 600, width: bone?.width ?? 2600 }
}
