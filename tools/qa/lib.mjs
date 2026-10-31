/**
 * Shared helpers for the CBCT viewer QA suite (Playwright + software WebGL).
 *
 * Everything here is local: no network, no server management. The dev server is
 * assumed to be already running at CBCT_URL (default http://127.0.0.1:5173/).
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { chromium } from 'playwright-core'

export const BASE = process.env.CBCT_URL ?? 'http://127.0.0.1:5173/'
export const SHOT_DIR = path.resolve('tools/screenshots')
export const QA_DIR = path.resolve('tools/qa')
export const CHROME =
  process.env.CHROME_PATH ??
  `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe`

export const VIEWPORT = { width: 1600, height: 1000 }
export const PRESET_IDS = ['teeth', 'bone', 'dental', 'soft', 'mip', 'xray', 'heat', 'teal']
export const ZH_LABELS = ['患者', '多平面', '只看牙齿', '骨窗']
export const EN_LABELS = ['Patient', 'MPR', 'Teeth only', 'Bone']

fs.mkdirSync(SHOT_DIR, { recursive: true })

export async function launchDesktop() {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  })
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  return { browser, page }
}

// ------------------------------------------------------------------ console

export function trackConsole(page) {
  const consoleErrors = []
  const pageErrors = []
  const consoleWarnings = []
  page.on('console', (msg) => {
    const text = msg.text()
    if (msg.type() === 'error') consoleErrors.push(text)
    else if (msg.type() === 'warning') consoleWarnings.push(text)
  })
  page.on('pageerror', (err) => pageErrors.push(err.message))
  return { consoleErrors, pageErrors, consoleWarnings }
}

// -------------------------------------------------------------------- state

export async function getState(page) {
  return page.evaluate(() => {
    const s = window.__viewer?.getState?.()
    if (!s) return null
    return {
      status: s.status,
      lang: s.lang,
      presetId: s.presetId,
      lastPreset: s.lastPreset,
      teethOnly: s.teethOnly,
      leftOpen: s.leftOpen,
      rightOpen: s.rightOpen,
      fps: s.fps,
      steps: s.steps,
      opacity: s.opacity,
      cursor: s.cursor,
      windowCenter: s.windowCenter,
      windowWidth: s.windowWidth,
      volumeDims: s.volume?.dims ?? null,
      metaDims: s.meta?.volume.dims ?? null,
      dental: s.dental ?? null,
      volumeBytes: s.volume?.u8?.byteLength ?? null,
      autoRotate: s.autoRotate,
      showGrid: s.showGrid,
      showBox: s.showBox,
      langStorage: window.localStorage.getItem('cbct-lang'),
      docLang: document.documentElement.lang,
      innerWidth: window.innerWidth,
      bodyScrollWidth: document.body.scrollWidth,
      docScrollWidth: document.documentElement.scrollWidth,
    }
  })
}

export async function setFast(page) {
  await page.evaluate(() => {
    const s = window.__viewer.getState()
    s.setAutoRotate(false)
    s.setSteps(96)
  })
}

export async function waitReady(page, { timeout = 180000 } = {}) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForFunction(
    () => {
      try {
        return window.__viewer?.getState?.().status === 'ready'
      } catch {
        return false
      }
    },
    undefined,
    { timeout, polling: 200 },
  )
  // first frames + adaptive dpr settle
  await page.waitForTimeout(1200)
  await setFast(page)
  await page.waitForTimeout(800)
}

/**
 * Wait until `n` animation frames have been presented. Software WebGL runs at
 * 1-4 fps, so wall-clock sleeps are not enough to guarantee a fresh frame.
 */
export async function waitFrames(page, n = 2, timeout = 20000) {
  await page.evaluate(
    ({ frames, limit }) =>
      new Promise((resolve) => {
        let count = 0
        const done = () => resolve({ frames: count, timedOut: false })
        const timer = setTimeout(() => {
          resolve({ frames: count, timedOut: true })
        }, limit)
        const tick = () => {
          count += 1
          if (count >= frames) {
            clearTimeout(timer)
            done()
          } else {
            requestAnimationFrame(tick)
          }
        }
        requestAnimationFrame(tick)
      }),
    { frames: n, limit: timeout },
  )
}

/** Size of the largest <canvas> in the page (R3F canvas, not the MPR 2D ones). */
export async function largestCanvas(page) {
  return page.evaluate(() => {
    let best = null
    for (const canvas of document.querySelectorAll('canvas')) {
      const area = canvas.width * canvas.height
      if (!best || area > best.area) best = { width: canvas.width, height: canvas.height, area, count: document.querySelectorAll('canvas').length }
    }
    return best
  })
}

