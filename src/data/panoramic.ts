import type { DentalRoi, VolumeData } from '../types'
import { u8FromHu } from './volumeLoader'

type Point = { x: number; y: number }
type ArchSample = Point & { nx: number; ny: number }

export interface DentalArch {
  samples: ArchSample[]
  top: number
  bottom: number
  pixelSize: number
  length: number
}

const ANGLE_BINS = 25
const HALF_ANGLE = (108 * Math.PI) / 180
const POSTERIOR_MARGIN_MM = 10
const VERTICAL_MARGIN_MM = 18

function extendPosterior(end: Point, neighbor: Point): Point {
  const dx = end.x - neighbor.x
  const dy = end.y - neighbor.y
  const scale = POSTERIOR_MARGIN_MM / Math.hypot(dx, dy)
  return { x: end.x + dx * scale, y: end.y + dy * scale }
}

/** Estimate the arch in physical XY coordinates using dense tooth voxels in the ROI. */
export function estimateDentalArch(volume: VolumeData, dental: DentalRoi): DentalArch | null {
  const [width, height, depth] = volume.dims
  const [sx, sy, sz] = volume.spacing
  if (width < 2 || height < 2 || depth < 2 || !(sx > 0 && sy > 0 && sz > 0)) return null

  const { min, max } = dental.voxelBox
  const x0 = Math.max(0, Math.round(min[0] * width))
  const x1 = Math.min(width, Math.round(max[0] * width))
  const y0 = Math.max(0, Math.round(min[1] * height))
  const y1 = Math.min(height, Math.round(max[1] * height))
  const z0 = Math.max(0, Math.round(min[2] * depth))
  const z1 = Math.min(depth, Math.round(max[2] * depth))
  if (!(x1 > x0 && y1 > y0 && z1 > z0)) return null

  const centerX = ((x0 + x1 - 1) / 2) * sx
  const centerY = (y0 + (y1 - y0 - 1) * 0.86) * sy
  const minRadius = (x1 - x0) * sx * 0.22
  const threshold = u8FromHu(volume, Number(dental.stats?.thresholdHu ?? 1900))
  const plane = width * height
  const weight = new Float64Array(ANGLE_BINS)
  const radiusSum = new Float64Array(ANGLE_BINS)
  const angleStep = (2 * HALF_ANGLE) / (ANGLE_BINS - 1)

  for (let y = y0; y < y1; y++) {
    const dy = y * sy - centerY
    for (let x = x0; x < x1; x++) {
      const dx = x * sx - centerX
      const radius = Math.hypot(dx, dy)
      const bin = Math.round((Math.atan2(dx, -dy) + HALF_ANGLE) / angleStep)
      if (radius < minRadius || bin < 0 || bin >= ANGLE_BINS) continue

      let hits = 0
      for (let z = z0; z < z1 && hits < 8; z++) {
        if (volume.u8[z * plane + y * width + x] >= threshold) hits++
      }
      weight[bin] += hits
      radiusSum[bin] += hits * radius
    }
  }

  const known = Array.from(weight.keys()).filter((bin) => weight[bin] >= 6)
  if (known.length < ANGLE_BINS / 2) return null
  const radii = Array.from(weight, (_, bin) => {
    const next = known.findIndex((index) => index >= bin)
    const right = known[next] ?? known[known.length - 1]
    const left = known[next < 0 ? known.length - 1 : Math.max(0, next - 1)]
    const start = radiusSum[left] / weight[left]
    const end = radiusSum[right] / weight[right]
    return left === right ? start : start + ((end - start) * (bin - left)) / (right - left)
  })
  const points = radii.map((radius, i) => {
    const angle = i * angleStep - HALF_ANGLE
    const smoothed = (radii[Math.max(0, i - 1)] + 2 * radius + radii[Math.min(i + 1, radii.length - 1)]) / 4
    return { x: centerX + Math.sin(angle) * smoothed, y: centerY - Math.cos(angle) * smoothed }
  })

  // Include the jaw immediately behind the last dense tooth on each side.
  points.unshift(extendPosterior(points[0], points[1]))
  points.push(extendPosterior(points[points.length - 1], points[points.length - 2]))

  const distance = [0]
  for (let i = 1; i < points.length; i++) {
    distance.push(distance[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y))
  }
  const length = distance[distance.length - 1]
  const top = Math.min(depth - 1, z1 - 1 + Math.round(VERTICAL_MARGIN_MM / sz))
  const bottom = Math.max(0, z0 - Math.round(VERTICAL_MARGIN_MM / sz))
  if (top <= bottom || !(length > 0)) return null
  const pixelSize = Math.max(Math.min(sx, sy, sz), length / 800, ((top - bottom) * sz) / 500)
  const columns = Math.ceil(length / pixelSize) + 1
  const samples: ArchSample[] = []
  let segment = 0

  for (let i = 0; i < columns; i++) {
    const at = (length * i) / (columns - 1)
    while (at > distance[segment + 1] && segment < points.length - 2) segment++
    const a = points[segment]
    const b = points[segment + 1]
    const fraction = (at - distance[segment]) / (distance[segment + 1] - distance[segment])
    // Central tangents make slab normals continuous across the segments.
    const before = points[Math.max(0, segment - 1)]
    const after = points[Math.min(points.length - 1, segment + 2)]
    const dx = (b.x - before.x) * (1 - fraction) + (after.x - a.x) * fraction
    const dy = (b.y - before.y) * (1 - fraction) + (after.y - a.y) * fraction
    const norm = Math.hypot(dx, dy)
    samples.push({ x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction, nx: -dy / norm, ny: dx / norm })
  }

  return { samples, top, bottom, pixelSize, length }
}

