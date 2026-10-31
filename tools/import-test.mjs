#!/usr/bin/env node
/**
 * Node smoke test for the browser DICOM import pipeline.
 *
 * Runs `src/data/dicomImport.ts` against the bundled sample CBCT series without a
 * browser: the pipeline is DOM-free except for the optional preview canvas, which
 * returns null when `document` is undefined.
 *
 *   pnpm exec tsx tools/import-test.mjs
 *
 * It checks the output geometry, cross-checks a few downsampled voxels against the
 * source DICOM pixels, times the import and prints the dental ROI.
 */
import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

import dicomParser from 'dicom-parser'

import { importDicomFiles } from '../src/data/dicomImport.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SERIES_DIR = path.join(ROOT, 'Dicom', '20260314112507-0-1-10')
const WARM_TIMEOUT_MS = 240000

/** File-compatible lazy reader so the test never holds 400 slices (≈330 MB) in memory. */
class LazyFile {
  constructor(filePath) {
    this.path = filePath
    this.name = path.basename(filePath)
    this.size = fs.statSync(filePath).size
  }

  async arrayBuffer() {
    const buffer = await fs.promises.readFile(this.path)
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  }
}

function readRawSlice(filePath) {
  const buffer = fs.readFileSync(filePath)
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const ds = dicomParser.parseDicom(bytes)
  const element = ds.elements.x7fe00010
  const rows = ds.uint16('x00280010')
  const cols = ds.uint16('x00280011')
  const slope = ds.floatString('x00281053') ?? 1
  const intercept = ds.floatString('x00281052') ?? 0
  const start = bytes.byteOffset + element.dataOffset
  const pixels = new Int16Array(bytes.buffer, start, rows * cols)
  return { pixels, rows, cols, slope, intercept }
}

