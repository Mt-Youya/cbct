/**
 * MPR panel QA (item 4): axial canvas sizing, click-to-move cursor, wheel on
 * coronal changes cursor.y, window chips update the WW/WC readout, screenshot.
 *
 * Run from the repo root: node tools/qa/mpr.mjs
 */
import {
  trackConsole,
  getState,
  waitReady,
  setFast,
  shot,
  makeSuite,
  launchDesktop,
} from './lib.mjs'

const suite = makeSuite('mpr')
const { browser, page } = await launchDesktop()
const errors = trackConsole(page)
const screenshots = []

async function save(name, options) {
  const file = await shot(page, name, options)
  screenshots.push({ name, file })
  return file
}

try {
  await waitReady(page)
  await setFast(page)

  // Make sure the right (MPR) panel is open without relying on animation timing.
  await page.evaluate(() => {
    const s = window.__viewer.getState()
    if (!s.rightOpen) s.toggleRight()
    if (!s.leftOpen) s.toggleLeft()
  })
  await page.waitForTimeout(700)
  const opened = await getState(page)
  suite.check('4.0', 'MPR panel open with volume ready', opened.rightOpen === true && opened.status === 'ready', {
    rightOpen: opened.rightOpen,
    status: opened.status,
  })

  const canopy = await page.evaluate(() => {
    const views = Array.from(document.querySelectorAll('.mpr-view'))
    return views.map((view, index) => {
      const canvas = view.querySelector('canvas')
      const r = view.getBoundingClientRect()
      const box = canvas.getBoundingClientRect()
      return {
        index,
        compact: view.classList.contains('mpr-view--compact'),
        title: view.querySelector('.mpr-view__title')?.textContent ?? '',
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        display: { width: +box.width.toFixed(1), height: +box.height.toFixed(1) },
        view: { top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), height: +r.height.toFixed(1) },
      }
    })
  })
  suite.note('MPR views', canopy)
  suite.check(
    '4.1',
    'axial MPR canvas is 320x320 (volume dims)',
    canopy.length === 3 && canopy[0].canvasWidth === 320 && canopy[0].canvasHeight === 320 && !canopy[0].compact,
    canopy[0],
  )

  // ---- click on axial canvas at 30% / 40% ---------------------------------
  const axial = page.locator('.mpr-view:not(.mpr-view--compact) canvas').first()
  const axialBox = await axial.boundingBox()
  suite.note('axial canvas box', axialBox)
  const beforeClick = await getState(page)
  await axial.click({ position: { x: axialBox.width * 0.3, y: axialBox.height * 0.4 } })
  await page.waitForTimeout(350)
  const afterClick = await getState(page)
  const expected = { x: Math.floor(0.3 * 320), y: Math.floor(0.4 * 320) }
  suite.check(
    '4.2',
    'clicking axial at 30%/40% moves voxel cursor to (~96, ~128)',
    Math.abs(afterClick.cursor.x - expected.x) <= 2 && Math.abs(afterClick.cursor.y - expected.y) <= 2,
    { before: beforeClick.cursor, after: afterClick.cursor, expected },
  )

  const readoutAfterClick = await page.evaluate(() => {
    const readings = Array.from(document.querySelectorAll('.mpr-view__readout')).map((el) => el.textContent.replace(/\s+/g, ' ').trim())
    const cursor = document.querySelector('.mpr__cursor')?.textContent.replace(/\s+/g, ' ').trim()
    return { readings, cursor }
  })
  suite.note('MPR slice readouts after click', readoutAfterClick)

  // ---- wheel over coronal changes cursor.y --------------------------------
  const coronalView = page.locator('.mpr-view--compact').first()
  const coronalCanvas = coronalView.locator('canvas')
  const coronalBox = await coronalCanvas.boundingBox()
  await page.mouse.move(coronalBox.x + coronalBox.width / 2, coronalBox.y + coronalBox.height / 2)
  const beforeWheel = await getState(page)
  await page.mouse.wheel(0, 120)
  await page.waitForTimeout(350)
  const afterWheelDown = await getState(page)
  await page.mouse.wheel(0, -120)
  await page.waitForTimeout(350)
  const afterWheelUp = await getState(page)
  suite.check(
    '4.3',
    'wheel over coronal changes cursor.y by +/-1',
    afterWheelDown.cursor.y === beforeWheel.cursor.y + 1 && afterWheelUp.cursor.y === beforeWheel.cursor.y,
    { before: beforeWheel.cursor, wheelDown: afterWheelDown.cursor, wheelUp: afterWheelUp.cursor },
  )
  suite.note('scroll of panel body was prevented by canvas wheel handler', { bodyScrollTop: await page.evaluate(() => document.querySelector('.panel--right .panel__body').scrollTop) })

  // ---- window chips -> WW/WC readout --------------------------------------
  const chipCount = await page.locator('.mpr .chip').count()
  const readoutText = () => page.evaluate(() => document.querySelector('.mpr__window-readout')?.innerText.replace(/\s+/g, ' ').trim() ?? '')
  const initialReadout = await readoutText()
  const softLabel = await page.locator('.mpr .chip', { hasText: '软组织' }).innerText()
  await page.locator('.mpr .chip', { hasText: '软组织' }).click()
  await page.waitForTimeout(350)
  const softReadout = await readoutText()
  const softState = await getState(page)
  await page.locator('.mpr .chip', { hasText: '牙科' }).click()
  await page.waitForTimeout(350)
  const dentalReadout = await readoutText()
  const dentalState = await getState(page)
  const activeChips = await page.locator('.mpr .chip.is-active').count()
  suite.check(
    '4.4',
    'window chips update WW/WC readout (软组织 => 500/50, 牙科 => 3600/900)',
    chipCount === 4 &&
      softState.windowWidth === 500 &&
      softState.windowCenter === 50 &&
      /WW 500/.test(softReadout) &&
      /WC 50\b/.test(softReadout) &&
      dentalState.windowWidth === 3600 &&
      dentalState.windowCenter === 900 &&
      /WW 3600/.test(dentalReadout) &&
      /WC 900/.test(dentalReadout) &&
      activeChips === 1,
    { chipCount, softLabel, initialReadout, softReadout, dentalReadout, activeChips },
  )

  await save('qa-mpr-full.png')
  const panelFile = await page.locator('.panel--right').screenshot({ path: 'tools/screenshots/qa-mpr-panel.png', timeout: 120000 })
  screenshots.push({ name: 'qa-mpr-panel.png', file: 'tools/screenshots/qa-mpr-panel.png' })
  suite.note('MPR panel screenshot', panelFile.length)

  // sanity: MPR canvases actually contain image data (not blank)
  const canvasInk = await page.evaluate(() => {
    const results = []
    for (const canvas of document.querySelectorAll('.mpr-view__canvas')) {
      const ctx = canvas.getContext('2d')
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      let bright = 0
      for (let i = 0; i < data.length; i += 4) if (data[i] > 40) bright++
      results.push({ width: canvas.width, height: canvas.height, brightPixels: bright })
    }
    return results
  })
  suite.check('4.5', 'all three MPR slices contain rendered pixels', canvasInk.length === 3 && canvasInk.every((c) => c.brightPixels > 500), canvasInk)

  // ---- console ------------------------------------------------------------
  suite.check('C.1', 'no page errors during MPR interactions', errors.pageErrors.length === 0, { pageErrors: errors.pageErrors })
  suite.check('C.2', 'no console errors during MPR interactions', errors.consoleErrors.length === 0, { consoleErrors: errors.consoleErrors })

  suite.save({
    screenshots,
    consoleErrors: errors.consoleErrors,
    pageErrors: errors.pageErrors,
    consoleWarnings: errors.consoleWarnings,
    canopy,
    readoutAfterClick,
    wheel: { before: beforeWheel.cursor, afterDown: afterWheelDown.cursor, afterUp: afterWheelUp.cursor },
    windows: { initialReadout, softReadout, dentalReadout },
  })
} catch (error) {
  suite.check('FATAL', 'MPR suite completed without throwing', false, { message: String(error?.stack ?? error) })
  suite.save({ screenshots, consoleErrors: errors.consoleErrors, pageErrors: errors.pageErrors, fatal: String(error?.stack ?? error) })
  process.exitCode = 1
} finally {
  await browser.close()
}
