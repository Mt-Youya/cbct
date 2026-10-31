import type { DentalRoi, Vec3, VolumeData, VolumeMeta } from '../types'

/**
 * Browser-side dental arch heuristic.
 *
 * The dentition is the brightest structure in a dental CBCT: enamel is far denser
 * than cortical bone, so a high-HU ("enamel core") threshold isolates both arches
 * without a skull-base / spine segmentation. The arch sits in the anterior part of
 * the FOV, so a loose anterior guard box removes the cervical spine and skull base
 * before the core voxels are measured.
 *
 * The box is derived from per-axis histograms of the core voxels (robust percentile
 * extents), then extended by a root-length allowance in z and a small x/y margin.
 * The whole analysis is two typed-array passes over the volume, keeping it well
 * below a second for a 320×320×200 volume.
 *
 * Returns null when the result does not look like a dental arch (too few dense
 * voxels, or a box spanning more than 85% of every axis), which is how the UI
 * decides to disable the teeth-only view.
 */

/** Enamel-core thresholds, tried from the most selective to the most permissive. */
const CORE_THRESHOLDS_HU = [1900, 1700, 1500]
/** Nominal transfer-function thresholds recorded in the ROI metadata. */
const TOOTH_MIN_HU = 1250
const ENAMEL_MIN_HU = 2200
const BONE_MIN_HU = 850

/** Root length below/above the enamel core (cemento-enamel junction -> apex). */
const ROOT_LENGTH_MM = 14
/** Margin around the core in x / y. */
const XY_MARGIN_MM = 3

/** Loose anterior guard box, as fractions of the volume dimensions. */
const GUARD_X_MIN = 0.1
const GUARD_X_MAX = 0.9
const GUARD_Y_MAX = 0.62
const GUARD_Z_MIN = 0.12
const GUARD_Z_MAX = 0.88

/** Reject a candidate when the arch core is this sparse inside the guard box. */
const MIN_CORE_VOXELS = 200
const MIN_DENSE_SHARE = 0.0002
/** Reject a box that covers more than this share of any axis. */
const MAX_AXIS_SHARE = 0.85
/** Robust extents from the core histograms: central 99% (x/y) and 98% (z). */
const XY_PERCENTILE = 0.005
const Z_PERCENTILE = 0.01

/** Fallback for scans with non-HU gray values: densest 0.15% of the guard box. */
const ADAPTIVE_TOP_SHARE = 0.0015

interface ThresholdStats {
  count: number
  histX: Int32Array
  histY: Int32Array
  histZ: Int32Array
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function createStats(width: number, height: number, depth: number): ThresholdStats {
  return {
    count: 0,
    histX: new Int32Array(width),
    histY: new Int32Array(height),
    histZ: new Int32Array(depth),
  }
}

/** Uses the volume spacing when valid, otherwise the metadata spacing, otherwise 1 mm. */
function pickSpacing(value: number | undefined, fallback: number | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof fallback === 'number' && Number.isFinite(fallback) && fallback > 0) return fallback
  return 1
}

interface GuardBox {
  x0: number
  x1: number
  y0: number
  y1: number
  z0: number
  z1: number
}

/**
 * Scans the guard box once and records the core voxel count plus per-axis histograms
 * for every supplied u8 threshold.
 */
function collectStats(
  u8: Uint8Array,
  width: number,
  height: number,
  depth: number,
  guard: GuardBox,
  thresholds: number[],
): ThresholdStats[] {
  const stats = thresholds.map(() => createStats(width, height, depth))
  const high = thresholds[0]
  const middle = thresholds[1]
  const low = thresholds[2]
  const { x0, x1, y0, y1, z0, z1 } = guard
  for (let z = z0; z <= z1; z++) {
    const zBase = z * width * height
    for (let y = y0; y <= y1; y++) {
      const rowBase = zBase + y * width
      for (let x = x0; x <= x1; x++) {
        const value = u8[rowBase + x]
        if (value < low) continue
        stats[2].count++
        stats[2].histX[x]++
        stats[2].histY[y]++
        stats[2].histZ[z]++
        if (value < middle) continue
        stats[1].count++
        stats[1].histX[x]++
        stats[1].histY[y]++
        stats[1].histZ[z]++
        if (value < high) continue
        stats[0].count++
        stats[0].histX[x]++
        stats[0].histY[y]++
        stats[0].histZ[z]++
      }
    }
  }
  return stats
}

