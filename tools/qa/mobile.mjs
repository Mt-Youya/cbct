/**
 * Mobile QA (item 6): 390x844 @2x touch device.
 * Panels start closed, top bar fits without horizontal overflow, panel toggles
 * are mutually exclusive, panels do not clip controls horizontally.
 *
 * Run from the repo root: node tools/qa/mobile.mjs
 */
import { chromium } from 'playwright-core'
import {
  BASE,
  CHROME,
  trackConsole,
  getState,
  waitReady,
  waitFps,
  waitFrames,
  setFast,
  shot,
  layoutReport,
  makeSuite,
} from './lib.mjs'

const MOBILE = { width: 390, height: 844 }
const suite = makeSuite('mobile')
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const context = await browser.newContext({
  viewport: MOBILE,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
})
const page = await context.newPage()
const errors = trackConsole(page)
const screenshots = []

async function save(name, options) {
  const file = await shot(page, name, options)
  screenshots.push({ name, file })
  return file
}

function pickPanel(layout, needle) {
  return layout.panels.find((p) => p.cls.includes(needle)) ?? null
}

try {
  await waitReady(page)
  const fps = await waitFps(page)
  await setFast(page)
  await waitFrames(page, 2)
  await page.waitForTimeout(1200) // panel transition + a couple of frames

  const initial = await getState(page)
  await save('qa-mobile-initial.png')
  const layout0 = await layoutReport(page)
  const left0 = pickPanel(layout0, 'panel--left')
  const right0 = pickPanel(layout0, 'panel--right')
  suite.note('mobile initial state', {
    viewport: layout0.viewport,
    innerWidth: initial.innerWidth,
    bodyScrollWidth: layout0.bodyScrollWidth,
    docScrollWidth: layout0.docScrollWidth,
    leftOpen: initial.leftOpen,
    rightOpen: initial.rightOpen,
    fps,
    designWidth: MOBILE,
  })

  // ---------------------------------------------------------------- item 6
  suite.check(
    '6.1',
    'overlay panels start closed on mobile (store + CSS visibility)',
    initial.leftOpen === false && initial.rightOpen === false && left0?.isOpen === false && right0?.isOpen === false,
    { leftOpen: initial.leftOpen, rightOpen: initial.rightOpen, leftClass: left0?.cls, rightClass: right0?.cls },
  )
  const panelVisibility = await page.evaluate(() => {
    const out = {}
    for (const needle of ['panel--left', 'panel--right']) {
      const el = document.querySelector(`.panel.${needle}`)
      const s = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      out[needle] = { visibility: s.visibility, opacity: s.opacity, pointerEvents: s.pointerEvents, width: +r.width.toFixed(1), display: s.display }
    }
    return out
  })
  suite.check(
    '6.2',
    'closed panels are actually hidden (visibility:hidden, opacity 0)',
    panelVisibility['panel--left']?.visibility === 'hidden' && panelVisibility['panel--right']?.visibility === 'hidden',
    panelVisibility,
  )

  const brandInfo = await page.evaluate(() => {
    const header = document.querySelector('header')
    const mark = header?.querySelector('[aria-label="CBCT Volume Lab"]')
    const visible = (el) => {
      if (!el) return false
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return r.width > 8 && r.height > 8 && s.visibility !== 'hidden' && Number(s.opacity) > 0.01
    }
    const brandTitle = header?.querySelector('.max-\\[620px\\]\\:hidden')
    return {
      markVisible: visible(mark),
      markLabel: mark?.getAttribute('aria-label') ?? null,
      brandTitleDisplay: brandTitle ? getComputedStyle(brandTitle).display : null,
      headerInnerText: header?.innerText.replace(/\s+/g, ' ').trim() ?? '',
      buttonNames: Array.from(header?.querySelectorAll('button') ?? []).map((b) => ({
        ariaLabel: b.getAttribute('aria-label'),
        text: (b.textContent ?? '').trim(),
        pressed: b.getAttribute('aria-pressed'),
        title: b.getAttribute('title'),
      })),
    }
  })
  const ariaLabels = brandInfo.buttonNames.map((b) => b.ariaLabel)
  suite.note('top bar accessible names on mobile', brandInfo)
  suite.check(
    '6.3',
    'top bar shows brand logo + tooth toggle + language toggle + 患者/多平面 panel toggles',
    brandInfo.markVisible &&
      brandInfo.markLabel === 'CBCT Volume Lab' &&
      brandInfo.buttonNames.some((b) => b.ariaLabel === '只看牙齿' && b.title?.includes('牙弓')) &&
      brandInfo.buttonNames.some((b) => b.text === 'EN') &&
      ariaLabels.includes('患者') &&
      ariaLabels.includes('多平面'),
    {
      markVisible: brandInfo.markVisible,
      markLabel: brandInfo.markLabel,
      buttonNames: brandInfo.buttonNames,
      brandTitleHiddenByDesign: brandInfo.brandTitleDisplay,
      innerText: brandInfo.headerInnerText,
    },
  )
  suite.check(
    '6.3b',
    'brand title text is hidden below 620px by design (logo mark only)',
    brandInfo.brandTitleDisplay === 'none' || brandInfo.brandTitleDisplay === null,
    { brandTitleDisplay: brandInfo.brandTitleDisplay },
  )
  suite.check(
    '6.3c',
    'every header button exposes an accessible name',
    brandInfo.buttonNames.length === 4 && brandInfo.buttonNames.every((b) => !!b.ariaLabel || !!(b.text && b.text.length > 0)),
    { buttonNames: brandInfo.buttonNames },
  )
  suite.check(
    '6.4',
    'no horizontal overflow: body.scrollWidth <= innerWidth (390)',
    layout0.bodyScrollWidth <= layout0.viewport.width + 0.5 && layout0.docScrollWidth <= layout0.viewport.width + 0.5,
    {
      bodyScrollWidth: layout0.bodyScrollWidth,
      docScrollWidth: layout0.docScrollWidth,
      viewport: layout0.viewport,
    },
  )
  suite.check(
    '6.5',
    'all top bar buttons fully inside the viewport',
    layout0.buttonsOutsideViewport.length === 0,
    { outside: layout0.buttonsOutsideViewport.map((b) => ({ label: b.label, left: b.left, right: b.right })) },
  )
  const headerOverlap = (() => {
    const [brandGroup, actions] = layout0.headerGroups
    if (!brandGroup || !actions) return { ok: false, reason: 'missing header groups' }
    return { ok: brandGroup.right <= actions.left + 0.5 && actions.right <= layout0.viewport.width + 0.5, brandRight: brandGroup.right, actionsLeft: actions.left, actionsRight: actions.right }
  })()
  suite.check('6.6', 'brand and top bar action groups do not overlap', headerOverlap.ok, headerOverlap)

  // ------------------------------------------------- open 患者 then 多平面
  await page.locator('header button[aria-label="患者"]').click()
  await page.waitForTimeout(650)
  const patientState = await getState(page)
  const layoutPatient = await layoutReport(page)
  const leftPatient = pickPanel(layoutPatient, 'panel--left')
  const rightPatient = pickPanel(layoutPatient, 'panel--right')
  await save('qa-mobile-patient.png')
  suite.check(
    '6.7',
    'tapping 患者 opens only the left panel',
    patientState.leftOpen === true && patientState.rightOpen === false && leftPatient?.isOpen === true,
    { leftOpen: patientState.leftOpen, rightOpen: patientState.rightOpen, leftVisibility: leftPatient?.cls },
  )
  suite.check(
    '6.8',
    'left panel fits and has no horizontally clipped controls',
    !!leftPatient &&
      leftPatient.insideViewport &&
      leftPatient.clippedCount === 0 &&
      !!leftPatient.bodyScroll &&
      leftPatient.bodyScroll.scrollWidth <= leftPatient.bodyScroll.clientWidth + 1,
    leftPatient ? { panel: leftPatient.panel, clipped: leftPatient.clipped, bodyScroll: leftPatient.bodyScroll } : null,
  )

  const leftScrollTest = await page.evaluate(() => {
    const body = document.querySelector('.panel--left .panel__body')
    if (!body) return null
    const info = { clientHeight: body.clientHeight, scrollHeight: body.scrollHeight, overflowY: getComputedStyle(body).overflowY }
    body.scrollTop = body.scrollHeight
    info.afterScrollTop = body.scrollTop
    info.maxScroll = body.scrollHeight - body.clientHeight
    const last = body.lastElementChild
    const bodyRect = body.getBoundingClientRect()
    const lastRect = last.getBoundingClientRect()
    info.lastControl = { text: (last.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40), top: +lastRect.top.toFixed(1), bottom: +lastRect.bottom.toFixed(1), bodyBottom: +bodyRect.bottom.toFixed(1) }
    info.lastReachable = lastRect.bottom <= bodyRect.bottom + 1 && lastRect.top >= bodyRect.top - 1
    return info
  })
  suite.note('left panel scroll test', leftScrollTest)
  if (leftScrollTest && leftScrollTest.maxScroll > 0) {
    suite.check(
      '6.9',
      'left panel body scrolls to reach the last controls',
      leftScrollTest.afterScrollTop > 0 && leftScrollTest.lastReachable,
      leftScrollTest,
    )
  } else {
    suite.check('6.9', 'left panel content fits without scrolling', true, leftScrollTest)
  }
  await page.evaluate(() => document.querySelector('.panel--left .panel__body').scrollTo({ top: 0 }))
  // scroll the panel screenshot area for a bottom-of-panel capture if it scrolls
  if (leftScrollTest && leftScrollTest.maxScroll > 0) {
    await page.evaluate(() => document.querySelector('.panel--left .panel__body').scrollTo({ top: 99999 }))
    await page.waitForTimeout(300)
    await save('qa-mobile-patient-scrolled.png')
    await page.evaluate(() => document.querySelector('.panel--left .panel__body').scrollTo({ top: 0 }))
  }

  // open 多平面 -> left must close (mutual exclusion)
  await page.locator('header button[aria-label="多平面"]').click()
  await page.waitForTimeout(700)
  const mprState = await getState(page)
  const layoutMpr = await layoutReport(page)
  const leftMpr = pickPanel(layoutMpr, 'panel--left')
  const rightMpr = pickPanel(layoutMpr, 'panel--right')
  await save('qa-mobile-mpr.png')
  suite.check(
    '6.10',
    'opening 多平面 closes 患者 (panels mutually exclusive)',
    mprState.rightOpen === true && mprState.leftOpen === false && rightMpr?.isOpen === true && leftMpr?.isOpen === false,
    { leftOpen: mprState.leftOpen, rightOpen: mprState.rightOpen, leftClass: leftMpr?.cls, rightClass: rightMpr?.cls },
  )
  suite.check(
    '6.11',
    'right (MPR) panel fits and has no horizontally clipped controls',
    !!rightMpr &&
      rightMpr.insideViewport &&
      rightMpr.clippedCount === 0 &&
      !!rightMpr.bodyScroll &&
      rightMpr.bodyScroll.scrollWidth <= rightMpr.bodyScroll.clientWidth + 1,
    rightMpr ? { panel: rightMpr.panel, clipped: rightMpr.clipped, bodyScroll: rightMpr.bodyScroll } : null,
  )
  const mprCanvasSizes = await page.evaluate(() => Array.from(document.querySelectorAll('.mpr-view__canvas')).map((c) => ({ width: c.width, height: c.height, displayWidth: +c.getBoundingClientRect().width.toFixed(1) })))
  suite.note('mobile MPR canvas sizes', mprCanvasSizes)
  const noBodyOverflowAfter = await page.evaluate(() => ({ body: document.body.scrollWidth, doc: document.documentElement.scrollWidth, inner: window.innerWidth }))
  suite.check(
    '6.12',
    'no horizontal overflow while a panel is open',
    noBodyOverflowAfter.body <= noBodyOverflowAfter.inner + 0.5 && noBodyOverflowAfter.doc <= noBodyOverflowAfter.inner + 0.5,
    noBodyOverflowAfter,
  )
  // panel body scroll for MPR
  const mprScroll = await page.evaluate(() => {
    const body = document.querySelector('.panel--right .panel__body')
    const info = { clientHeight: body.clientHeight, scrollHeight: body.scrollHeight, overflowY: getComputedStyle(body).overflowY }
    body.scrollTop = body.scrollHeight
    info.afterScrollTop = body.scrollTop
    info.maxScroll = info.scrollHeight - info.clientHeight
    info.atBottom = body.scrollTop >= info.maxScroll - 1
    // The scroll content is one big .mpr block, so check the last real control.
    const cursor = document.querySelector('.mpr__cursor')
    if (cursor) {
      const bodyRect = body.getBoundingClientRect()
      const cursorRect = cursor.getBoundingClientRect()
      info.lastControl = {
        top: +cursorRect.top.toFixed(1),
        bottom: +cursorRect.bottom.toFixed(1),
        bodyTop: +bodyRect.top.toFixed(1),
        bodyBottom: +bodyRect.bottom.toFixed(1),
      }
      info.lastControlVisible = cursorRect.bottom <= bodyRect.bottom + 1 && cursorRect.top >= bodyRect.top - 1
    }
    return info
  })
  suite.note('right panel scroll test', mprScroll)
  if (mprScroll.scrollHeight > mprScroll.clientHeight) {
    suite.check('6.13', 'MPR panel body scrolls to reach the last controls', mprScroll.atBottom && mprScroll.lastControlVisible === true, mprScroll)
  } else {
    suite.check('6.13', 'MPR panel content fits without scrolling', true, mprScroll)
  }

  // console
  suite.check('6.14', 'documentElement.lang is zh-CN on the Chinese mobile UI', initial.docLang === 'zh-CN', { docLang: initial.docLang })
  suite.check('C.1', 'no page errors during mobile run', errors.pageErrors.length === 0, { pageErrors: errors.pageErrors })
  suite.check('C.2', 'no console errors during mobile run', errors.consoleErrors.length === 0, { consoleErrors: errors.consoleErrors })

  suite.save({
    screenshots,
    consoleErrors: errors.consoleErrors,
    pageErrors: errors.pageErrors,
    consoleWarnings: errors.consoleWarnings,
    initialLayout: layout0,
    patientLayout: layoutPatient,
    mprLayout: layoutMpr,
    panelVisibility,
    leftScrollTest,
    mprScroll,
    mprCanvasSizes,
    url: BASE,
  })
} catch (error) {
  suite.check('FATAL', 'mobile suite completed without throwing', false, { message: String(error?.stack ?? error) })
  suite.save({ screenshots, consoleErrors: errors.consoleErrors, pageErrors: errors.pageErrors, fatal: String(error?.stack ?? error) })
  process.exitCode = 1
} finally {
  await context.close()
  await browser.close()
}
