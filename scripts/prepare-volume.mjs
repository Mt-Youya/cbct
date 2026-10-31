#!/usr/bin/env node
/**
 * CBCT DICOM series -> web volume assets.
 *
 * Reads an axial CT/CBCT DICOM series (Explicit VR Little Endian, uncompressed,
 * signed 16-bit pixels) and produces two downsampled volumes plus metadata for
 * the WebGL2 volume renderer:
 *
 *   public/data/volume_u8.bin   8-bit HU-normalized  (GPU 3D texture + MPR)
 *   public/data/volume.json     metadata + geometry
 *
 * The volume is downsampled by a power-of-two factor on every axis using an
 * area average in HU space, so it fits comfortably in GPU memory.
 *
 * Generic: works with any uncompressed 16-bit CT/CBCT series (Explicit or
 * Implicit VR Little Endian). The browser can also import DICOM folders
 * directly (see src/data/dicomImport.ts) — this script is optional and is
 * only used to ship a bundled sample dataset.
 *
 * Usage:
 *   node scripts/prepare-volume.mjs --input "path/to/series"
 *   node scripts/prepare-volume.mjs --input "path/to/series" --out public/data --factor 2
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dicomParser from 'dicom-parser'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const inputDir = path.resolve(ROOT, arg('input', 'dicom'))
const outDir = path.resolve(ROOT, arg('out', 'public/data'))
const factor = Number(arg('factor', '2'))
if (![1, 2, 4].includes(factor)) throw new Error('--factor must be 1, 2 or 4')
if (!fs.existsSync(inputDir)) {
  console.error(
    `[prepare] input directory not found: ${inputDir}\n` +
      '  Pass a DICOM series directory with --input, e.g.:\n' +
      '  node scripts/prepare-volume.mjs --input "path/to/DICOM/series" --out public/data',
  )
  process.exit(1)
}
fs.mkdirSync(outDir, { recursive: true })

const files = fs
  .readdirSync(inputDir)
  .filter((f) => /\.dcm$/i.test(f))
  .sort()
if (files.length < 2) throw new Error(`no DICOM slices found in ${inputDir}`)
console.log(`[prepare] series: ${inputDir}`)
console.log(`[prepare] slices: ${files.length}, downsample factor: ${factor}x`)

/** Returns a signed 16-bit view over the file's PixelData, or a copy if misaligned. */
function parseSlice(file, scratch) {
  const buf = fs.readFileSync(path.join(inputDir, file))
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  const ds = dicomParser.parseDicom(bytes)
  const rows = ds.uint16('x00280010')
  const cols = ds.uint16('x00280011')
  const bits = ds.uint16('x00280100') ?? 16
  const pixRep = ds.uint16('x00280103') ?? 1
  const el = ds.elements.x7fe00010
  if (!el) throw new Error(`${file}: missing PixelData`)
  if (bits !== 16 || pixRep !== 1) throw new Error(`${file}: expected signed 16-bit pixels (got ${bits}/${pixRep})`)
  if (el.length !== rows * cols * 2) throw new Error(`${file}: pixel length mismatch`)

  const base = bytes.byteOffset + el.dataOffset
  let pixels
  if (base % 2 === 0 && (buf.byteOffset + base) % 2 === 0) {
    pixels = new Int16Array(buf.buffer, buf.byteOffset + el.dataOffset, rows * cols)
  } else {
    const view = new DataView(buf.buffer, bytes.byteOffset + el.dataOffset, el.length)
    for (let i = 0; i < rows * cols; i++) scratch[i] = view.getInt16(i * 2, true)
    pixels = scratch
  }
  const ipp = (ds.string('x00200032') ?? '0\\0\\0').split('\\').map(Number)
  return { ds, rows, cols, pixels, pos: ipp }
}

const firstFile = files[0]
const probe = parseSlice(firstFile, new Int16Array(1))
const H = probe.rows
const W = probe.cols
const scratch = new Int16Array(W * H)

const dimsIn = [W, H, files.length]
const pixelSpacing = (probe.ds.string('x00280030') ?? '1\\1').split('\\').map(Number)
const sliceThickness = Number(probe.ds.string('x00180050') ?? 0) || 1

const positions = []
// Pre-scan positions (headers only need the whole file with this parser, so we
// reuse the probe for the first slice and stream-parse the rest below).
for (let i = 1; i < files.length; i++) {
  const s = parseSlice(files[i], scratch)
  positions.push(s.pos[2])
  if (i % 100 === 0) process.stdout.write(`\r[prepare] reading geometry ${i + 1}/${files.length}`)
}
process.stdout.write('\r[prepare] reading geometry done          \n')

const z0 = probe.pos[2]
const zs = [z0, ...positions]
const dz = (zs[zs.length - 1] - zs[0]) / (zs.length - 1)
for (let i = 1; i < zs.length; i++) {
  if (Math.abs(zs[i] - zs[i - 1] - dz) > 1e-4) {
    throw new Error(`non-uniform slice spacing between ${files[i - 1]} and ${files[i]}`)
  }
}
if (dz < 0) throw new Error('slices are not ordered by increasing patient z; rename or sort the series first')

const spacingIn = [pixelSpacing[1], pixelSpacing[0], Math.abs(dz) || sliceThickness]
const dimsOut = dimsIn.map((d) => Math.floor(d / factor))
const spacingOut = spacingIn.map((s) => s * factor)
const [OW, OH, OD] = dimsOut
const [IW, IH] = dimsIn
const voxelsOut = OW * OH * OD
const block = factor * factor * factor

const qMin = -1024
const qMax = 3400
const qSpan = qMax - qMin