/** Adaptive fallback: threshold the guard box at the densest ADAPTIVE_TOP_SHARE. */
function collectAdaptiveStats(
  u8: Uint8Array,
  width: number,
  height: number,
  depth: number,
  guard: GuardBox,
  guardVoxels: number,
): { stats: ThresholdStats; thresholdU8: number } | null {
  const histogram = new Uint32Array(256)
  const { x0, x1, y0, y1, z0, z1 } = guard
  for (let z = z0; z <= z1; z++) {
    const zBase = z * width * height
    for (let y = y0; y <= y1; y++) {
      const rowBase = zBase + y * width
      for (let x = x0; x <= x1; x++) histogram[u8[rowBase + x]]++
    }
  }

  const target = Math.max(MIN_CORE_VOXELS, Math.ceil(ADAPTIVE_TOP_SHARE * guardVoxels))
  let cumulative = 0
  let thresholdU8 = -1
  for (let value = 255; value >= 0; value--) {
    cumulative += histogram[value]
    if (cumulative >= target) {
      thresholdU8 = value
      break
    }
  }
  if (thresholdU8 < 0 || cumulative < MIN_CORE_VOXELS) return null

  const stats = createStats(width, height, depth)
  for (let z = z0; z <= z1; z++) {
    const zBase = z * width * height
    for (let y = y0; y <= y1; y++) {
      const rowBase = zBase + y * width
      for (let x = x0; x <= x1; x++) {
        if (u8[rowBase + x] < thresholdU8) continue
        stats.count++
        stats.histX[x]++
        stats.histY[y]++
        stats.histZ[z]++
      }
    }
  }
  return stats.count >= MIN_CORE_VOXELS ? { stats, thresholdU8 } : null
}

/** Robust axis extent (inclusive voxel indices) from a core-voxel histogram. */
function histogramBounds(hist: Int32Array, total: number, lowPercentile: number): [number, number] {
  const lowTarget = Math.max(1, Math.round(total * lowPercentile))
  const highTarget = Math.max(lowTarget, Math.ceil(total * (1 - lowPercentile)))
  let cumulative = 0
  let low = 0
  let high = hist.length - 1
  let foundLow = false
  for (let i = 0; i < hist.length; i++) {
    cumulative += hist[i]
    if (!foundLow && cumulative >= lowTarget) {
      low = i
      foundLow = true
    }
    if (cumulative >= highTarget) {
      high = i
      break
    }
  }
  return [Math.max(0, low - 1), Math.min(hist.length - 1, high + 1)]
}

/**
 * Heuristically locates the dental arch ROI in a downsampled CBCT volume.
 * Pure typed-array math; safe to run on the main thread.
 */
