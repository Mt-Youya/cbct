/** Responsive smoke test: mobile layout and panel toggles. */
import fs from 'node:fs'
import { chromium } from 'playwright-core'

const exe =
  process.env.CHROME_PATH ??
  `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe`
fs.mkdirSync('tools/screenshots', { recursive: true })

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__viewer?.getState().status === 'ready', { timeout: 120000 })
await page.evaluate(() => {
  const s = window.__viewer.getState()
  s.setAutoRotate(false)
  s.setSteps(96)
})
const settle = async () => {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  await page.waitForTimeout(1800)
}
await settle()
await page.screenshot({ path: 'tools/screenshots/07-mobile-initial.png' })
const initial = await page.evaluate(() => ({
  left: window.__viewer.getState().leftOpen,
  right: window.__viewer.getState().rightOpen,
  bodyScroll: [document.body.scrollWidth, document.body.clientWidth],
}))

await page.getByRole('button', { name: 'Patient' }).click()
await settle()
await page.screenshot({ path: 'tools/screenshots/08-mobile-patient.png' })
const afterPatient = await page.evaluate(() => ({
  left: window.__viewer.getState().leftOpen,
  right: window.__viewer.getState().rightOpen,
  panelH: document.querySelector('.panel--left')?.getBoundingClientRect().height,
  scrollH: document.querySelector('.panel--left .panel__body')?.scrollHeight,
  clientH: document.querySelector('.panel--left .panel__body')?.clientHeight,
}))

await page.getByRole('button', { name: 'MPR' }).click()
await settle()
await page.screenshot({ path: 'tools/screenshots/09-mobile-mpr.png' })
const afterMpr = await page.evaluate(() => ({
  left: window.__viewer.getState().leftOpen,
  right: window.__viewer.getState().rightOpen,
  bodyScroll: [document.body.scrollWidth, document.body.clientWidth],
}))

console.log(JSON.stringify({ initial, afterPatient, afterMpr, errors }, null, 2))
await browser.close()
