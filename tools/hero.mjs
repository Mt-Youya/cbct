/** Final hero screenshots for docs / the chat answer. */
import fs from 'node:fs'
import { chromium } from 'playwright-core'

const exe =
  process.env.CHROME_PATH ??
  `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe`
fs.mkdirSync('tools/screenshots', { recursive: true })
fs.mkdirSync('docs', { recursive: true })

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__viewer?.getState().status === 'ready', { timeout: 120000 })
await page.evaluate(() => {
  const s = window.__viewer.getState()
  s.setAutoRotate(false)
  s.setLang('zh')
})

const settle = async (ms = 3200) => {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  await page.waitForTimeout(ms)
}
const shot = async (name) => {
  await settle()
  await page.screenshot({ path: `tools/screenshots/${name}.png` })
  console.log('shot', name, '| fps', await page.evaluate(() => window.__viewer.getState().fps))
}

await shot('40-hero-bone')

// Slight manual orbit for a more three-quarter hero angle.
await page.mouse.move(800, 500)
await page.mouse.down()
await page.mouse.move(690, 470, { steps: 12 })
await page.mouse.up()
await settle(2200)
await shot('41-hero-orbit')

// Teeth-only arc view
await page.evaluate(() => window.__viewer.getState().setTeethOnly(true))
await settle(3200)
await shot('42-hero-teeth')
await page.evaluate(() => window.__viewer.getState().setTeethOnly(false))

// Teal look
await page.evaluate(() => window.__viewer.getState().setPreset('teal'))
await settle(2600)
await shot('43-hero-teal')

// Clean render, no panels, high sample count
await page.evaluate(() => {
  const s = window.__viewer.getState()
  s.setPreset('bone')
  s.toggleLeft()
  s.toggleRight()
  s.setShowGrid(false)
  s.setSteps(320)
})
await settle(4200)
await shot('44-hero-clean')

console.log('errors:', errors)
await browser.close()