/** Rendered + raw text used for label assertions (innerText applies CSS uppercase). */
export async function pageLabelSource(page) {
  return page.evaluate(() => {
    const titles = Array.from(document.querySelectorAll('[title]')).map((el) => el.getAttribute('title') ?? '')
    const text = document.body.innerText
    const raw = document.body.textContent ?? ''
    return `${text}\n${raw}\n${titles.join('\n')}`
  })
}

export async function waitFps(page, timeout = 20000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const fps = await page.evaluate(() => window.__viewer?.getState?.().fps ?? 0)
    if (fps > 0) return fps
    await page.waitForTimeout(500)
  }
  return 0
}

// ------------------------------------------------------------------- PNG io

/** Minimal non-interlaced 8-bit PNG decoder (Chromium screenshots: RGB/RGBA). */
export function decodePng(buffer) {
  let p = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat = []
  while (p + 8 <= buffer.length) {
    const len = buffer.readUInt32BE(p)
    const type = buffer.toString('ascii', p + 4, p + 8)
    const data = buffer.subarray(p + 8, p + 8 + len)
    p += 12 + len
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) throw new Error('interlaced PNG unsupported')
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    else if (type === 'PLTE') throw new Error('palette PNG unsupported')
  }
  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`)
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : null
  if (!channels) throw new Error(`unsupported PNG color type ${colorType}`)
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(width * height * 4)
  const prev = Buffer.alloc(stride)
  let off = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[off++]
    const line = raw.subarray(off, off + stride)
    off += stride
    const cur = Buffer.alloc(stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      let v = line[i]
      if (filter === 1) v = (v + a) & 255
      else if (filter === 2) v = (v + b) & 255
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255
      else if (filter === 4) {
        const pa = Math.abs(b - c)
        const pb = Math.abs(a - c)
        const pc = Math.abs(a + b - 2 * c)
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255
      } else if (filter !== 0) throw new Error(`bad PNG filter ${filter}`)
      cur[i] = v
    }
    for (let x = 0; x < width; x++) {
      const si = x * channels
      const di = (y * width + x) * 4
      if (channels === 4) {
        out[di] = cur[si]
        out[di + 1] = cur[si + 1]
        out[di + 2] = cur[si + 2]
        out[di + 3] = cur[si + 3]
      } else if (channels === 3) {
        out[di] = cur[si]
        out[di + 1] = cur[si + 1]
        out[di + 2] = cur[si + 2]
        out[di + 3] = 255
      } else {
        out[di] = out[di + 1] = out[di + 2] = cur[si]
        out[di + 3] = 255
      }
    }
    prev.set(cur)
  }
  return { width, height, rgba: out }
}

export function imageStats(img, { bright = 80 } = {}) {
  const { width, height, rgba } = img
  let sum = 0
  let brightCount = 0
  let max = 0
  const n = width * height
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const lum = 0.2126 * rgba[o] + 0.7152 * rgba[o + 1] + 0.0722 * rgba[o + 2]
    sum += lum
    if (lum >= bright) brightCount++
    if (lum > max) max = lum
  }
  const mean = sum / n
  let variance = 0
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const lum = 0.2126 * rgba[o] + 0.7152 * rgba[o + 1] + 0.0722 * rgba[o + 2]
    variance += (lum - mean) ** 2
  }
  return { width, height, pixels: n, mean: +mean.toFixed(2), std: +Math.sqrt(variance / n).toFixed(2), brightCount, maxLum: Math.round(max) }
}

/** Fraction of pixels whose max channel delta exceeds `threshold`. */
export function diffRatio(a, b, threshold = 12) {
  if (a.width !== b.width || a.height !== b.height) return { same: false, ratio: 1 }
  const n = a.width * a.height
  let changed = 0
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const d = Math.max(
      Math.abs(a.rgba[o] - b.rgba[o]),
      Math.abs(a.rgba[o + 1] - b.rgba[o + 1]),
      Math.abs(a.rgba[o + 2] - b.rgba[o + 2]),
    )
    if (d > threshold) changed++
  }
  return { same: true, ratio: +(changed / n).toFixed(4) }
}

export async function shot(page, name, options = {}) {
  const file = path.join(SHOT_DIR, name)
  // Software WebGL + backdrop-filter panels can take a long time to composite a
  // full-page screenshot on this machine; allow up to two minutes.
  await page.screenshot({ timeout: 120000, ...options, path: file })
  return file
}

export async function shotClip(page, name, clip) {
  const buffer = await page.screenshot({ clip, timeout: 120000 })
  fs.writeFileSync(path.join(SHOT_DIR, name), buffer)
  return decodePng(buffer)
}

export async function clipBuffer(page, clip) {
  return page.screenshot({ clip, timeout: 120000 })
}

// ---------------------------------------------------------------- DOM checks

/** Horizontal overflow of top bar / panels plus any clipped controls. */
export async function layoutReport(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const rect = (el) => {
      const r = el.getBoundingClientRect()
      return { left: +r.left.toFixed(1), right: +r.right.toFixed(1), top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1) }
    }
    const label = (el) => {
      const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.') : ''
      const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 32)
      return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${text ? ` "${text}"` : ''}`
    }
    const visible = (el) => {
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) return false
      const s = getComputedStyle(el)
      return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.01
    }

    const header = document.querySelector('header')
    const headerRect = header ? rect(header) : null
    const headerGroups = header
      ? Array.from(header.children).map((el) => ({ label: label(el), ...rect(el) }))
      : []

    const panels = []
    for (const panel of document.querySelectorAll('.panel')) {
      const isOpen = !panel.classList.contains('is-closed')
      const pr = rect(panel)
      const body = panel.querySelector('.panel__body')
      const br = body ? rect(body) : null
      const clipped = []
      if (body && isOpen) {
        const bodyRect = body.getBoundingClientRect()
        for (const el of body.querySelectorAll('*')) {
          if (!visible(el)) continue
          const r = el.getBoundingClientRect()
          if (r.right > bodyRect.right + 1 || r.left < bodyRect.left - 1) {
            clipped.push({ label: label(el), ...rect(el) })
            if (clipped.length >= 8) break
          }
        }
      }
      panels.push({
        cls: panel.className,
        isOpen,
        panel: pr,
        body: br,
        bodyScroll: body ? { clientWidth: body.clientWidth, scrollWidth: body.scrollWidth, clientHeight: body.clientHeight, scrollHeight: body.scrollHeight, overflowY: getComputedStyle(body).overflowY } : null,
        clippedCount: clipped.length,
        clipped: clipped.slice(0, 8),
        insideViewport: pr.left >= -0.5 && pr.right <= vw + 0.5 && pr.top >= -0.5 && pr.bottom <= vh + 0.5,
      })
    }

    const buttons = Array.from(document.querySelectorAll('header button')).filter(visible).map((el) => ({
      label: label(el),
      text: (el.textContent ?? '').trim(),
      title: el.getAttribute('title'),
      pressed: el.getAttribute('aria-pressed'),
      ...rect(el),
      withinViewport: rect(el).right <= vw + 0.5 && rect(el).left >= -0.5,
    }))

    const brand = document.querySelector('header')?.firstElementChild
    const brandRect = brand ? rect(brand) : null

    return {
      viewport: { width: vw, height: vh },
      bodyScrollWidth: document.body.scrollWidth,
      docScrollWidth: document.documentElement.scrollWidth,
      horizontalOverflow: document.body.scrollWidth > vw + 0.5,
      header: headerRect,
      headerGroups,
      brand: brandRect,
      buttons,
      buttonsOutsideViewport: buttons.filter((b) => !b.withinViewport),
      panels,
    }
  })
}

// -------------------------------------------------------------------- suites

export function makeSuite(name) {
  const started = Date.now()
  const checks = []
  const notes = []
  return {
    name,
    checks,
    notes,
    check(id, title, pass, detail = null) {
      checks.push({ id, title, pass: !!pass, detail })
      const tag = pass ? 'PASS' : 'FAIL'
      console.log(`${tag} ${id} ${title}${detail === null ? '' : ' :: ' + JSON.stringify(detail)}`)
      return pass
    },
    note(text, detail = null) {
      notes.push({ text, detail })
      console.log(`INFO ${text}${detail === null ? '' : ' :: ' + JSON.stringify(detail)}`)
    },
    save(extra = {}) {
      const payload = {
        suite: name,
        generatedAt: new Date().toISOString(),
        elapsedMs: Date.now() - started,
        checks,
        notes,
        ...extra,
      }
      const file = path.join(QA_DIR, `results-${name}.json`)
      fs.writeFileSync(file, JSON.stringify(payload, null, 2))
      const passed = checks.filter((c) => c.pass).length
      console.log(`\n[${name}] ${passed}/${checks.length} checks passed, ${Date.now() - started}ms, results: ${file}`)
      return payload
    },
  }
}
