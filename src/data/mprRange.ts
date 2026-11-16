import type { Cursor, VolumeData } from '../types'

type Bounds = { min: number; max: number }
type Navigation = { limits: Record<keyof Cursor, Bounds>; background: number | null }
const navigationCache = new WeakMap<VolumeData, Navigation>()

export function mprNavigation(volume: VolumeData): Navigation {
  const cached = navigationCache.get(volume)
  if (cached) return cached

  const [w, h, d] = volume.dims
  const lastSlice = w * h * (d - 1)
  const lastRow = w * (h - 1)
  const corners = [0, w - 1, lastRow, lastRow + w - 1, lastSlice, lastSlice + w - 1, lastSlice + lastRow, w * h * d - 1]
  const [low, high] = volume.quantRange
  const air = ((-850 - low) * 255) / (high - low)
  const limits = { x: { min: 0, max: w - 1 }, y: { min: 0, max: h - 1 }, z: { min: 0, max: d - 1 } }
  const result: Navigation = { limits, background: null }

  // Check for an air-like border before assuming this scan's gray values
  // can distinguish background. A questionable range keeps the full stack.
  if (low <= -850 && high > 0 && corners.filter((index) => volume.u8[index] <= air).length >= 6) {
    const cutoff = Math.floor(((-550 - low) * 255) / (high - low))
    let minX = w
    let minY = h
    let minZ = d
    let maxX = -1
    let maxY = -1
    let maxZ = -1
    for (let z = 0, index = 0; z < d; z++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++, index++) {
          if (volume.u8[index] <= cutoff) continue
          if (x < minX) minX = x
          if (y < minY) minY = y
          if (z < minZ) minZ = z
          if (x > maxX) maxX = x
          if (y > maxY) maxY = y
          if (z > maxZ) maxZ = z
        }
      }
    }
    if (maxX >= 0) {
      result.limits = { x: { min: minX, max: maxX }, y: { min: minY, max: maxY }, z: { min: minZ, max: maxZ } }
      result.background = cutoff
    }
  }

  navigationCache.set(volume, result)
  return result
}

export function clampCursor(volume: VolumeData, cursor: Cursor, lock: boolean): Cursor {
  const [w, h, d] = volume.dims
  const limits = lock ? mprNavigation(volume).limits : null
  const clamp = (axis: keyof Cursor, max: number) => {
    const range = limits?.[axis]
    return Math.max(range?.min ?? 0, Math.min(range?.max ?? max, Math.round(cursor[axis])))
  }
  return { x: clamp('x', w - 1), y: clamp('y', h - 1), z: clamp('z', d - 1) }
}