/** Unfold a slab along the arch. The mean preserves bone texture and the peak keeps teeth visible. */
export function reconstructPanorama(volume: VolumeData, arch: DentalArch, thickness: number, offset: number) {
  const [width, height] = volume.dims
  const [sx, sy, sz] = volume.spacing
  const columns = arch.samples.length
  const rows = Math.ceil(((arch.top - arch.bottom) * sz) / arch.pixelSize) + 1
  const values = new Uint8Array(columns * rows)
  const plane = width * height
  const steps = Math.max(1, Math.ceil(thickness / Math.max(0.15, Math.min(sx, sy))))

  for (const [column, sample] of arch.samples.entries()) {
    const ray = []
    for (let i = 0; i <= steps; i++) {
      const distance = offset + thickness * (i / steps - 0.5)
      const x = (sample.x + sample.nx * distance) / sx
      const y = (sample.y + sample.ny * distance) / sy
      if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) continue
      const ix = Math.floor(x)
      const iy = Math.floor(y)
      ray.push({ index: iy * width + ix, fx: x - ix, fy: y - iy })
    }
    if (ray.length === 0) continue

    for (let row = 0; row < rows; row++) {
      const z = arch.top - ((arch.top - arch.bottom) * row) / (rows - 1)
      const slice = Math.floor(z) * plane
      const next = Math.min(arch.top, Math.floor(z) + 1) * plane
      const fz = z - Math.floor(z)
      let mean = 0
      let peak = 0
      for (const { index, fx, fy } of ray) {
        const at = slice + index
        const upper = next + index
        const lowerValue =
          (volume.u8[at] * (1 - fx) + volume.u8[at + 1] * fx) * (1 - fy) +
          (volume.u8[at + width] * (1 - fx) + volume.u8[at + width + 1] * fx) * fy
        const upperValue =
          (volume.u8[upper] * (1 - fx) + volume.u8[upper + 1] * fx) * (1 - fy) +
          (volume.u8[upper + width] * (1 - fx) + volume.u8[upper + width + 1] * fx) * fy
        const value = lowerValue * (1 - fz) + upperValue * fz
        mean += value
        peak = Math.max(peak, value)
      }
      values[row * columns + column] = Math.round((mean / ray.length) * 0.55 + peak * 0.45)
    }
  }

  return { width: columns, height: rows, values }
}
