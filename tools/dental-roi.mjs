#!/usr/bin/env node
/**
 * Dental-arch ROI analysis for the CBCT volume.
 *
 * Reads  public/data/volume.json + volume_u8.bin, locates the dentition
 * (both arches, i.e. the U-shaped band of very dense voxels in the anterior /
 * mid part of the scan) and writes:
 *
 *   public/data/dental.json          normalized 3D AABB + HU thresholds + stats
 *   tools/dental-preview/*.png       MPR crops / MIPs / placement overlay
 *
 * No new dependencies: only node:fs, node:path, node:zlib + a ~30 line PNG
 * encoder. Pure typed-array math, runs in a couple of seconds.
 *
 * -- Coordinate / axis conventions (verified against the DICOM series) -------
 * The volume is uint8, layout x fastest, then y, then z:
 *     index = x + y*W + z*W*H        dims [W,H,D] = [320,320,200]
 *     HU    = u8/255 * (qMax-qMin) + qMin   (qMin=-1024, qMax=3400)
 * The DICOM slices have ImagePositionPatient z increasing 0 -> 99.75 mm and
 * axial orientation, so volume z index 0 = inferior (mandible side) and
 * z = D-1 = superior. Volume y = 0 is the anterior (labial / front) side;
 * y increases towards the back of the head (posterior, cervical spine side).
 * The renderer's fragment shader samples
 *     uv = vec3(p.x + 0.5, 0.5 - p.z, p.y + 0.5)   (vertex -> texture space)
 * where uv.x = volume x, uv.y = volume y, uv.z = volume z. The `voxelBox`
 * written here is expressed in that same texture/UV space: voxel index i has
 * its center at uv = (i + 0.5) / n, and the box faces are placed at voxel
 * boundaries, i.e.  min = firstVoxel / n, max = (lastVoxel + 1) / n.
 * A shader can therefore test  `any(lessThan(uv, min)) || any(greaterThan(uv, max))`.
 *
 * -- ROI heuristic, from coarse to fine -------------------------------------
 * 1. "Enamel core": HU >= 1900. In this scan that threshold selects virtually
 *    only tooth substance (6.6k voxels), all in the dental anterior band; the
 *    cortical bone of the mandible/skull is below it (its p99 is ~1.45 kHU)
 *    and the cervical spine + skull base are spatially far away. So this is a
 *    much sharper tooth detector than a generic "bone" threshold (~1000 HU),
 *    which would also fire on the mandible and skull base.
 * 2. Guard box: keep voxels in the central part of the FOV (y < 0.62 H,
 *    0.12 W < x < 0.88 W, 0.15 D < z < 0.85 D). This drops rare high-density
 *    crumbs in the neck / skull base; it is deliberately loose.
 * 3. 3D connected components (26-neighbourhood) of the cores; keep components
 *    with >= 12 voxels (removes isolated noise). The kept components are the
 *    enamel caps + dense dentin of both arches; their min/max in x/y outline
 *    the arch horseshoe.
 * 4. Split the cores into a lower (mandibular) and upper (maxillary) arch at
 *    the occlusal plane, located as the minimum of the per-z core histogram
 *    between the 20th and 80th z-percentile (the two dentitions are separated
 *    by the occlusal air gap).
 * 5. Root extension: enamel/dentin stops at the cemento-enamel junction; the
 *    roots continue below (mandibular) / above (maxillary) the core for about
 *    13-14 mm. Extend both arch limits by ROOT_LENGTH_MM (14 mm) so root apices
 *    are inside the box. (Measured on this scan: enamel core z ~=68..115,
 *    root apices ~= z 43..140.)
 * 6. AABB = core min/max in x/y + 3 mm margin, and the root-extended z range
 *    above. This single box contains the whole dentition, cuts the mandible
 *    rami / cervical spine (posterior, y > 0.46 H) and the skull base
 *    (superior, z > 0.71 D). A single AABB is recommended over a "slab +
 *    anterior box" because the arch is already anterior-centred and the box
 *    removes the posterior/superior structures by itself; one box is cheaper
 *    to intersect in the shader and can be shown as a single gizmo.
 *
 * -- HU thresholds for the teeth-only transfer function ---------------------
 * Measured in this volume (8-bit quantization step ~=17.4 HU):
 *   - alveolar / cortical bone:  typically 700..1300 HU (p95 ~=1.15 kHU),
 *   - root dentin:               ~=1250..1750 HU,
 *   - enamel + dense dentin:     >= 1900 HU (the "core" used above),
 *   - brightest enamel:          up to 3244 HU (p99.9 of the box ~=2.3 kHU).
 * Recommended teeth preset: bone faded out below ~1 kHU, roots faint,
 * enamel fully opaque:
 *   HU -1024 ->0,  700 ->0,  850 ->0 (boneMin),  1250 ->0.18 (toothMin),
 *   1650 ->0.65,  2200 ->0.96 (enamelMin),  3200 ->1.
 * `hu` in dental.json carries the three named thresholds only; the full alpha
 * ramp is in stats.recommendedPreset.stops.
 *
 * Usage: node tools/dental-roi.mjs [--no-preview]
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = path.join(ROOT, 'public', 'data')
const META_PATH = path.join(DATA_DIR, 'volume.json')
const PREVIEW_DIR = path.join(ROOT, 'tools', 'dental-preview')
const WRITE_PREVIEWS = !process.argv.includes('--no-preview')

// -- constants --------------------------------------------------------------
const CORE_HU = 1900 // "enamel core" threshold (tooth substance)
const MIN_COMPONENT_VOXELS = 12 // ignore disconnected dense crumbs
const ROOT_LENGTH_MM = 14 // cemento-enamel junction -> root apex (adult teeth)
const XY_MARGIN_MM = 3 // margin around the enamel core in x / y
const TOOTH_MIN_HU = 1250 // dentin onset: teeth-only TF starts here
const ENAMEL_MIN_HU = 2200 // bright enamel band
const BONE_MIN_HU = 850 // bone onset: TF keeps this region transparent

// -- load volume ------------------------------------------------------------
const meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8'))
const [W, H, D] = meta.volume.dims
const [sx, sy, sz] = meta.volume.spacing
const [QMIN, QMAX] = meta.volume.quantRange
const N = W * H * D
const fileBytes = fs.readFileSync(path.join(DATA_DIR, meta.files.u8))
if (fileBytes.length !== N) throw new Error(`volume_u8.bin is ${fileBytes.length} bytes, expected ${N}`)
const u8 = new Uint8Array(fileBytes.buffer, fileBytes.byteOffset, fileBytes.byteLength)
const huFromU8 = (v) => QMIN + (v / 255) * (QMAX - QMIN)
const u8FromHu = (h) => Math.max(0, Math.min(255, Math.round(((h - QMIN) / (QMAX - QMIN)) * 255)))
const idx = (x, y, z) => x + y * W + z * W * H

// -- 1. enamel core voxels inside a loose central guard box ----------------
const CORE_U8 = u8FromHu(CORE_HU)
const yGuard = Math.round(0.62 * H)
const zGuardLo = Math.round(0.15 * D)
const zGuardHi = Math.round(0.85 * D)
const xGuardLo = Math.round(0.12 * W)
const xGuardHi = Math.round(0.88 * W)
const coreVoxels = []
for (let z = zGuardLo; z <= zGuardHi; z++) {
  for (let y = 0; y < yGuard; y++) {
    let i = idx(xGuardLo, y, z)
    for (let x = xGuardLo; x <= xGuardHi; x++, i++) {
      if (u8[i] >= CORE_U8) coreVoxels.push(i)
    }
  }
}

// -- 2. connected components (26-neighbourhood) over the core voxels -------
const visited = new Uint8Array(N)
const components = []
for (const seed of coreVoxels) {
  if (visited[seed]) continue
  const stack = [seed]
  const comp = []
  visited[seed] = 1
  while (stack.length > 0) {
    const v = stack.pop()
    comp.push(v)
    const x = v % W
    const yz = (v - x) / W
    const y = yz % H
    const z = (yz - y) / H
    for (let dz = -1; dz <= 1; dz++) {
      const zz = z + dz
      if (zz < zGuardLo || zz > zGuardHi) continue
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= yGuard) continue
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0 && dz === 0) continue
          const xx = x + dx
          if (xx < xGuardLo || xx > xGuardHi) continue
          const ni = idx(xx, yy, zz)
          if (visited[ni] || u8[ni] < CORE_U8) continue
          visited[ni] = 1
          stack.push(ni)
        }
      }
    }
  }
  if (comp.length >= MIN_COMPONENT_VOXELS) components.push(comp)
}

// -- 3. core statistics: coordinate extents + z histogram / occlusal plane --
const coreIdx = components.flat()
let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity
let zMin = Infinity, zMax = -Infinity
const zHist = new Int32Array(D)
for (const v of coreIdx) {
  const x = v % W
  const yz = (v - x) / W
  const y = yz % H
  const z = (yz - y) / H
  if (x < xMin) xMin = x
  if (x > xMax) xMax = x
  if (y < yMin) yMin = y
  if (y > yMax) yMax = y
  if (z < zMin) zMin = z
  if (z > zMax) zMax = z
  zHist[z]++
}

const percentile = (arr, p) => {
  const sorted = Float64Array.from(arr).sort()
  if (sorted.length === 0) return NaN
  const h = (sorted.length - 1) * (p / 100)
  const lo = Math.floor(h)
  const hi = Math.min(sorted.length - 1, lo + 1)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo)
}

// Occlusal plane: minimum of the core z-histogram between the 20th/80th
// z-percentile --the gap between the mandibular and maxillary enamel.
const zP20 = Math.ceil(percentile(coreIdx.map((v) => Math.floor(v / (W * H))), 20))
const zP80 = Math.floor(percentile(coreIdx.map((v) => Math.floor(v / (W * H))), 80))
let occlusalZ = zP20
let minCount = Infinity
for (let z = zP20; z <= zP80; z++) {
  if (zHist[z] < minCount) {
    minCount = zHist[z]
    occlusalZ = z
  }
}
const lowerZs = []
const upperZs = []
for (const v of coreIdx) {
  const z = Math.floor(v / (W * H))
  if (z < occlusalZ) lowerZs.push(z)
  else upperZs.push(z)
}
// Enamel/dentin core ends at the cemento-enamel junction (approximately); the
// 1st/99th percentile keeps a stray enamel pearl from stretching the box.
const lowerCejZ = percentile(lowerZs, 1)
const upperCejZ = percentile(upperZs, 99)
const rootPad = Math.round(ROOT_LENGTH_MM / sz)
const xyMargin = Math.round(XY_MARGIN_MM / sx)

// -- 4. build the normalized voxel AABB ------------------------------------
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const x0 = clamp(Math.round(xMin - xyMargin), 0, W - 1)
const x1 = clamp(Math.round(xMax + xyMargin), 0, W - 1)
const y0 = clamp(Math.round(yMin - xyMargin), 0, H - 1)
const y1 = clamp(Math.round(yMax + xyMargin), 0, H - 1)
const z0 = clamp(Math.round(lowerCejZ - rootPad), 0, D - 1)
const z1 = clamp(Math.round(upperCejZ + rootPad), 0, D - 1)

// Texture/UV space: voxel center = (i+0.5)/n, box faces at voxel boundaries.
const norm = (i, n) => Number((i / n).toFixed(6))
const voxelBox = {
  min: [norm(x0, W), norm(y0, H), norm(z0, D)],
  max: [norm(x1 + 1, W), norm(y1 + 1, H), norm(z1 + 1, D)],
}
const mm = (i, s) => Number((i * s).toFixed(2))
const worldBoxMm = {
  min: [mm(x0, sx), mm(y0, sy), mm(z0, sz)],
  max: [mm(x1 + 1, sx), mm(y1 + 1, sy), mm(z1 + 1, sz)],
}

// -- 5. coverage sanity check + in-box statistics --------------------------
let coreOutside = 0
for (const v of coreIdx) {
  const x = v % W
  const yz = (v - x) / W
  const y = yz % H
  const z = (yz - y) / H
  if (x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1) coreOutside++
}
// The dentition z-band: core z extents + 3 voxels. Voxels above `toothMin`
// outside this band are almost pure cortical bone slivers at the box margins;
// reporting their share documents how "teeth-only" the crop really is.
const toothBandLo = Math.max(0, zMin - 3)
const toothBandHi = Math.min(D - 1, zMax + 3)
let boxVoxels = 0
let toothVoxels = 0
let enamelVoxels = 0
let toothVoxelsInBand = 0
const toothU8 = u8FromHu(TOOTH_MIN_HU)
const enamelU8 = u8FromHu(ENAMEL_MIN_HU)
for (let z = z0; z <= z1; z++) {
  const inBand = z >= toothBandLo && z <= toothBandHi
  for (let y = y0; y <= y1; y++) {
    let i = idx(x0, y, z)
    for (let x = x0; x <= x1; x++, i++) {
      boxVoxels++
      if (u8[i] >= toothU8) {
        toothVoxels++
        if (inBand) toothVoxelsInBand++
      }
      if (u8[i] >= enamelU8) enamelVoxels++
    }
  }
}

// Suggested teeth-only transfer function (alpha ramp; colours in sRGB 0..1).
const recommendedPreset = {
  name: 'Teeth / Dental arch',
  mode: 'composite',
  steps: 224,
  opacity: 1,
  densityMin: 0.28,
  stops: [
    { hu: -1024, color: [0.01, 0.01, 0.02], alpha: 0 },
    { hu: 700, color: [0.28, 0.23, 0.19], alpha: 0 },
    { hu: BONE_MIN_HU, color: [0.5, 0.42, 0.34], alpha: 0 },
    { hu: TOOTH_MIN_HU, color: [0.9, 0.86, 0.78], alpha: 0.18 },
    { hu: 1650, color: [1, 0.98, 0.94], alpha: 0.65 },
    { hu: ENAMEL_MIN_HU, color: [1, 1, 1], alpha: 0.96 },
    { hu: 3200, color: [1, 1, 1], alpha: 1 },
  ],
}

const dental = {
  version: 1,
  voxelBox,
  worldBoxMm,
  hu: { toothMin: TOOTH_MIN_HU, enamelMin: ENAMEL_MIN_HU, boneMin: BONE_MIN_HU },
  stats: {
    method:
      `enamel-core (HU>=${CORE_HU}) connected components -> arch x/y extents; roots extended ${ROOT_LENGTH_MM} mm in z; ${XY_MARGIN_MM} mm x/y margin`,
    voxelBounds: { x: [x0, x1], y: [y0, y1], z: [z0, z1] },
    normalizedConvention:
      'UV/texture space: uv=(voxel+0.5)/dims for voxel centers, box faces at voxel boundaries; uv.x=volume x (right), uv.y=volume y (anterior->posterior), uv.z=volume z (inferior->superior)',
    dims: [W, H, D],
    spacingMm: [sx, sy, sz],
    core: {
      thresholdHu: CORE_HU,
      voxels: coreIdx.length,
      components: components.length,
      bounds: { x: [xMin, xMax], y: [yMin, yMax], z: [zMin, zMax] },
    },
    occlusalPlane: { voxelZ: occlusalZ, normalizedZ: norm(occlusalZ, D) },
    arch: {
      lower: { cejZ: Math.round(lowerCejZ), rootApexZ: z0 },
      upper: { cejZ: Math.round(upperCejZ), rootApexZ: z1 },
    },
    boxVoxels,
    toothVoxels,
    enamelVoxels,
    // Share of HU>=toothMin voxels that sit in the dentition z-band (all enamel
    // and roots); the rest are cortical-bone slivers at the box margins.
    dentitionBand: {
      z: [toothBandLo, toothBandHi],
      toothVoxelsBandSharePct: toothVoxels > 0 ? Number(((100 * toothVoxelsInBand) / toothVoxels).toFixed(1)) : 0,
    },
    coreOutsideBox: coreOutside,
    recommendedPreset,
  },
}

fs.mkdirSync(DATA_DIR, { recursive: true })
fs.writeFileSync(path.join(DATA_DIR, 'dental.json'), `${JSON.stringify(dental, null, 2)}\n`, 'utf8')

console.log('[dental-roi] core: %d voxels in %d components (HU>=%d)', coreIdx.length, components.length, CORE_HU)
console.log(
  '[dental-roi] arch core x[%d,%d] y[%d,%d] z[%d,%d], occlusal z=%d (norm %s)',
  xMin, xMax, yMin, yMax, zMin, zMax, occlusalZ, (occlusalZ / D).toFixed(3),
)
console.log('[dental-roi] voxel box x[%d,%d] y[%d,%d] z[%d,%d]  (%dx%dx%d)', x0, x1, y0, y1, z0, z1, x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1)
console.log('[dental-roi] normalized box min=(%s) max=(%s)', voxelBox.min.join(', '), voxelBox.max.join(', '))
console.log('[dental-roi] world mm     min=(%s) max=(%s)', worldBoxMm.min.join(', '), worldBoxMm.max.join(', '))
console.log('[dental-roi] box voxels=%d, HU>%d=%d, HU>%d=%d, core outside box=%d', boxVoxels, TOOTH_MIN_HU, toothVoxels, ENAMEL_MIN_HU, enamelVoxels, coreOutside)
console.log('[dental-roi] wrote %s', path.relative(ROOT, path.join(DATA_DIR, 'dental.json')))

// -- 6. preview images (PNG via node:zlib, no deps) ------------------------
if (!WRITE_PREVIEWS) process.exit(0)

// Minimal PNG encoder (8-bit RGB, no filtering).
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()
const crc32 = (buf) => {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const pngChunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}
const encodePng = (width, height, rgb) => {
  const stride = width * 3 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * stride + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}
const writePng = (file, width, height, rgb) => {
  fs.writeFileSync(file, encodePng(width, height, rgb))
  console.log('[dental-roi] wrote %s (%dx%d)', path.relative(ROOT, file), width, height)
}

fs.mkdirSync(PREVIEW_DIR, { recursive: true })
const dentalWindow = meta.windows.find((w) => w.id === 'dental') ?? { center: 900, width: 3600 }
const gray = (h) => {
  const lo = dentalWindow.center - dentalWindow.width / 2
  const v = (h - lo) / dentalWindow.width
  return v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255)
}
const mipTone = (h) => {
  // Teeth-only-ish MIP tone: bone (<~1.2 kHU) almost black, dentin grey,
  // enamel bright white. gamma lifts the dentin band so roots stay visible.
  const v = Math.max(0, Math.min(1, (h - 1150) / (3300 - 1150)))
  return Math.round(255 * Math.pow(v, 0.75))
}
const rgbFromGray = (w, h, get) => {
  const rgb = new Uint8Array(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = get(x, y)
      const o = (y * w + x) * 3
      rgb[o] = rgb[o + 1] = rgb[o + 2] = v
    }
  }
  return rgb
}
const scaleRgb = (rgb, w, h, scale) => {
  const out = new Uint8Array(w * scale * h * scale * 3)
  const ow = w * scale
  for (let y = 0; y < h * scale; y++) {
    const sy = (y / scale) | 0
    for (let x = 0; x < ow; x++) {
      const sxp = (x / scale) | 0
      const si = (sy * w + sxp) * 3
      const di = (y * ow + x) * 3
      out[di] = rgb[si]
      out[di + 1] = rgb[si + 1]
      out[di + 2] = rgb[si + 2]
    }
  }
  return { rgb: out, w: ow, h: h * scale }
}

// Pick the busiest slice per axis inside the box (most tooth-density) so the
// MPR crops show the most anatomy rather than an arbitrary middle slice.
const axisBest = () => {
  const countX = new Int32Array(W)
  const countY = new Int32Array(H)
  const countZ = new Int32Array(D)
  for (let z = z0; z <= z1; z++) {
    for (let y = y0; y <= y1; y++) {
      let i = idx(x0, y, z)
      for (let x = x0; x <= x1; x++, i++) {
        if (u8[i] >= toothU8) {
          countX[x]++
          countY[y]++
          countZ[z]++
        }
      }
    }
  }
  const argmax = (arr) => {
    let best = 0
    for (let i = 1; i < arr.length; i++) if (arr[i] > arr[best]) best = i
    return best
  }
  return { x: argmax(countX), y: argmax(countY), z: argmax(countZ) }
}
const best = axisBest()
console.log('[dental-roi] preview slices: axial z=%d, coronal y=%d, sagittal x=%d', best.z, best.y, best.x)

// 6a. MPR-like crops of the proposed box (native resolution, 3x nearest upscale)
const cropAxial = () => {
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  const rgb = rgbFromGray(w, h, (x, y) => gray(huFromU8(u8[idx(x0 + x, y0 + y, best.z)])))
  return scaleRgb(rgb, w, h, 3)
}
const cropCoronal = () => {
  const w = x1 - x0 + 1
  const h = z1 - z0 + 1
  // rows top = superior (z1) -> bottom = inferior (z0)
  const rgb = rgbFromGray(w, h, (x, y) => gray(huFromU8(u8[idx(x0 + x, best.y, z1 - y)])))
  return scaleRgb(rgb, w, h, 3)
}
const cropSagittal = () => {
  const w = y1 - y0 + 1
  const h = z1 - z0 + 1
  // rows top = superior; columns left = anterior (y0)
  const rgb = rgbFromGray(w, h, (x, y) => gray(huFromU8(u8[idx(best.x, y0 + x, z1 - y)])))
  return scaleRgb(rgb, w, h, 3)
}
for (const [name, make] of [
  ['roi-mpr-axial.png', cropAxial],
  ['roi-mpr-coronal.png', cropCoronal],
  ['roi-mpr-sagittal.png', cropSagittal],
]) {
  const img = make()
  writePng(path.join(PREVIEW_DIR, name), img.w, img.h, img.rgb)
}

// 6b. MIPs of the proposed box, one per viewing direction + isometric.
const boxIdx = (x, y, z) => idx(x, y, z)
const mip = (axis) => {
  // axis 0: top view (max over z), rows = y (anterior at top)
  // axis 1: front view (max over y), rows = z (superior at top)
  // axis 2: side view (max over x), rows = z (superior at top), cols = y
  let w, h
  if (axis === 0) { w = x1 - x0 + 1; h = y1 - y0 + 1 } else if (axis === 1) { w = x1 - x0 + 1; h = z1 - z0 + 1 } else { w = y1 - y0 + 1; h = z1 - z0 + 1 }
  const rgb = new Uint8Array(w * h * 3)
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      let bestHu = -Infinity
      if (axis === 0) {
        const x = x0 + col
        const y = y0 + row
        for (let z = z0; z <= z1; z++) {
          const hu = huFromU8(u8[boxIdx(x, y, z)])
          if (hu > bestHu) bestHu = hu
        }
      } else if (axis === 1) {
        const x = x0 + col
        const z = z1 - row
        for (let y = y0; y <= y1; y++) {
          const hu = huFromU8(u8[boxIdx(x, y, z)])
          if (hu > bestHu) bestHu = hu
        }
      } else {
        const y = y0 + col
        const z = z1 - row
        for (let x = x0; x <= x1; x++) {
          const hu = huFromU8(u8[boxIdx(x, y, z)])
          if (hu > bestHu) bestHu = hu
        }
      }
      const v = mipTone(bestHu)
      const o = (row * w + col) * 3
      rgb[o] = rgb[o + 1] = rgb[o + 2] = v
    }
  }
  return scaleRgb(rgb, w, h, 3)
}
for (const [name, axis] of [
  ['roi-mip-top.png', 0],
  ['roi-mip-front.png', 1],
  ['roi-mip-side.png', 2],
]) {
  const img = mip(axis)
  writePng(path.join(PREVIEW_DIR, name), img.w, img.h, img.rgb)
}

// Isometric-ish MIP: orthographic projection along a front-top-right ray with
// nearest-neighbour sampling (preview only, no interpolation needed).
const isoMip = () => {
  const size = 360
  const dW = [-0.45, 0.75, -0.5] // ray direction in volume (x,y,z): from front-right-above
  const len = Math.hypot(...dW)
  const d = dW.map((v) => v / len)
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const norm3 = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l) }
  const right = norm3(cross(d, [0, 0, 1]))
  const up = norm3(cross(right, d))
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const cz = (z0 + z1) / 2
  const corners = []
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) corners.push([x - cx, y - cy, z - cz])
  const projR = corners.map((c) => c[0] * right[0] + c[1] * right[1] + c[2] * right[2])
  const projU = corners.map((c) => c[0] * up[0] + c[1] * up[1] + c[2] * up[2])
  const half = Math.max(Math.max(...projR) - Math.min(...projR), Math.max(...projU) - Math.min(...projU)) / 2 * 1.06
  const diag = Math.hypot(x1 - x0, y1 - y0, z1 - z0)
  const steps = Math.ceil(diag * 2) + 4
  const tMax = diag * 0.75
  const dt = (tMax * 2) / steps
  const rgb = new Uint8Array(size * size * 3)
  const bestHu = new Float32Array(size * size).fill(-Infinity)
  for (let i = 0; i < steps; i++) {
    const t = -tMax + i * dt
    for (let py = 0; py < size; py++) {
      const v = ((py + 0.5) / size * 2 - 1) * half
      const rowBase = py * size
      for (let px = 0; px < size; px++) {
        const u = ((px + 0.5) / size * 2 - 1) * half
        const x = Math.round(cx + u * right[0] + v * up[0] + t * d[0])
        const y = Math.round(cy + u * right[1] + v * up[1] + t * d[1])
        const z = Math.round(cz + u * right[2] + v * up[2] + t * d[2])
        if (x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1) continue
        const hu = huFromU8(u8[idx(x, y, z)])
        const o = rowBase + px
        if (hu > bestHu[o]) bestHu[o] = hu
      }
    }
  }
  for (let i = 0; i < bestHu.length; i++) {
    const v = bestHu[i] === -Infinity ? 0 : mipTone(bestHu[i])
    rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = v
  }
  return { rgb, w: size, h: size }
}
const iso = isoMip()
writePng(path.join(PREVIEW_DIR, 'roi-mip-iso.png'), iso.w, iso.h, iso.rgb)

// 6c. Placement overlay: full MPR slices (2x) with the normalized box drawn.
const overlay = () => {
  const outW = 1300
  const outH = 800
  const rgb = new Uint8Array(outW * outH * 3)
  const setPx = (px, py, r, g, b) => {
    if (px < 0 || py < 0 || px >= outW || py >= outH) return
    const o = (py * outW + px) * 3
    rgb[o] = r
    rgb[o + 1] = g
    rgb[o + 2] = b
  }
  const drawRect = (x0p, y0p, x1p, y1p, r, g, b) => {
    for (let x = x0p; x <= x1p; x++) { setPx(x, y0p, r, g, b); setPx(x, y1p, r, g, b) }
    for (let y = y0p; y <= y1p; y++) { setPx(x0p, y, r, g, b); setPx(x1p, y, r, g, b) }
  }
  // axial (top left): rows = y, cols = x, 2x
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = gray(huFromU8(u8[idx(x, y, best.z)]))
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) setPx(x * 2 + dx, y * 2 + dy, v, v, v)
    }
  }
  drawRect(x0 * 2, y0 * 2, (x1 + 1) * 2 - 1, (y1 + 1) * 2 - 1, 40, 235, 120)
  // coronal (top right): rows = superior->inferior, cols = x, 2x
  for (let z = 0; z < D; z++) {
    const row = D - 1 - z
    for (let x = 0; x < W; x++) {
      const v = gray(huFromU8(u8[idx(x, best.y, z)]))
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) setPx(660 + x * 2 + dx, row * 2 + dy, v, v, v)
    }
  }
  drawRect(660 + x0 * 2, (D - 1 - z1) * 2, 660 + (x1 + 1) * 2 - 1, (D - 1 - z0) * 2 - 1, 40, 235, 120)
  // sagittal (bottom right): rows = superior->inferior, cols = y (anterior left), 2x
  for (let z = 0; z < D; z++) {
    const row = D - 1 - z
    for (let y = 0; y < H; y++) {
      const v = gray(huFromU8(u8[idx(best.x, y, z)]))
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) setPx(660 + y * 2 + dx, 410 + row * 2 + dy, v, v, v)
    }
  }
  drawRect(660 + y0 * 2, 410 + (D - 1 - z1) * 2, 660 + (y1 + 1) * 2 - 1, 410 + (D - 1 - z0) * 2 - 1, 40, 235, 120)
  return { rgb, w: outW, h: outH }
}
const ov = overlay()
writePng(path.join(PREVIEW_DIR, 'roi-overlay.png'), ov.w, ov.h, ov.rgb)
console.log('[dental-roi] previews -> %s', path.relative(ROOT, PREVIEW_DIR))