console.log(`[prepare] in : ${dimsIn.join(' x ')} @ ${spacingIn.map((v) => v.toFixed(3)).join(' / ')} mm`)
console.log(
  `[prepare] out: ${dimsOut.join(' x ')} @ ${spacingOut.map((v) => v.toFixed(3)).join(' / ')} mm  (${(voxelsOut / 1e6).toFixed(1)} M voxels)`,
)

const accum = new Float32Array(voxelsOut)

function accumulate(pixels, zi) {
  const oz = (zi / factor) | 0
  const ozBase = oz * OH * OW
  for (let yi = 0; yi < IH; yi++) {
    const oyBase = ozBase + ((yi / factor) | 0) * OW
    const srcRow = yi * IW
    for (let xi = 0; xi < IW; xi++) {
      accum[oyBase + ((xi / factor) | 0)] += pixels[srcRow + xi]
    }
  }
}

// Stream the series once more for the actual accumulation.
accumulate(probe.pixels, 0)
for (let i = 1; i < files.length; i++) {
  const s = parseSlice(files[i], scratch)
  if (s.rows !== H || s.cols !== W) throw new Error(`inconsistent matrix size in ${files[i]}`)
  accumulate(s.pixels, i)
  if (i % 25 === 0) process.stdout.write(`\r[prepare] accumulating slices ${i + 1}/${files.length}`)
}
process.stdout.write('\r[prepare] accumulating slices done          \n')

let huMin = 32767
let huMax = -32768
const u8 = new Uint8Array(voxelsOut)
for (let i = 0; i < voxelsOut; i++) {
  const hu = accum[i] / block
  let v = Math.round(hu)
  if (v < -32768) v = -32768
  if (v > 32767) v = 32767
  if (v < huMin) huMin = v
  if (v > huMax) huMax = v
  let q = (hu - qMin) / qSpan
  q = q < 0 ? 0 : q > 1 ? 1 : q
  u8[i] = Math.round(q * 255)
}

const first = probe.ds
const patientNameBytes = first.elements.x00100010
let patientName = ''
if (patientNameBytes) {
  const raw = Buffer.from(
    probe.ds.byteArray.buffer,
    probe.ds.byteArray.byteOffset + patientNameBytes.dataOffset,
    patientNameBytes.length,
  )
  try {
    patientName = new TextDecoder('gb18030').decode(raw).replace(/\0/g, '').trim()
  } catch {
    patientName = raw.toString('utf8').replace(/\0/g, '').trim()
  }
}

const meta = {
  schema: 'cbct-volume/1',
  generatedAt: new Date().toISOString(),
  source: {
    directory: path.relative(ROOT, inputDir).replace(/\\/g, '/'),
    sliceCount: files.length,
    slicePattern: files[0].replace(/\d+(?=\.dcm)/i, '####'),
  },
  patient: {
    id: first.string('x00100020') ?? '',
    name: patientName,
    latinName: first.string('x00101001') ?? '',
    sex: first.string('x00100040') ?? '',
    age: first.string('x00101010') ?? '',
    birthDate: first.string('x00100030') ?? '',
  },
  study: {
    date: first.string('x00080020') ?? '',
    time: first.string('x00080030') ?? '',
    modality: first.string('x00080060') ?? '',
    manufacturer: first.string('x00080070') ?? '',
    model: first.string('x00081090') ?? '',
    kvp: Number(first.string('x00180060') ?? 0) || null,
    exposureTime: Number(first.string('x00181150') ?? 0) || null,
    xrayCurrent: Number(first.string('x00181151') ?? 0) || null,
    doseProduct: Number(first.string('x0018115e') ?? 0) || null,
    scanType: first.string('x40101048') ?? '',
  },
  volume: {
    dims: dimsOut,
    spacing: spacingOut,
    originalDims: dimsIn,
    originalSpacing: spacingIn,
    downsampleFactor: factor,
    huRange: [huMin, huMax],
    quantRange: [qMin, qMax],
    dataType: { u8: 'uint8' },
    byteOrder: 'little-endian',
    layout: 'x fastest, then y, then z (C order)',
  },
  files: {
    u8: 'volume_u8.bin',
    thumbnail: fs.existsSync(path.join(inputDir, 'thumbnail.jpg')) ? 'thumbnail.png' : null,
    ...(fs.existsSync(path.join(outDir, 'dental.json')) ? { dental: 'dental.json' } : {}),
  },
  windows: [
    { id: 'bone', label: 'Bone', center: 600, width: 2600 },
    { id: 'soft', label: 'Soft tissue', center: 50, width: 500 },
    { id: 'dental', label: 'Dental', center: 900, width: 3600 },
    { id: 'full', label: 'Full range', center: Math.round((qMin + qMax) / 2), width: qMax - qMin },
  ],
}

fs.writeFileSync(path.join(outDir, 'volume_u8.bin'), Buffer.from(u8.buffer))
fs.writeFileSync(path.join(outDir, 'volume.json'), JSON.stringify(meta, null, 2))

// The bundled "thumbnail.jpg" from the scanner is actually a PNG; keep it as a
// loading poster so the browser decodes it reliably.
const thumbIn = path.join(inputDir, 'thumbnail.jpg')
if (fs.existsSync(thumbIn)) {
  const thumb = fs.readFileSync(thumbIn)
  if (thumb.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    fs.writeFileSync(path.join(outDir, 'thumbnail.png'), thumb)
  }
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)  } MB`
console.log(`[prepare] HU range: ${huMin} .. ${huMax}  (quantized ${qMin}..${qMax} -> u8)`)
console.log(`[prepare] wrote volume_u8.bin (${mb(u8.byteLength)}), volume.json`)
console.log(`[prepare] output: ${outDir}`)
