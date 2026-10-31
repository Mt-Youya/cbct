import type { DentalRoi, VolumeData, VolumeMeta } from '../types'

const DATA_BASE = `${import.meta.env.BASE_URL}data/`

async function fetchBytes(url: string, onLoaded: (loaded: number) => void): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to load ${url} (HTTP ${response.status})`)
  const total = Number(response.headers.get('content-length') ?? 0)
  if (!response.body) {
    const buffer = await response.arrayBuffer()
    onLoaded(buffer.byteLength)
    return new Uint8Array(buffer)
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    onLoaded(loaded)
  }
  if (total > 0 && loaded !== total) {
    // Truncated transfer is a hard error: a half volume renders as garbage.
    throw new Error(`Truncated download for ${url} (${loaded}/${total} bytes)`)
  }
  const bytes = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export async function fetchVolumeMeta(): Promise<VolumeMeta> {
  const response = await fetch(`${DATA_BASE}volume.json`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Failed to load volume.json (HTTP ${response.status})`)
  const meta = (await response.json()) as VolumeMeta
  if (meta.schema !== 'cbct-volume/1') throw new Error(`Unsupported volume schema: ${meta.schema}`)
  return meta
}

/** Optional dental-arch ROI; the app falls back gracefully when it is absent. */
export async function fetchDentalRoi(meta: VolumeMeta): Promise<DentalRoi | null> {
  const file = meta.files.dental ?? 'dental.json'
  try {
    const response = await fetch(`${DATA_BASE}${file}`, { cache: 'no-store' })
    if (!response.ok) return null
    const roi = (await response.json()) as DentalRoi
    if (!roi.voxelBox?.min || !roi.voxelBox?.max) return null
    return roi
  } catch {
    return null
  }
}

export async function fetchVolumeData(
  meta: VolumeMeta,
  onProgress: (fraction: number) => void,
): Promise<VolumeData> {
  const [w, h, d] = meta.volume.dims
  const voxels = w * h * d
  const u8 = await fetchBytes(`${DATA_BASE}${meta.files.u8}`, (loaded) =>
    onProgress(Math.min(0.99, loaded / voxels)),
  )
  if (u8.byteLength !== voxels) {
    throw new Error(`u8 volume has ${u8.byteLength} bytes, expected ${voxels}`)
  }
  onProgress(1)
  return {
    u8,
    dims: [w, h, d],
    spacing: meta.volume.spacing,
    quantRange: meta.volume.quantRange,
  }
}

export function huFromU8(volume: VolumeData, value: number): number {
  const [lo, hi] = volume.quantRange
  return lo + (value / 255) * (hi - lo)
}

export function u8FromHu(volume: VolumeData, hu: number): number {
  const [lo, hi] = volume.quantRange
  const norm = (hu - lo) / (hi - lo)
  return Math.max(0, Math.min(255, Math.round(norm * 255)))
}

export function huAtVoxel(volume: VolumeData, x: number, y: number, z: number): number {
  const [w, h, d] = volume.dims
  const cx = Math.max(0, Math.min(w - 1, x))
  const cy = Math.max(0, Math.min(h - 1, y))
  const cz = Math.max(0, Math.min(d - 1, z))
  return huFromU8(volume, volume.u8[(cz * h + cy) * w + cx])
}
