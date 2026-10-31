/**
 * Visual gallery + interaction smoke test for the CBCT viewer.
 *
 *   node tools/gallery.mjs
 */
import fs from 'node:fs'
import { chromium } from 'playwright-core'

const url = process.argv[2] ?? 'http://127.0.0.1:5173/'
const outDir = 'tools/screenshots'
const exe =
  process.env.CHROME_PATH ??
  `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe`

fs.mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const logs = []
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') logs.push(`[${msg.type()}] ${msg.text()}`)
})
page.on('pageerror', (error) => logs.push(`[pageerror] ${error.message}`))

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForSelector('canvas', { timeout: 60000 })
await page.waitForFunction(
  () => {
    const store = window.__viewer
    return store && store.getState().status === 'ready' && store.getState().volume
  },
  { timeout: 120000 },
)

const settle = async (ms = 2500) => {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  await page.waitForTimeout(ms)
}

// Deterministic, cheaper settings for the software rasterizer used in CI.
await page.evaluate(() => {
  const s = window.__viewer.getState()
  s.setAutoRotate(false)
  s.setSteps(128)
  s.setClip(1)
})
await settle()

const shot = async (name) => {
  await page.screenshot({ path: `${outDir}/${name}.png` })
  console.log('shot', name)
}

// 1) Default bone view
await shot('02-bone')

// 2) Presets
for (const preset of ['dental', 'mip', 'xray', 'heat', 'teal', 'soft']) {
  await page.evaluate((id) => {
    const s = window.__viewer.getState()
    s.setPreset(id)
    s.setSteps(128)
    s.setAutoRotate(false)
  }, preset)
  await page.waitForFunction(
    (id) => {
      const active = document.querySelector('.preset.is-active')
      return window.__viewer.getState().presetId === id && active && active.textContent.includes(
        { bone: 'Bone', dental: 'Dental', soft: 'Soft', mip: 'MIP', xray: 'X-ray', heat: 'Heat', teal: 'Teal' }[id],
      )
    },
    preset,
    { timeout: 20000 },
  )
  await settle(2200)
  await shot(`03-preset-${preset}`)
}
await page.evaluate(() => {
  const s = window.__viewer.getState()
  s.setPreset('bone')
  s.setSteps(128)
})

// 3) MPR interaction: click axial canvas, then scroll coronal.
const before = await page.evaluate(() => window.__viewer.getState().cursor)
const ax = await page.locator('.mpr-view .mpr-view__canvas').first().boundingBox()
if (ax) {
  await page.mouse.click(ax.x + ax.width * 0.3, ax.y + ax.height * 0.4)
}
const afterClick = await page.evaluate(() => window.__viewer.getState().cursor)
const coronal = await page.locator('.mpr-pair .mpr-view__canvas').first().boundingBox()
if (coronal) {
  await page.mouse.move(coronal.x + coronal.width / 2, coronal.y + coronal.height / 2)
  await page.mouse.wheel(0, 240)
}
const afterWheel = await page.evaluate(() => window.__viewer.getState().cursor)

// 4) UI checks
const ui = await page.evaluate(() => {
  const q = (sel) => document.querySelector(sel)
  const panels = [...document.querySelectorAll('.panel')].map((p) => ({
    cls: p.className,
    h: p.getBoundingClientRect().height,
    scrollH: p.querySelector('.panel__body')?.scrollHeight,
    clientH: p.querySelector('.panel__body')?.clientHeight,
  }))
  return {
    status: window.__viewer.getState().status,
    fps: window.__viewer.getState().fps,
    canvas: `${q('.mpr-view__canvas')?.getAttribute('width')  }x${  q('.mpr-view__canvas')?.getAttribute('height')}`,
    presets: document.querySelectorAll('.preset').length,
    windows: document.querySelectorAll('.chip').length,
    panels,
    loaderHidden: q('.loader')?.classList.contains('is-done'),
  }
})

// 5) Toggle panel + grid off to inspect clean 3D framing
await page.evaluate(() => {
  const s = window.__viewer.getState()
  s.toggleLeft()
  s.toggleRight()
  s.setShowGrid(false)
})
await settle(1600)
await shot('04-clean')

console.log(
  JSON.stringify(
    {
      cursor: { before, afterClick, afterWheel },
      ui,
      logs: logs.slice(0, 40),
    },
    null,
    2,
  ),
)
await browser.close()