async function main() {
  if (!fs.existsSync(SERIES_DIR)) {
    console.error(`[test] sample series not found: ${SERIES_DIR}`)
    process.exitCode = 1
    return
  }

  const entries = fs.readdirSync(SERIES_DIR).sort()
  const files = entries.map((name) => {
    const filePath = path.join(SERIES_DIR, name)
    if (fs.statSync(filePath).isDirectory()) return null
    // Real Node File for the small non-DICOM files (tests the "skip silently" path).
    if (!/\.dcm$/i.test(name)) return new File([fs.readFileSync(filePath)], name)
    return new LazyFile(filePath)
  }).filter(Boolean)

  console.log(`[test] sample: ${SERIES_DIR}`)
  console.log(`[test] input files: ${files.length} (${entries.filter((n) => /\.dcm$/i.test(n)).length} .dcm)`)

  const start = performance.now()
  let calls = 0
  const messages = []
  const phaseTimes = {}
  let readMessage = ''
  let preview = null
  let result = null
  let failure = null

  const timeout = setTimeout(() => {
    console.error(`[test] TIMEOUT after ${WARM_TIMEOUT_MS} ms`)
    process.exit(2)
  }, WARM_TIMEOUT_MS)

  try {
    result = await importDicomFiles(files, (progress) => {
      calls++
      if (!(progress.phase in phaseTimes)) phaseTimes[progress.phase] = performance.now() - start
      if (progress.message) {
        messages.push(progress.message)
        if (progress.phase === 'read') readMessage = progress.message
      }
    })
    preview = result.previewDataUrl
  } catch (error) {
    failure = error
  } finally {
    clearTimeout(timeout)
  }
  const elapsed = performance.now() - start

  if (failure) {
    console.error('[test] import failed:', failure instanceof Error ? failure.message : failure)
    process.exitCode = 1
    return
  }
  if (!result) {
    console.error('[test] import returned no result')
    process.exitCode = 1
    return
  }

  const { meta, volume, dental } = result
  const [w, h, d] = volume.dims
  console.log(`[test] elapsed:            ${elapsed.toFixed(0)} ms`)
  console.log(`[test] onProgress calls:   ${calls}`)
  console.log(`[test] phase timings:      ${JSON.stringify(Object.fromEntries(Object.entries(phaseTimes).map(([k, v]) => [k, Math.round(v)])))}`)
  console.log(`[test] read message:       ${readMessage}`)
  console.log(`[test] final message:      ${messages[messages.length - 1]}`)
  console.log(`[test] dims:               [${w}, ${h}, ${d}] (voxels ${w * h * d})`)
  console.log(`[test] u8 bytes:           ${volume.u8.length} (expected ${w * h * d})`)
  console.log(`[test] spacing:            [${volume.spacing.join(', ')}] mm`)
  console.log(`[test] original dims:      [${meta.volume.originalDims.join(', ')}] @ [${meta.volume.originalSpacing.join(', ')}] mm`)
  console.log(`[test] downsample factor:  ${meta.volume.downsampleFactor}`)
  console.log(`[test] huRange:            [${meta.volume.huRange.join(', ')}]`)
  console.log(`[test] quantRange:         [${meta.volume.quantRange.join(', ')}]`)
  console.log(`[test] schema/source:      ${meta.schema} / ${meta.source.directory} / ${meta.source.sliceCount} slices / ${meta.source.slicePattern}`)
  console.log(`[test] patient:            ${meta.patient.name} (${meta.patient.id}) ${meta.patient.sex} ${meta.patient.age}`)
  console.log(`[test] study:              ${meta.study.date} ${meta.study.time} ${meta.study.manufacturer} ${meta.study.model} kvp=${meta.study.kvp} scan=${meta.study.scanType}`)
  console.log(`[test] windows:            ${meta.windows.map((win) => `${win.id}:${win.center}/${win.width}`).join(' ')}`)
  console.log(`[test] previewDataUrl:     ${preview === null ? 'null (no DOM — expected in Node)' : `PNG ${preview.length} chars`}`)

  if (dental) {
    const stats = dental.stats
    console.log(`[test] dental voxelBox:    min=[${dental.voxelBox.min.join(', ')}] max=[${dental.voxelBox.max.join(', ')}]`)
    console.log(`[test] dental worldBoxMm:  min=[${dental.worldBoxMm.min.join(', ')}] max=[${dental.worldBoxMm.max.join(', ')}]`)
    console.log(`[test] dental voxelBounds: x[${stats.voxelBounds.x}] y[${stats.voxelBounds.y}] z[${stats.voxelBounds.z}]`)
    console.log(`[test] dental stats:       method=${stats.method} thresholdHu=${stats.thresholdHu} core=${stats.coreVoxels} dense=${stats.denseSharePct}% tooth=${stats.toothVoxels} enamel=${stats.enamelVoxels}`)
  } else {
    console.log('[test] dental ROI:         null')
  }

  // --- correctness checks --------------------------------------------------
  const problems = []
  if (volume.u8.length !== w * h * d) problems.push('u8 length mismatch')
  if (meta.volume.dims[0] !== w || meta.volume.dims[1] !== h || meta.volume.dims[2] !== d) problems.push('meta dims mismatch')
  if (!(meta.volume.quantRange[1] > meta.volume.quantRange[0])) problems.push('invalid quantRange')
  if (!(meta.volume.huRange[1] > meta.volume.huRange[0])) problems.push('invalid huRange')
  if (meta.volume.downsampleFactor !== 2) problems.push(`unexpected downsampleFactor ${meta.volume.downsampleFactor}`)

  // Cross-check downsampled voxels against the original DICOM pixels (HU space).
  const [qLow, qHigh] = volume.quantRange
  const huFromU8 = (value) => qLow + (value / 255) * (qHigh - qLow)
  const slices = entries.filter((name) => /\.dcm$/i.test(name)).sort()
  const probeVoxels = [
    [Math.floor(w / 2), Math.floor(h / 2), Math.floor(d / 2)],
    [Math.floor(w / 4), Math.floor(h / 3), Math.floor(d / 3)],
    [Math.floor((w * 3) / 4), Math.floor((h * 2) / 3), Math.floor((d * 2) / 3)],
  ]
  const factor = meta.volume.downsampleFactor
  let worstError = 0
  for (const [ox, oy, oz] of probeVoxels) {
    let sum = 0
    let count = 0
    for (let dz = 0; dz < factor; dz++) {
      const slicePath = path.join(SERIES_DIR, slices[oz * factor + dz])
      if (!slicePath) continue
      const raw = readRawSlice(slicePath)
      for (let dy = 0; dy < factor; dy++) {
        const rowBase = (oy * factor + dy) * raw.cols
        for (let dx = 0; dx < factor; dx++) {
          sum += raw.pixels[rowBase + ox * factor + dx] * raw.slope + raw.intercept
          count++
        }
      }
    }
    const expected = sum / count
    const actual = huFromU8(volume.u8[ox + oy * w + oz * w * h])
    const error = Math.abs(expected - actual)
    worstError = Math.max(worstError, error)
    const step = (qHigh - qLow) / 255
    const tag = error <= step / 2 + 2 ? 'OK' : 'MISMATCH'
    if (tag === 'MISMATCH') problems.push(`voxel ${ox},${oy},${oz}: expected ${expected.toFixed(1)} HU, got ${actual.toFixed(1)} HU`)
    console.log(
      `[test] voxel ${ox},${oy},${oz}: expected ${expected.toFixed(1)} HU, got ${actual.toFixed(1)} HU (quant step ${step.toFixed(2)}) ${tag}`,
    )
  }
  console.log(`[test] worst HU error:      ${worstError.toFixed(2)} HU`)

  // u8 histogram sanity: not a constant / not saturated.
  let minU8 = 255
  let maxU8 = 0
  for (let i = 0; i < volume.u8.length; i += 97) {
    const value = volume.u8[i]
    if (value < minU8) minU8 = value
    if (value > maxU8) maxU8 = value
  }
  console.log(`[test] sampled u8 range:   [${minU8}, ${maxU8}]`)
  if (maxU8 - minU8 < 32) problems.push('u8 volume looks flat/saturated')

  // --- preview canvas path (stubbed DOM, small 10-slice series) -------------
  try {
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
        putImageData: () => {},
      }),
      toDataURL: () => 'data:image/png;base64,stub',
    }
    globalThis.document = { createElement: () => fakeCanvas }
    const smallFiles = slices.slice(190, 200).map((name) => new LazyFile(path.join(SERIES_DIR, name)))
    const small = await importDicomFiles(smallFiles, () => {})
    if (small.previewDataUrl !== 'data:image/png;base64,stub') problems.push('preview stub was not used')
    console.log(`[test] preview (stub DOM): ${small.previewDataUrl}`)
    console.log(`[test] small series:       dims [${small.volume.dims.join(', ')}] dental=${small.dental ? 'yes' : 'null'}`)
  } catch (error) {
    problems.push(`preview stub run failed: ${error instanceof Error ? error.message : error}`)
  } finally {
    delete globalThis.document
  }

  // --- error behaviour ------------------------------------------------------
  try {
    await importDicomFiles([], () => {})
    problems.push('empty selection did not throw')
  } catch (error) {
    console.log(`[test] empty selection:    threw "${error instanceof Error ? error.message : error}"`)
  }
  try {
    const thumbPath = path.join(SERIES_DIR, 'thumbnail.jpg')
    const thumb = new File([fs.readFileSync(thumbPath)], 'thumbnail.jpg')
    await importDicomFiles([thumb], () => {})
    problems.push('non-DICOM-only selection did not throw')
  } catch (error) {
    console.log(`[test] non-DICOM only:     threw "${error instanceof Error ? error.message : error}"`)
  }

  const memory = process.memoryUsage()
  console.log(`[test] memory:            rss ${(memory.rss / 1024 / 1024).toFixed(0)} MB, heapUsed ${(memory.heapUsed / 1024 / 1024).toFixed(0)} MB`)

  if (problems.length > 0) {
    console.error('[test] FAIL')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exitCode = 1
  } else {
    console.log('[test] PASS')
  }
}

main().catch((error) => {
  console.error('[test] crashed:', error)
  process.exitCode = 1
})
