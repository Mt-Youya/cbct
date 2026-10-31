/**
 * Desktop QA for the CBCT viewer.
 * Covers: initial load / render / FPS / Chinese UI / 8 presets (items 1),
 * language toggle + persistence (item 2), teeth-only view (item 3),
 * preset cycle (item 5) and desktop panel overflow (item 8).
 *
 * Run from the repo root: node tools/qa/desktop.mjs
 */
import {
  BASE,
  ZH_LABELS,
  EN_LABELS,
  PRESET_IDS,
  trackConsole,
  getState,
  waitReady,
  waitFps,
  waitFrames,
  largestCanvas,
  pageLabelSource,
  setFast,
  shot,
  shotClip,
  layoutReport,
  imageStats,
  diffRatio,
  makeSuite,
  launchDesktop,
} from './lib.mjs'

const suite = makeSuite('desktop')
const { browser, page } = await launchDesktop()
const errors = trackConsole(page)
const screenshots = []

async function save(name, options) {
  const file = await shot(page, name, options)
  screenshots.push({ name, file })
  return file
}

function labelsPresent(source, labels) {
  return labels.filter((label) => !source.includes(label))
}

try {
  await waitReady(page)
  const fps = await waitFps(page)
  await waitFrames(page, 3)
  const state = await getState(page)
  suite.note('initial store state', {
    status: state.status,
    lang: state.lang,
    presetId: state.presetId,
    volumeDims: state.volumeDims,
    dental: state.dental ? 'present' : null,
    fps,
    langStorage: state.langStorage,
    docLang: state.docLang,
    innerWidth: state.innerWidth,
    bodyScrollWidth: state.bodyScrollWidth,
  })

  // ---------------------------------------------------------------- item 1
  suite.check('1.1', 'page reached ready state without error overlay', state.status === 'ready', { status: state.status })
  const canvasInfo = await largestCanvas(page)
  suite.check(
    '1.2',
    'WebGL volume canvas is present and sized',
    !!canvasInfo && canvasInfo.width > 300 && canvasInfo.height > 300,
    canvasInfo,
  )

  const initial = await shotClip(page, 'qa-desktop-initial-canvas.png', { x: 500, y: 210, width: 600, height: 560 })
  const initialStats = imageStats(initial)
  suite.check('1.3', 'canvas renders a skull-like volume (bright pixels present)', initialStats.brightCount > 2000, initialStats)
  await save('qa-desktop-zh-initial.png')

  const labelsZh = await pageLabelSource(page)
  const missingZh = labelsPresent(labelsZh, ZH_LABELS)
  suite.check('1.4', 'Chinese UI is the default (患者 / 多平面 / 只看牙齿 / 骨窗)', missingZh.length === 0, { missing: missingZh })

  const presetButtons = await page.locator('.preset').count()
  suite.check('1.5', '8 preset buttons are rendered', presetButtons === 8, { count: presetButtons })

  const fpsNow = await page.evaluate(() => window.__viewer.getState().fps)
  suite.check('1.6', 'FPS metric is reported (store + top bar)', fps > 0 && fpsNow > 0, { fps, fpsNow, softwareRendering: true })
  const topbarText = await page.evaluate(() => document.querySelector('header')?.innerText ?? '')
  suite.note('top bar text', topbarText.replace(/\s+/g, ' ').slice(0, 200))

  // panel overflow at desktop
  const desktopLayout = await layoutReport(page)
  const left = desktopLayout.panels.find((p) => p.cls.includes('panel--left'))
  const right = desktopLayout.panels.find((p) => p.cls.includes('panel--right'))
  suite.check(
    '8.1',
    'desktop left panel has no horizontally clipped controls',
    !!left &&
      left.clippedCount === 0 &&
      !!left.bodyScroll &&
      left.bodyScroll.scrollWidth <= left.bodyScroll.clientWidth + 1 &&
      left.insideViewport,
    left ? { clipped: left.clipped, bodyScroll: left.bodyScroll, open: left.isOpen, insideViewport: left.insideViewport } : null,
  )
  suite.check(
    '8.2',
    'desktop right (MPR) panel has no horizontally clipped controls',
    !!right &&
      right.clippedCount === 0 &&
      !!right.bodyScroll &&
      right.bodyScroll.scrollWidth <= right.bodyScroll.clientWidth + 1 &&
      right.insideViewport,
    right ? { clipped: right.clipped, bodyScroll: right.bodyScroll, open: right.isOpen, insideViewport: right.insideViewport } : null,
  )
  suite.check('8.3', 'no page-level horizontal overflow at 1600px', desktopLayout.bodyScrollWidth <= desktopLayout.viewport.width + 0.5, {
    bodyScrollWidth: desktopLayout.bodyScrollWidth,
    viewport: desktopLayout.viewport,
  })
  const leftScroll = left?.bodyScroll ?? null
  if (leftScroll && leftScroll.scrollHeight > leftScroll.clientHeight) {
    const scrolled = await page.evaluate(() => {
      const body = document.querySelector('.panel--left .panel__body')
      body.scrollTop = 40
      return body.scrollTop
    })
    suite.check('8.4', 'desktop left panel scrolls when content overflows', scrolled > 0, { scrollTop: scrolled, bodyScroll: leftScroll })
  } else {
    suite.note('desktop left panel does not need scrolling', leftScroll)
  }
  suite.check(
    '8.5',
    'desktop left panel content is fully visible (scrollHeight == clientHeight, no clipped controls)',
    !!leftScroll && leftScroll.scrollHeight === leftScroll.clientHeight && leftScroll.scrollWidth === leftScroll.clientWidth,
    leftScroll,
  )

  // ---------------------------------------------------------------- item 2
  const beforeLang = await getState(page)
  const langButton = page.locator('header button[aria-label*="切换语言"]')
  await langButton.click()
  await page.waitForTimeout(500)
  const enState = await getState(page)
  const labelsEn = await pageLabelSource(page)
  const missingEn = labelsPresent(labelsEn, EN_LABELS)
  const langButtonTextEn = (await langButton.innerText()).trim()
  suite.check(
    '2.1',
    'clicking EN switches UI to English',
    enState.lang === 'en' && missingEn.length === 0 && langButtonTextEn === '中文',
    { lang: enState.lang, missing: missingEn, languageButtonText: langButtonTextEn },
  )
  suite.check('2.1b', 'documentElement.lang updates to "en" with the language', enState.docLang === 'en', { docLang: enState.docLang })
  suite.check('2.2', 'localStorage cbct-lang is "en" after toggle', enState.langStorage === 'en', { stored: enState.langStorage })
  await save('qa-desktop-en.png')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__viewer?.getState?.().status === 'ready', undefined, { timeout: 180000, polling: 200 })
  await page.waitForTimeout(1500)
  await setFast(page)
  await waitFps(page)
  await waitFrames(page, 3)
  const reloadState = await getState(page)
  const labelsEnReload = await pageLabelSource(page)
  const missingEnReload = labelsPresent(labelsEnReload, EN_LABELS)
  await save('qa-desktop-en-reloaded.png')
  suite.check(
    '2.3',
    'English survives reload (store + UI + localStorage + documentElement.lang)',
    reloadState.lang === 'en' && reloadState.langStorage === 'en' && reloadState.docLang === 'en' && missingEnReload.length === 0,
    { lang: reloadState.lang, stored: reloadState.langStorage, docLang: reloadState.docLang, missing: missingEnReload },
  )
  await langButton.click()
  await page.waitForTimeout(500)
  const zhState = await getState(page)
  const labelsZhBack = await pageLabelSource(page)
  const missingZhBack = labelsPresent(labelsZhBack, ZH_LABELS)
  const langButtonTextZh = (await langButton.innerText()).trim()
  suite.check(
    '2.4',
    'clicking 中文 switches back to Chinese and persists',
    zhState.lang === 'zh' && zhState.langStorage === 'zh' && zhState.docLang === 'zh-CN' && missingZhBack.length === 0 && langButtonTextZh === 'EN',
    { lang: zhState.lang, stored: zhState.langStorage, docLang: zhState.docLang, missing: missingZhBack, languageButtonText: langButtonTextZh },
  )
  suite.note('documentElement.lang now tracks the language', {
    initial: beforeLang.docLang,
    english: enState.docLang,
    reload: reloadState.docLang,
    chinese: zhState.docLang,
  })

  // ---------------------------------------------------------------- item 3
  await page.evaluate(() => window.__viewer.getState().setPreset('bone'))
  await page.evaluate(() => window.__viewer.getState().setSteps(96))
  await waitFrames(page, 3)
  await page.waitForTimeout(300)
  const preTeethState = await getState(page)
  const boneShot = await shotClip(page, 'qa-teeth-baseline-bone.png', { x: 500, y: 210, width: 600, height: 560 })
  const boneStats = imageStats(boneShot)

  const toothButton = page.locator('header button[aria-label="只看牙齿"]')
  const toothTitle = await toothButton.getAttribute('title')
  const toothAria = await toothButton.getAttribute('aria-pressed')
  const toothA11yName = await toothButton.getAttribute('aria-label')
  suite.note('teeth toggle button', { ariaLabel: toothA11yName, title: toothTitle, ariaPressed: toothAria })
  suite.check(
    '3.0',
    'dental ROI loaded from public/data/dental.json (store.dental truthy)',
    !!preTeethState.dental && preTeethState.dental.version === 1 && Array.isArray(preTeethState.dental.voxelBox?.min),
    preTeethState.dental ? { version: preTeethState.dental.version, voxelBox: preTeethState.dental.voxelBox, method: preTeethState.dental.stats?.method } : null,
  )
  await toothButton.click()
  await waitFrames(page, 3)
  await page.waitForTimeout(300)
  const teethState = await getState(page)
  const teethShot = await shotClip(page, 'qa-teeth-only-canvas.png', { x: 500, y: 210, width: 600, height: 560 })
  const teethStats = imageStats(teethShot)
  const teethDiff = diffRatio(boneShot, teethShot, 14)
  const teethAriaAfter = await toothButton.getAttribute('aria-pressed')
  await save('qa-teeth-only-full.png')
  suite.check(
    '3.1',
    'teeth-only enabled: store teethOnly=true, presetId=teeth',
    teethState.teethOnly === true && teethState.presetId === 'teeth',
    { teethOnly: teethState.teethOnly, presetId: teethState.presetId, lastPreset: teethState.lastPreset, dental: teethState.dental ? 'present' : null },
  )
  suite.check('3.2', 'teeth-only button reflects pressed state', teethAriaAfter === 'true', { ariaPressed: teethAriaAfter })
  suite.check(
    '3.3',
    'teeth-only rendering differs from bone view (pixel diff ratio)',
    teethDiff.same && teethDiff.ratio > 0.05,
    { diffRatio: teethDiff, boneStats, teethStats },
  )
  await toothButton.click()
  await waitFrames(page, 2)
  const restored = await getState(page)
  suite.check(
    '3.4',
    'toggling teeth-only off restores the previous preset (bone)',
    restored.teethOnly === false && restored.presetId === 'bone',
    { teethOnly: restored.teethOnly, presetId: restored.presetId },
  )

  // ---------------------------------------------------------------- item 5
  const consoleErrorsBeforePresets = errors.consoleErrors.length
  // Baseline with volume contribution suppressed: same scene, opacity 0.
  await page.evaluate(() => {
    const s = window.__viewer.getState()
    s.setOpacity(0)
    s.setShowGrid(true)
    s.setShowBox(true)
  })
  await waitFrames(page, 3)
  const empty = await shotClip(page, 'qa-preset-empty-baseline.png', { x: 500, y: 210, width: 600, height: 560 })
  const emptyStats = imageStats(empty)
  suite.note('empty (opacity=0) canvas baseline', emptyStats)

  const presetResults = []
  for (const id of PRESET_IDS) {
    await page.evaluate((preset) => {
      const s = window.__viewer.getState()
      s.setPreset(preset)
      s.setSteps(96)
    }, id)
    await waitFrames(page, 2)
    const shotId = `qa-preset-${id}.png`
    const img = await shotClip(page, shotId, { x: 500, y: 210, width: 600, height: 560 })
    const stats = imageStats(img)
    const diff = diffRatio(empty, img, 12)
    const st = await getState(page)
    presetResults.push({ id, stats, diffVsEmpty: diff.ratio, presetId: st.presetId, teethOnly: st.teethOnly })
    screenshots.push({ name: shotId })
  }
  const notSwitched = presetResults.filter((r) => r.presetId !== r.id)
  suite.check('5.1', 'all 8 presets switch the store presetId', notSwitched.length === 0, { notSwitched })
  const notRendered = presetResults.filter((r) => !r.diffVsEmpty || r.diffVsEmpty < 0.03)
  suite.check(
    '5.2',
    'each preset produces a visible render (diff vs opacity=0 baseline > 3%)',
    notRendered.length === 0,
    { presetDiffs: presetResults.map((r) => ({ id: r.id, diff: r.diffVsEmpty, bright: r.stats.brightCount })) },
  )
  // representative full desktop screenshots
  for (const id of ['bone', 'mip', 'heat']) {
    await page.evaluate((preset) => {
      const s = window.__viewer.getState()
      s.setPreset(preset)
      s.setSteps(96)
    }, id)
    await waitFrames(page, 2)
    await save(`qa-presets-${id}.png`)
  }
  const afterPresetsCanvas = await largestCanvas(page)
  suite.check(
    '5.3',
    'canvas still alive after cycling presets (no WebGL context loss)',
    !!afterPresetsCanvas && afterPresetsCanvas.width > 300 && afterPresetsCanvas.height > 300,
    afterPresetsCanvas,
  )
  const presetConsoleErrors = errors.consoleErrors.slice(consoleErrorsBeforePresets)
  suite.check('5.4', 'no console errors during preset cycling', presetConsoleErrors.length === 0, { errors: presetConsoleErrors })

  // ---------------------------------------------------------------- console
  suite.check('C.1', 'no page (uncaught) errors during desktop run', errors.pageErrors.length === 0, { pageErrors: errors.pageErrors })
  suite.check('C.2', 'no console errors during desktop run', errors.consoleErrors.length === 0, { consoleErrors: errors.consoleErrors })
  suite.note('console warnings (informational only)', errors.consoleWarnings.slice(0, 8))

  const finalState = await getState(page)
  suite.note('final state', { lang: finalState.lang, presetId: finalState.presetId, fps: finalState.fps })

  suite.save({
    screenshots,
    consoleErrors: errors.consoleErrors,
    pageErrors: errors.pageErrors,
    consoleWarnings: errors.consoleWarnings,
    presetResults,
    layout: desktopLayout,
    url: BASE,
  })
} catch (error) {
  suite.check('FATAL', 'desktop suite completed without throwing', false, { message: String(error?.stack ?? error) })
  suite.save({ screenshots, consoleErrors: errors.consoleErrors, pageErrors: errors.pageErrors, fatal: String(error?.stack ?? error) })
  process.exitCode = 1
} finally {
  await browser.close()
}
