/**
 * Headless visual check for the CBCT volume viewer.
 *
 *   node tools/shot.mjs [url] [outfile]
 *
 * Uses the Playwright Chromium already installed on this machine. Prints console
 * output, page errors and a small WebGL report so rendering failures are visible
 * from the terminal.
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const url = process.argv[2] ?? 'http://127.0.0.1:5173/'
const out = process.argv[3] ?? 'tools/screenshots/01-main.png'
const exe =
  process.env.CHROME_PATH ??
  `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe`

fs.mkdirSync(path.dirname(out), { recursive: true })

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})

const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
const logs = []
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`))
page.on('pageerror', (error) => logs.push(`[pageerror] ${error.message}`))

const started = Date.now()
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForSelector('canvas', { timeout: 60000 }).catch(() => {})
if (await page.getByText('加载示例病例').count()) {
  await page.getByText('加载示例病例').click().catch(() => {})
}
await page.waitForTimeout(7000)

const report = await page.evaluate(() => {
  const canvas = document.querySelector('canvas')
  const info = {
    canvas: !!canvas,
    canvasSize: canvas ? [canvas.width, canvas.height] : null,
    bodyText: document.body.innerText.slice(0, 400),
    loaderVisible: !!document.querySelector('.loader:not(.is-done)'),
    loaderPhase: document.querySelector('.loader__phase')?.textContent ?? null,
    fps: document.querySelector('.metric b')?.textContent ?? null,
  }
  if (canvas) {
    const gl = canvas.getContext('webgl2')
    info.webgl2 = !!gl
    if (gl) {
      info.renderer = gl.getParameter(gl.RENDERER)
      info.vendor = gl.getParameter(gl.VENDOR)
      info.version = gl.getParameter(gl.VERSION)
      const pixels = new Uint8Array(4 * 64 * 64)
      gl.readPixels(
        Math.floor(canvas.width / 2) - 32,
        Math.floor(canvas.height / 2) - 32,
        64,
        64,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels,
      )
      let nonZero = 0
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) nonZero++
      info.alphaNonZero = nonZero
    }
  }
  return info
})

await page.screenshot({ path: out })
console.log(JSON.stringify({ elapsedMs: Date.now() - started, report, logs }, null, 2))
console.log(`screenshot: ${path.resolve(out)}`)
await browser.close()