export function computeDentalRoi(volume: VolumeData, meta: VolumeMeta): DentalRoi | null {
  const [width, height, depth] = volume.dims
  if (width < 4 || height < 4 || depth < 4) return null
  if (volume.u8.length < width * height * depth) return null

  const [quantLow, quantHigh] = volume.quantRange
  const quantSpan = quantHigh - quantLow
  if (!(quantSpan > 0)) return null
  const u8FromHu = (hu: number): number => clamp(Math.round(((hu - quantLow) / quantSpan) * 255), 0, 255)

  const guard: GuardBox = {
    x0: Math.round(GUARD_X_MIN * width),
    x1: Math.round(GUARD_X_MAX * width),
    y0: 0,
    y1: Math.round(GUARD_Y_MAX * height),
    z0: Math.round(GUARD_Z_MIN * depth),
    z1: Math.round(GUARD_Z_MAX * depth),
  }
  guard.x1 = Math.min(width - 1, guard.x1)
  guard.y1 = Math.min(height - 1, guard.y1)
  guard.z1 = Math.min(depth - 1, guard.z1)
  if (guard.x0 < 0 || guard.y1 <= guard.y0 || guard.z1 <= guard.z0 || guard.x1 <= guard.x0) return null
  const guardVoxels = (guard.x1 - guard.x0 + 1) * (guard.y1 - guard.y0 + 1) * (guard.z1 - guard.z0 + 1)

  const thresholds = CORE_THRESHOLDS_HU.map(u8FromHu)
  const thresholdStats = collectStats(volume.u8, width, height, depth, guard, thresholds)

  let stats: ThresholdStats | null = null
  let thresholdU8 = thresholds[0]
  for (let index = 0; index < thresholdStats.length; index++) {
    const candidate = thresholdStats[index]
    if (candidate.count >= MIN_CORE_VOXELS && candidate.count / guardVoxels >= MIN_DENSE_SHARE) {
      stats = candidate
      thresholdU8 = thresholds[index]
      break
    }
  }
  if (!stats) {
    const adaptive = collectAdaptiveStats(volume.u8, width, height, depth, guard, guardVoxels)
    if (!adaptive) return null
    stats = adaptive.stats
    thresholdU8 = adaptive.thresholdU8
  }

  const coreVoxels = stats.count
  const denseShare = coreVoxels / guardVoxels
  if (coreVoxels < MIN_CORE_VOXELS || denseShare < MIN_DENSE_SHARE) return null

  const [coreX0, coreX1] = histogramBounds(stats.histX, coreVoxels, XY_PERCENTILE)
  const [coreY0, coreY1] = histogramBounds(stats.histY, coreVoxels, XY_PERCENTILE)
  const [coreZ0, coreZ1] = histogramBounds(stats.histZ, coreVoxels, Z_PERCENTILE)
  if (coreX1 <= coreX0 || coreY1 <= coreY0 || coreZ1 <= coreZ0) return null

  const [volumeSpacingX, volumeSpacingY, volumeSpacingZ] = volume.spacing
  const [metaSpacingX, metaSpacingY, metaSpacingZ] = meta.volume.spacing
  const sx = pickSpacing(volumeSpacingX, metaSpacingX)
  const sy = pickSpacing(volumeSpacingY, metaSpacingY)
  const sz = pickSpacing(volumeSpacingZ, metaSpacingZ)

  const xPad = Math.max(1, Math.round(XY_MARGIN_MM / sx))
  const yPad = Math.max(1, Math.round(XY_MARGIN_MM / sy))
  const zPad = Math.max(1, Math.round(ROOT_LENGTH_MM / sz))

  const x0 = clamp(coreX0 - xPad, 0, width - 1)
  const x1 = clamp(coreX1 + xPad, 0, width - 1)
  const y0 = clamp(coreY0 - yPad, 0, height - 1)
  const y1 = clamp(coreY1 + yPad, 0, height - 1)
  const z0 = clamp(coreZ0 - zPad, 0, depth - 1)
  const z1 = clamp(coreZ1 + zPad, 0, depth - 1)
  if (x1 - x0 < 1 || y1 - y0 < 1 || z1 - z0 < 1) return null

  // A dental arch is compact: a box covering almost every axis is not plausible.
  if ((x1 - x0 + 1) / width > MAX_AXIS_SHARE) return null
  if ((y1 - y0 + 1) / height > MAX_AXIS_SHARE) return null
  if ((z1 - z0 + 1) / depth > MAX_AXIS_SHARE) return null

  // Coverage statistics for the proposed box (informational, cheap).
  const toothU8 = u8FromHu(TOOTH_MIN_HU)
  const enamelU8 = u8FromHu(ENAMEL_MIN_HU)
  let boxVoxels = 0
  let toothVoxels = 0
  let enamelVoxels = 0
  for (let z = z0; z <= z1; z++) {
    const zBase = z * width * height
    for (let y = y0; y <= y1; y++) {
      const rowBase = zBase + y * width
      for (let x = x0; x <= x1; x++) {
        const value = volume.u8[rowBase + x]
        boxVoxels++
        if (value >= toothU8) toothVoxels++
        if (value >= enamelU8) enamelVoxels++
      }
    }
  }

  const thresholdHu = Math.round(quantLow + (thresholdU8 / 255) * quantSpan)
  const normalized = (voxel: number, dim: number): number => round(voxel / dim, 6)
  const millimeters = (voxel: number, spacing: number): number => round(voxel * spacing, 2)

  const voxelBox = {
    min: [normalized(x0, width), normalized(y0, height), normalized(z0, depth)] as Vec3,
    max: [normalized(x1 + 1, width), normalized(y1 + 1, height), normalized(z1 + 1, depth)] as Vec3,
  }
  const worldBoxMm = {
    min: [millimeters(x0, sx), millimeters(y0, sy), millimeters(z0, sz)] as Vec3,
    max: [millimeters(x1 + 1, sx), millimeters(y1 + 1, sy), millimeters(z1 + 1, sz)] as Vec3,
  }

  return {
    version: 1,
    voxelBox,
    worldBoxMm,
    hu: {
      toothMin: TOOTH_MIN_HU,
      enamelMin: ENAMEL_MIN_HU,
      boneMin: BONE_MIN_HU,
    },
    stats: {
      method: 'browser heuristic',
      thresholdHu,
      thresholdU8,
      coreVoxels,
      guardVoxels,
      denseSharePct: round(denseShare * 100, 3),
      boxVoxels,
      toothVoxels,
      enamelVoxels,
      voxelBounds: { x: [x0, x1], y: [y0, y1], z: [z0, z1] },
      coreBounds: {
        x: [coreX0, coreX1],
        y: [coreY0, coreY1],
        z: [coreZ0, coreZ1],
      },
      dims: [width, height, depth],
      spacingMm: [sx, sy, sz],
      marginMm: [XY_MARGIN_MM, XY_MARGIN_MM, ROOT_LENGTH_MM],
    },
  }
}
