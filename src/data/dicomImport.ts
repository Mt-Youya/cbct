import dicomParser from 'dicom-parser'

import type { DentalRoi, Vec3, VolumeData, VolumeMeta } from '../types'
import { computeDentalRoi } from './dentalRoi'

export interface ImportProgress {
  phase: 'read' | 'parse' | 'volume' | 'roi' | 'done'
  done: number
  total: number
  message?: string
}

export interface ImportResult {
  meta: VolumeMeta
  volume: VolumeData
  dental: DentalRoi | null
  /** PNG data URL of a representative axial slice, for the loading screen. */
  previewDataUrl: string | null
}

/** Data set type of dicom-parser, without importing its ambient helper types. */
type DicomDataSet = ReturnType<typeof dicomParser.parseDicom>
type DicomElement = DicomDataSet['elements'][string]

/** Explicit / implicit VR little endian are the only transfer syntaxes we decode. */
const UNCOMPRESSED_TRANSFER_SYNTAX = new Set(['1.2.840.10008.1.2', '1.2.840.10008.1.2.1'])
const JPEG_FAMILY_PREFIX = '1.2.840.10008.1.2.4'
const RLE_SYNTAX_PREFIX = '1.2.840.10008.1.2.5'

const SCHEMA = 'cbct-volume/1'
const MAX_TARGET_DIM = 320
const MIN_SERIES_SLICES = 10

/** Per-pixel HU clamp while accumulating; protects the histogram from stray int16 values. */
const HU_CLAMP_MIN = -12000
const HU_CLAMP_MAX = 30000

const HIST_MIN = -2048
const HIST_MAX = 6144
const HIST_BINS = 4096
const HIST_BIN_WIDTH = (HIST_MAX - HIST_MIN) / HIST_BINS

const DEFAULT_ORIENTATION: [number, number, number, number, number, number] = [1, 0, 0, 0, 1, 0]

const PREVIEW_SIZE = 320
const PREVIEW_WINDOW_CENTER = 600
const PREVIEW_WINDOW_WIDTH = 2600

type Orientation = [number, number, number, number, number, number]

interface StudyHeader {
  patientId: string
  patientName: string
  sex: string
  age: string
  studyDate: string
  studyTime: string
  manufacturer: string
  model: string
  kvp: number | null
  exposureTime: number | null
  xrayCurrent: number | null
  doseProduct: number | null
  scanType: string
}

/** Everything we keep from a slice after its parsed buffer was released. */
interface SliceProbe {
  file: File
  name: string
  seriesUid: string
  instanceNumber: number
  position: Vec3 | null
  orientation: Orientation | null
  rows: number
  cols: number
  rowSpacing: number | null
  colSpacing: number | null
  sliceThickness: number
  signed: boolean
  header: StudyHeader
}

interface SkipCounters {
  unreadable: number
  parseErrors: number
  noPixelData: number
  notCt: number
  compressed: number
  unsupportedTransferSyntax: number
  unsupportedPixel: number
  missingGeometry: number
  pixelLength: number
}

interface SeriesGeometry {
  rows: number
  cols: number
  rowSpacing: number
  colSpacing: number
  orientation: Orientation
  sliceSpacing: number
  ordered: SliceProbe[]
}

interface VolumeBuild {
  u8: Uint8Array
  huRange: [number, number]
  quantRange: [number, number]
}

interface BuildContext {
  ordered: SliceProbe[]
  rows: number
  cols: number
  factor: number
  dims: Vec3
  report: (progress: ImportProgress) => void
}

function createSkipCounters(): SkipCounters {
  return {
    unreadable: 0,
    parseErrors: 0,
    noPixelData: 0,
    notCt: 0,
    compressed: 0,
    unsupportedTransferSyntax: 0,
    unsupportedPixel: 0,
    missingGeometry: 0,
    pixelLength: 0,
  }
}

function parseNumberList(text: string | undefined, count: number): number[] | null {
  if (!text) return null
  const values = text.split('\\').map((value) => Number(value.trim()))
  if (values.length < count) return null
  const head = values.slice(0, count)
  return head.every((value) => Number.isFinite(value)) ? head : null
}

function finiteOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Decodes a raw text element: UTF-8 when valid, GB18030 otherwise (Chinese names). */
function decodeDicomText(bytes: Uint8Array): string {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    try {
      text = new TextDecoder('gb18030').decode(bytes)
    } catch {
      text = new TextDecoder('utf-8').decode(bytes)
    }
  }
  return text
    .replace(/\0/g, '')
    .replace(/\^/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function elementText(ds: DicomDataSet, tag: string): string {
  const element = ds.elements[tag]
  if (!element || element.length <= 0) return ''
  const end = element.dataOffset + element.length
  return decodeDicomText(ds.byteArray.subarray(element.dataOffset, end))
}

function readHeader(ds: DicomDataSet): StudyHeader {
  return {
    patientId: elementText(ds, 'x00100020') || (ds.string('x00100020') ?? '').trim(),
    patientName: elementText(ds, 'x00100010'),
    sex: (ds.string('x00100040') ?? '').trim(),
    age: (ds.string('x00101010') ?? '').trim(),
    studyDate: (ds.string('x00080020') ?? '').trim(),
    studyTime: (ds.string('x00080030') ?? '').trim(),
    manufacturer: (ds.string('x00080070') ?? '').trim(),
    model: (ds.string('x00081090') ?? '').trim(),
    kvp: finiteOrNull(ds.floatString('x00180060')),
    exposureTime: finiteOrNull(ds.intString('x00181150')),
    xrayCurrent: finiteOrNull(ds.intString('x00181151')),
    doseProduct: finiteOrNull(ds.floatString('x0018115e')),
    scanType: (ds.string('x40101048') ?? '').trim(),
  }
}

function isCompressedSyntax(transferSyntax: string): boolean {
  return transferSyntax.startsWith(JPEG_FAMILY_PREFIX) || transferSyntax.startsWith(RLE_SYNTAX_PREFIX)
}

/**
 * Reads and parses one file, returning only small header values. The pixel buffer
 * is not retained: the accumulation pass re-reads the file once the slice order
 * and downsample factor are known, which keeps peak memory at one slice.
 */
async function probeFile(file: File, counters: SkipCounters): Promise<SliceProbe | null> {
  let buffer: ArrayBuffer
  try {
    buffer = await file.arrayBuffer()
  } catch {
    counters.unreadable++
    return null
  }

  try {
    const ds = dicomParser.parseDicom(new Uint8Array(buffer))
    const pixel = ds.elements.x7fe00010
    if (!pixel) {
      counters.noPixelData++
      return null
    }

    const modality = (ds.string('x00080060') ?? '').trim().toUpperCase()
    if (modality !== '' && modality !== 'CT') {
      counters.notCt++
      return null
    }

    const transferSyntax = (ds.string('x00020010') ?? '').trim()
    const encapsulated = pixel.encapsulatedPixelData === true || (pixel.fragments?.length ?? 0) > 0
    if (encapsulated || isCompressedSyntax(transferSyntax)) {
      counters.compressed++
      return null
    }
    if (transferSyntax !== '' && !UNCOMPRESSED_TRANSFER_SYNTAX.has(transferSyntax)) {
      counters.unsupportedTransferSyntax++
      return null
    }

    const rows = ds.uint16('x00280010') ?? 0
    const cols = ds.uint16('x00280011') ?? 0
    if (rows <= 0 || cols <= 0) {
      counters.missingGeometry++
      return null
    }

    const pixelCount = rows * cols
    if (pixel.length < pixelCount * 2) {
      counters.pixelLength++
      return null
    }

    const bitsAllocated = ds.uint16('x00280100')
    const pixelRepresentation = ds.uint16('x00280103')
    if (bitsAllocated !== undefined && bitsAllocated !== 16) {
      counters.unsupportedPixel++
      return null
    }
    if (pixelRepresentation !== undefined && pixelRepresentation > 1) {
      counters.unsupportedPixel++
      return null
    }

    const positionValues = parseNumberList(ds.string('x00200032'), 3)
    const orientationValues = parseNumberList(ds.string('x00200037'), 6)
    const spacingValues = parseNumberList(ds.string('x00280030'), 2)
    const sliceThickness = ds.floatString('x00180050') ?? 0

    return {
      file,
      name: file.name,
      seriesUid: (ds.string('x0020000e') ?? '').trim(),
      instanceNumber: ds.intString('x00200013') ?? 0,
      position: positionValues ? [positionValues[0], positionValues[1], positionValues[2]] : null,
      orientation: orientationValues
        ? [
            orientationValues[0],
            orientationValues[1],
            orientationValues[2],
            orientationValues[3],
            orientationValues[4],
            orientationValues[5],
          ]
        : null,
      rows,
      cols,
      // DICOM PixelSpacing is [row spacing (y), column spacing (x)] in mm.
      rowSpacing: spacingValues ? spacingValues[0] : null,
      colSpacing: spacingValues ? spacingValues[1] : null,
      sliceThickness: Number.isFinite(sliceThickness) && sliceThickness > 0 ? sliceThickness : 0,
      signed: pixelRepresentation === 1,
      header: readHeader(ds),
    }
  } catch {
    counters.parseErrors++
    return null
  }
}

function studyScore(slices: SliceProbe[]): string {
  const header = slices[0].header
  return `${header.studyDate}${header.studyTime}`
}

/** Picks the series with the most slices; ties go to the most recent study. */
function chooseSeries(probes: SliceProbe[]): SliceProbe[] {
  const groups = new Map<string, SliceProbe[]>()
  for (const probe of probes) {
    const group = groups.get(probe.seriesUid)
    if (group) group.push(probe)
    else groups.set(probe.seriesUid, [probe])
  }

  let best: SliceProbe[] = []
  let bestScore = ''
  for (const group of groups.values()) {
    const score = studyScore(group)
    if (group.length > best.length || (group.length === best.length && score > bestScore)) {
      best = group
      bestScore = score
    }
  }
  return best
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function spacingOrDefault(values: (number | null)[], fallback: number): number {
  const usable = values.filter((value): value is number => value !== null && Number.isFinite(value) && value > 0)
  return usable.length > 0 ? median(usable) : fallback
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/** Rounds a millimetre value to 1e-6 to keep the JSON metadata free of float dust. */
function roundSpacing(value: number): number {
  return Number(value.toFixed(6))
}

function medianSliceThickness(slices: SliceProbe[]): number {
  const thickness = spacingOrDefault(
    slices.map((slice) => slice.sliceThickness),
    0,
  )
  return thickness > 0 ? thickness : 1
}

/** Validates geometry across the chosen series and orders slices along the slice normal. */
function analyzeSeries(slices: SliceProbe[]): SeriesGeometry {
  const first = slices[0]
  const rows = first.rows
  const cols = first.cols
  for (const slice of slices) {
    if (slice.rows !== rows || slice.cols !== cols) {
      throw new Error(
        `序列内图像尺寸不一致（${slice.rows}×${slice.cols} 与 ${rows}×${cols} 不同）：请确认文件夹内只有同一序列的 DICOM。`,
      )
    }
  }

  const rowSpacing = spacingOrDefault(
    slices.map((slice) => slice.rowSpacing),
    1,
  )
  const colSpacing = spacingOrDefault(
    slices.map((slice) => slice.colSpacing),
    1,
  )
  const rowTolerance = Math.max(0.005, rowSpacing * 0.01)
  const colTolerance = Math.max(0.005, colSpacing * 0.01)
  for (const slice of slices) {
    if (slice.rowSpacing !== null && Math.abs(slice.rowSpacing - rowSpacing) > rowTolerance) {
      throw new Error(`序列内像素间距不一致（行间距 ${slice.rowSpacing} mm 与 ${rowSpacing} mm 不同）：请重新导出同一序列。`)
    }
    if (slice.colSpacing !== null && Math.abs(slice.colSpacing - colSpacing) > colTolerance) {
      throw new Error(`序列内像素间距不一致（列间距 ${slice.colSpacing} mm 与 ${colSpacing} mm 不同）：请重新导出同一序列。`)
    }
  }

  const oriented = slices.filter((slice) => slice.orientation !== null)
  const orientation: Orientation = oriented.length > 0 ? [...oriented[0].orientation!] : [...DEFAULT_ORIENTATION]
  for (const slice of oriented) {
    for (let i = 0; i < 6; i++) {
      if (Math.abs(slice.orientation![i] - orientation[i]) > 1e-3) {
        throw new Error('序列内图像方向不一致，可能混入了定位像或其他序列：请只选择同一 CBCT 序列。')
      }
    }
  }

  const hasPositions = slices.every((slice) => slice.position !== null)
  let ordered: SliceProbe[]
  let sliceSpacing: number
  if (hasPositions) {
    const rowDirection: Vec3 = [orientation[0], orientation[1], orientation[2]]
    const columnDirection: Vec3 = [orientation[3], orientation[4], orientation[5]]
    let normal = cross(rowDirection, columnDirection)
    const length = Math.hypot(normal[0], normal[1], normal[2])
    if (!(length > 1e-6)) {
      normal = [0, 0, 1]
    } else {
      normal = [normal[0] / length, normal[1] / length, normal[2] / length]
    }

    const keyed = slices.map((slice) => ({ slice, at: dot(slice.position!, normal) }))
    keyed.sort((a, b) => a.at - b.at || a.slice.instanceNumber - b.slice.instanceNumber)

    const gaps: number[] = []
    for (let i = 1; i < keyed.length; i++) {
      const gap = keyed[i].at - keyed[i - 1].at
      if (gap > 1e-4) gaps.push(gap)
    }
    ordered = keyed.map((entry) => entry.slice)
    sliceSpacing = gaps.length > 0 ? median(gaps) : medianSliceThickness(ordered)
  } else {
    ordered = [...slices].sort((a, b) => a.instanceNumber - b.instanceNumber || a.name.localeCompare(b.name))
    sliceSpacing = medianSliceThickness(ordered)
  }
  if (!(sliceSpacing > 1e-4)) sliceSpacing = 1

  return { rows, cols, rowSpacing, colSpacing, orientation, sliceSpacing, ordered }
}

/** Returns a typed view over the pixel data, copying only when the bytes are misaligned. */
function readPixelValues(
  bytes: Uint8Array,
  pixel: DicomElement,
  count: number,
  signed: boolean,
  scratch: Int16Array | Uint16Array,
): Int16Array | Uint16Array {
  const start = bytes.byteOffset + pixel.dataOffset
  const byteLength = count * 2
  if (start % 2 === 0 && start + byteLength <= bytes.byteLength) {
    return signed ? new Int16Array(bytes.buffer, start, count) : new Uint16Array(bytes.buffer, start, count)
  }

  const view = new DataView(bytes.buffer, start, byteLength)
  if (signed) {
    const out = scratch as Int16Array
    for (let i = 0; i < count; i++) out[i] = view.getInt16(i * 2, true)
  } else {
    const out = scratch as Uint16Array
    for (let i = 0; i < count; i++) out[i] = view.getUint16(i * 2, true)
  }
  return scratch
}

function histogramValueAt(hist: Uint32Array, underflow: number, target: number): number {
  if (underflow >= target) return HIST_MIN
  let cumulative = underflow
  for (let i = 0; i < hist.length; i++) {
    cumulative += hist[i]
    if (cumulative >= target) return HIST_MIN + (i + 0.5) * HIST_BIN_WIDTH
  }
  return HIST_MAX
}

/**
 * Second pass: re-reads slices in order, block-averages HU into a float accumulator,
 * converts to uint8 with a robust quantile window and releases the accumulator on return.
 */
async function buildVolumeFromSlices(context: BuildContext): Promise<VolumeBuild> {
  const { ordered, rows, cols, factor, dims, report } = context
  const [outW, outH, outD] = dims
  const sliceCount = ordered.length
  const voxelsOut = outW * outH * outD
  const blockCount = factor * factor * factor
  // Only the region that maps onto output voxels is accumulated. The trailing
  // rows / columns / slices that do not fill a full block are dropped, so every
  // output voxel always averages exactly factor^3 source voxels: no count array
  // is needed and the uint8 conversion is a single division by blockCount.
  const mappedCols = outW * factor
  const mappedRows = outH * factor
  const mappedSlices = outD * factor
  const accum = new Float32Array(voxelsOut)

  const scratch: Int16Array | Uint16Array = ordered[0].signed ? new Int16Array(rows * cols) : new Uint16Array(rows * cols)

  const sumSlice = (raw: Int16Array | Uint16Array, slope: number, intercept: number, sliceIndex: number): void => {
    const oz = Math.floor(sliceIndex / factor)
    const ozBase = oz * outH * outW
    for (let y = 0; y < mappedRows; y++) {
      const rowBase = y * cols
      const oyBase = ozBase + Math.floor(y / factor) * outW
      let ox = 0
      for (let xs = 0; xs < mappedCols; xs += factor, ox++) {
        const xe = xs + factor
        let sum = 0
        for (let x = xs; x < xe; x++) {
          const hu = raw[rowBase + x] * slope + intercept
          sum += hu < HU_CLAMP_MIN ? HU_CLAMP_MIN : hu > HU_CLAMP_MAX ? HU_CLAMP_MAX : hu
        }
        accum[oyBase + ox] += sum
      }
    }
  }

  report({ phase: 'parse', done: 0, total: sliceCount, message: `正在解码 ${sliceCount} 层切片…` })
  for (let index = 0; index < sliceCount; index++) {
    const probe = ordered[index]
    const buffer = await probe.file.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    const ds = dicomParser.parseDicom(bytes)
    const pixel = ds.elements.x7fe00010
    if (!pixel) {
      throw new Error(`切片缺少像素数据（${probe.name}），请重新导出该 DICOM 序列。`)
    }
    if (pixel.length < rows * cols * 2) {
      throw new Error(`切片像素数据长度异常（${probe.name}），请重新导出该 DICOM 序列。`)
    }
    const rawSlope = ds.floatString('x00281053')
    const rawIntercept = ds.floatString('x00281052')
    const slope = typeof rawSlope === 'number' && Number.isFinite(rawSlope) && rawSlope !== 0 ? rawSlope : 1
    const intercept = typeof rawIntercept === 'number' && Number.isFinite(rawIntercept) ? rawIntercept : 0
    if (index < mappedSlices) {
      const raw = readPixelValues(bytes, pixel, rows * cols, probe.signed, scratch)
      sumSlice(raw, slope, intercept, index)
    }
    report({ phase: 'parse', done: index + 1, total: sliceCount })
  }

  report({ phase: 'volume', done: 0, total: voxelsOut, message: `正在构建 ${outW}×${outH}×${outD} 体积…` })

  const hist = new Uint32Array(HIST_BINS)
  let histUnder = 0
  let histOver = 0
  let huMin = Infinity
  let huMax = -Infinity
  for (let i = 0; i < voxelsOut; i++) {
    const hu = accum[i] / blockCount
    accum[i] = hu
    if (hu < huMin) huMin = hu
    if (hu > huMax) huMax = hu
    if (hu < HIST_MIN) histUnder++
    else if (hu >= HIST_MAX) histOver++
    else hist[((hu - HIST_MIN) / HIST_BIN_WIDTH) | 0]++
  }

  const targetLow = 0.001 * voxelsOut
  const targetHigh = 0.999 * voxelsOut
  const pLow = histUnder >= targetLow ? huMin : histogramValueAt(hist, histUnder, targetLow)
  const pHigh = histOver > 0 && targetHigh > voxelsOut - histOver ? huMax : histogramValueAt(hist, histUnder, targetHigh)

  const qMin = Math.max(HU_CLAMP_MIN, Math.min(-1024, Math.floor(pLow)))
  let qMax = Math.min(HU_CLAMP_MAX, Math.max(3000, Math.ceil(pHigh)))
  if (qMax <= qMin + 1) qMax = Math.min(HU_CLAMP_MAX, qMin + 2)

  const huLow = Math.max(HU_CLAMP_MIN, Math.floor(huMin))
  const huHigh = Math.max(huLow + 1, Math.min(HU_CLAMP_MAX, Math.ceil(huMax)))

  const u8 = new Uint8Array(voxelsOut)
  const quantSpan = qMax - qMin
  for (let i = 0; i < voxelsOut; i++) {
    const normalized = ((accum[i] - qMin) / quantSpan) * 255
    u8[i] = normalized <= 0 ? 0 : normalized >= 255 ? 255 : (normalized + 0.5) | 0
  }

  report({ phase: 'volume', done: voxelsOut, total: voxelsOut })
  return { u8, huRange: [huLow, huHigh], quantRange: [qMin, qMax] }
}

/** Renders one axial slice of the downsampled volume as a PNG data URL (null outside a DOM). */
function renderPreview(volume: VolumeData): string | null {
  if (typeof document === 'undefined') return null
  try {
    const canvas = document.createElement('canvas')
    canvas.width = PREVIEW_SIZE
    canvas.height = PREVIEW_SIZE
    const context = canvas.getContext('2d')
    if (!context) return null

    const image = context.createImageData(PREVIEW_SIZE, PREVIEW_SIZE)
    const [width, height, depth] = volume.dims
    const sliceIndex = Math.max(0, Math.min(depth - 1, Math.floor(depth / 2)))
    const [quantLow, quantHigh] = volume.quantRange
    const quantSpan = quantHigh - quantLow
    const windowLow = PREVIEW_WINDOW_CENTER - PREVIEW_WINDOW_WIDTH / 2
    const sliceBase = sliceIndex * height * width

    for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255

    const scale = Math.min(PREVIEW_SIZE / width, PREVIEW_SIZE / height)
    const drawWidth = Math.max(1, Math.min(PREVIEW_SIZE, Math.round(width * scale)))
    const drawHeight = Math.max(1, Math.min(PREVIEW_SIZE, Math.round(height * scale)))
    const offsetX = Math.floor((PREVIEW_SIZE - drawWidth) / 2)
    const offsetY = Math.floor((PREVIEW_SIZE - drawHeight) / 2)

    for (let py = 0; py < drawHeight; py++) {
      const sy = Math.min(height - 1, Math.floor(py / scale))
      const rowBase = sliceBase + sy * width
      for (let px = 0; px < drawWidth; px++) {
        const sx = Math.min(width - 1, Math.floor(px / scale))
        const hu = quantLow + (volume.u8[rowBase + sx] / 255) * quantSpan
        const normalized = (hu - windowLow) / PREVIEW_WINDOW_WIDTH
        const gray = normalized <= 0 ? 0 : normalized >= 1 ? 255 : Math.round(normalized * 255)
        const offset = ((py + offsetY) * PREVIEW_SIZE + (px + offsetX)) * 4
        image.data[offset] = gray
        image.data[offset + 1] = gray
        image.data[offset + 2] = gray
      }
    }

    context.putImageData(image, 0, 0)
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

function describeNoSeries(counters: SkipCounters): string {
  if (counters.compressed > 0) {
    return '压缩的 DICOM 暂不支持，请导出未压缩序列（Explicit VR Little Endian）。'
  }
  if (counters.unsupportedTransferSyntax > 0) {
    return '不支持的 DICOM 传输语法（大端或封装格式），请导出 Explicit VR Little Endian 未压缩序列。'
  }
  if (counters.unsupportedPixel > 0) {
    return '不支持的像素格式：仅支持未压缩 16-bit CT DICOM（BitsAllocated=16，有/无符号均可）。'
  }
  if (counters.notCt > 0) {
    return '未找到 CBCT/CT 序列（检测到其他 MODALITY 的文件），请选择 CBCT 检查的 DICOM 文件夹。'
  }
  const parts: string[] = []
  if (counters.noPixelData > 0) parts.push(`${counters.noPixelData} 个文件没有像素数据`)
  if (counters.pixelLength > 0) parts.push(`${counters.pixelLength} 个文件像素数据不完整`)
  if (counters.missingGeometry > 0) parts.push(`${counters.missingGeometry} 个文件缺少图像尺寸`)
  if (counters.parseErrors > 0) parts.push(`${counters.parseErrors} 个文件无法解析`)
  if (counters.unreadable > 0) parts.push(`${counters.unreadable} 个文件无法读取`)
  const detail = parts.length > 0 ? `（${parts.join('，')}）` : ''
  return `未找到可用的 CBCT 序列（需要未压缩 16-bit CT DICOM）${detail}。请选择包含完整 DICOM 序列的文件夹。`
}

/**
 * Browser-side DICOM series importer: reads a folder of CT/CBCT files sequentially
 * (never retaining raw slices), block-averages them into a uint8 volume, and derives
 * the same metadata shape as the preprocessed sample.
 */
export async function importDicomFiles(
  files: File[],
  onProgress: (progress: ImportProgress) => void,
): Promise<ImportResult> {
  if (files.length === 0) {
    throw new Error('没有选择任何文件，请选择一个包含 CBCT DICOM 序列的文件夹。')
  }

  let lastPhase: ImportProgress['phase'] | null = null
  let lastPercent = -1
  const report = (progress: ImportProgress): void => {
    const percent = progress.total > 0 ? Math.floor((progress.done / progress.total) * 100) : 0
    const boundary = progress.phase !== lastPhase || progress.message !== undefined || progress.done >= progress.total
    if (!boundary && percent < lastPercent + 2) return
    lastPhase = progress.phase
    lastPercent = percent
    onProgress(progress)
  }

  report({ phase: 'read', done: 0, total: files.length, message: `正在读取 ${files.length} 个 DICOM 文件…` })
  const counters = createSkipCounters()
  const probes: SliceProbe[] = []
  for (let index = 0; index < files.length; index++) {
    const probe = await probeFile(files[index], counters)
    if (probe) probes.push(probe)
    report({ phase: 'read', done: index + 1, total: files.length })
  }

  if (probes.length === 0) {
    throw new Error(describeNoSeries(counters))
  }

  const series = chooseSeries(probes)
  if (series.length < MIN_SERIES_SLICES) {
    throw new Error(
      `所选序列只有 ${series.length} 层，可能不是完整 CBCT 序列（至少需要 ${MIN_SERIES_SLICES} 层）：请选择包含全部切片的 DICOM 文件夹。`,
    )
  }

  const skipped = files.length - probes.length
  report({
    phase: 'read',
    done: files.length,
    total: files.length,
    message:
      skipped > 0
        ? `已识别 ${series.length} 层 CT 序列，跳过 ${skipped} 个非 DICOM / 无关文件`
        : `已识别 ${series.length} 层 CT 序列`,
  })

  const geometry = analyzeSeries(series)
  const { ordered, rows, cols, rowSpacing, colSpacing, sliceSpacing } = geometry
  const sliceCount = ordered.length
  const factor = Math.max(1, Math.ceil(Math.max(rows, cols, sliceCount) / MAX_TARGET_DIM))
  const dims: Vec3 = [
    Math.max(1, Math.floor(cols / factor)),
    Math.max(1, Math.floor(rows / factor)),
    Math.max(1, Math.floor(sliceCount / factor)),
  ]

  const build = await buildVolumeFromSlices({ ordered, rows, cols, factor, dims, report })

  const spacing: Vec3 = [
    roundSpacing(colSpacing * factor),
    roundSpacing(rowSpacing * factor),
    roundSpacing(sliceSpacing * factor),
  ]

  const volume: VolumeData = {
    u8: build.u8,
    dims,
    spacing,
    quantRange: build.quantRange,
  }

  const header = ordered[0].header
  const [quantMin, quantMax] = build.quantRange
  const meta: VolumeMeta = {
    schema: SCHEMA,
    generatedAt: new Date().toISOString(),
    source: {
      directory: 'local import',
      sliceCount,
      slicePattern: 'DICOM',
    },
    patient: {
      id: header.patientId,
      name: header.patientName,
      latinName: '',
      sex: header.sex,
      age: header.age,
      birthDate: '',
    },
    study: {
      date: header.studyDate,
      time: header.studyTime,
      modality: 'CT',
      manufacturer: header.manufacturer,
      model: header.model,
      kvp: header.kvp,
      exposureTime: header.exposureTime,
      xrayCurrent: header.xrayCurrent,
      doseProduct: header.doseProduct,
      scanType: header.scanType,
    },
    volume: {
      dims,
      spacing,
      originalDims: [cols, rows, sliceCount],
      originalSpacing: [
        roundSpacing(colSpacing),
        roundSpacing(rowSpacing),
        roundSpacing(sliceSpacing),
      ],
      downsampleFactor: factor,
      huRange: build.huRange,
      quantRange: build.quantRange,
      dataType: { u8: 'uint8' },
      byteOrder: 'little-endian',
      layout: 'x fastest, then y, then z (C order)',
    },
    files: {
      u8: '',
      thumbnail: null,
    },
    windows: [
      { id: 'bone', label: 'Bone', center: 600, width: 2600 },
      { id: 'soft', label: 'Soft tissue', center: 50, width: 500 },
      { id: 'dental', label: 'Dental', center: 900, width: 3600 },
      { id: 'full', label: 'Full range', center: Math.round((quantMin + quantMax) / 2), width: quantMax - quantMin },
    ],
  }

  report({ phase: 'roi', done: 0, total: 1, message: '正在分析牙弓感兴趣区域…' })
  let dental: DentalRoi | null = null
  try {
    dental = computeDentalRoi(volume, meta)
  } catch {
    dental = null
  }
  report({ phase: 'roi', done: 1, total: 1 })

  const previewDataUrl = renderPreview(volume)

  report({ phase: 'done', done: 1, total: 1, message: `导入完成：${dims.join('×')}` })
  return { meta, volume, dental, previewDataUrl }
}
