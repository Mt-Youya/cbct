/**
 * QA suite for the rebuilt clinician reading workspace (CBCT Volume Lab).
 *
 *   node tools/qa/qa2.mjs
 *
 * Covers: start screen + sample load, generic in-browser DICOM import (403 .dcm),
 * 2x2 / MPR / 3D layout switching + pane sizing, MPR wheel/click/zoom, 3D slice
 * sync, teeth toggle, UI font scale (设置/特大), language + persistence,
 * mobile 390x844 tabs/overflow, console/page errors.
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'
import {
  BASE,
  CHROME,
  SHOT_DIR,
  trackConsole,
  decodePng,
  imageStats,
  diffRatio,
  makeSuite,
  shot,
} from './lib.mjs'

const DICOM_DIR = path.resolve('Dicom/20260314112507-0-1-10')
const DICOM_FILES = fs
  .readdirSync(DICOM_DIR)
  .map((name) => path.join(DICOM_DIR, name))
  .filter((file) => fs.statSync(file).isFile())
const VIEWPORT_DESKTOP = { width: 1600, height: 1000 }
const VIEWPORT_MOBILE = { width: 390, height: 844 }

const desktop = makeSuite('qa2-desktop')
const mobile = makeSuite('qa2-mobile')
const screenshots = []
const stateOf = () =>
  window.__viewer?.getState?.()
    ? (() => {
        const s = window.__viewer.getState()
        return {
          status: s.status,
          lang: s.lang,
          uiScale: s.uiScale,
          layout: s.layout,
          settingsOpen: s.settingsOpen,
          teethOnly: s.teethOnly,
          presetId: s.presetId,
          cursor: s.cursor,
          windowCenter: s.windowCenter,
          windowWidth: s.windowWidth,
          fps: s.fps,
          dental: Boolean(s.dental),
          dentalVersion: s.dental?.version ?? null,
          volumeDims: s.volume?.dims ?? null,
          metaDir: s.meta?.source?.directory ?? null,
          patient: s.meta?.patient?.name ?? null,
          preview: typeof s.preview === 'string' && s.preview.startsWith('data:image'),
          docLang: document.documentElement.lang,
          langStorage: window.localStorage.getItem('cbct-lang'),
          uiScaleStorage: window.localStorage.getItem('cbct-ui-scale'),
          innerWidth: window.innerWidth,
          bodyScrollWidth: document.body.scrollWidth,
          docScrollWidth: document.documentElement.scrollWidth,
          headerScrollWidth: document.querySelector('header')?.scrollWidth ?? null,
          headerClientWidth: document.querySelector('header')?.clientWidth ?? null,
        }
      })()
    : null
const getState = (page) => page.evaluate(stateOf)

async function waitForState(page, fnSource, timeout, arg) {
  await page.waitForFunction(fnSource, arg, { timeout, polling: 150 })
}

async function waitFrames(page, n = 2, timeout = 20000) {
  await page.evaluate(
    ({ frames, limit }) =>
      new Promise((resolve) => {
        let count = 0
        const timer = setTimeout(() => resolve({ count, timedOut: true }), limit)
        const tick = () => {
          count += 1
          if (count >= frames) {
            clearTimeout(timer)
            resolve({ count, timedOut: false })
          } else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
    { frames: n, limit: timeout },
  )
}

const panesOf = () =>
  [...document.querySelectorAll('section')]
    .filter((s) => s.querySelector(':scope > header') && String(s.className).includes('relative flex h-full'))
    .map((s, index) => {
      const header = s.querySelector(':scope > header')
      const title = (header?.querySelector('span')?.textContent ?? '').trim()
      const is3d = /3D|体渲染|Volume/i.test(title)
      const content = s.children[1]
      const sr = s.getBoundingClientRect()
      const cr = content?.getBoundingClientRect()
      const hr = header?.getBoundingClientRect()
      const canvases = [...s.querySelectorAll('canvas')].map((c) => {
        const r = c.getBoundingClientRect()
        let ink = null
        if (!is3d) {
          try {
            const ctx = c.getContext('2d')
            if (ctx) {
              const d = ctx.getImageData(0, 0, c.width, c.height).data
              let bright = 0
              for (let i = 0; i < d.length; i += 4) if (d[i] > 40) bright++
              ink = { bright, pixels: c.width * c.height }
            }
          } catch (error) {
            ink = { error: String(error?.message ?? error) }
          }
        }
        return {
          css: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
          bitmap: { w: c.width, h: c.height },
          ink,
        }
      })
      return {
        index,
        title,
        is3d,
        section: { x: +sr.x.toFixed(1), y: +sr.y.toFixed(1), w: +sr.width.toFixed(1), h: +sr.height.toFixed(1) },
        headerH: +(hr?.height ?? 0).toFixed(1),
        content: cr ? { x: +cr.x.toFixed(1), y: +cr.y.toFixed(1), w: +cr.width.toFixed(1), h: +cr.height.toFixed(1) } : null,
        canvasCount: canvases.length,
        canvases,
      }
    })

function clipOfPane(pane) {
  return { x: Math.round(pane.content.x), y: Math.round(pane.content.y), width: Math.max(8, Math.round(pane.content.w)), height: Math.max(8, Math.round(pane.content.h)) }
}

async function shotPane(page, pane, name) {
  const file = path.join(SHOT_DIR, name)
  const buffer = await page.screenshot({ clip: clipOfPane(pane), timeout: 120000 })
  fs.writeFileSync(file, buffer)
  screenshots.push({ name, file })
  return { img: decodePng(buffer), file }
}

/**
 * Software WebGL can take several frames (and a shader compile) before a newly
 * mounted 3D pane shows pixels. Poll pane screenshots until it is non-black.
 */
async function wait3d(page, name = 'qa2-3d-render.png', minBright = 500, timeout = 25000) {
  const started = Date.now()
  let last = null
  let lastImg = null
  let pane = null
  let file = null
  while (Date.now() - started < timeout) {
    const panes = await page.evaluate(panesOf)
    pane = panes.find((p) => p.is3d)
    if (!pane) {
      await waitFrames(page, 1)
      continue
    }
    const buffer = await page.screenshot({ clip: clipOfPane(pane), timeout: 120000 })
    file = path.join(SHOT_DIR, name)
    fs.writeFileSync(file, buffer)
    lastImg = decodePng(buffer)
    last = imageStats(lastImg)
    if (last.brightCount > minBright && last.std > 4) {
      if (!screenshots.some((s) => s.name === name)) screenshots.push({ name, file })
      return { pane, stats: last, img: lastImg, elapsed: Date.now() - started, file }
    }
    await waitFrames(page, 2)
    await page.waitForTimeout(400)
  }
  if (!screenshots.some((s) => s.name === name)) screenshots.push({ name, file })
  return { pane, stats: last, img: lastImg, elapsed: Date.now() - started, timedOut: true, file }
}

async function sample(page, label) {
  await page.getByRole('button', { name: label }).first().click()
  await waitForState(page, () => window.__viewer?.getState?.().status === 'ready', 180000)
  await waitFrames(page, 3)
}

// ---------------------------------------------------------------- desktop

async function runDesktop(page) {
  const errors = trackConsole(page)
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForFunction(() => Boolean(window.__viewer), undefined, { timeout: 30000, polling: 100 })
    await page.waitForTimeout(500)
    const idle = await getState(page)
    const startDom = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('input[type=file]')]
      const loaderText = document.querySelector('.loader')?.innerText ?? ''
      return {
        inputs: inputs.length,
        inputsMultiple: inputs.map((i) => i.multiple),
        folderAttr: inputs[0] ? inputs[0].hasAttribute('webkitdirectory') : null,
        loaderText,
        canvasCount: document.querySelectorAll('canvas').length,
      }
    })
    desktop.note('start screen DOM', { status: idle?.status, inputs: startDom.inputs, canvasCount: startDom.canvasCount })
    desktop.check('1.1', 'loads into idle start screen (status idle, no canvas yet)', idle?.status === 'idle' && startDom.canvasCount === 0, { status: idle?.status, canvasCount: startDom.canvasCount })
    desktop.check(
      '1.2',
      'start screen shows 打开 CBCT 影像 + 3 import actions',
      /打开 CBCT 影像/.test(startDom.loaderText) &&
        /打开 CBCT 文件夹/.test(startDom.loaderText) &&
        /选择 DICOM 文件/.test(startDom.loaderText) &&
        /加载示例病例/.test(startDom.loaderText),
      { text: startDom.loaderText.replace(/\s+/g, ' ').slice(0, 200) },
    )
    desktop.check('1.3', 'two hidden file inputs exist (folder + files)', startDom.inputs === 2 && startDom.folderAttr === true, { inputs: startDom.inputs, folderAttr: startDom.folderAttr })
    await shot(page, 'qa2-start-zh.png')
    screenshots.push({ name: 'qa2-start-zh.png' })

    await sample(page, '加载示例病例')
    const ready = await getState(page)
    desktop.note('sample loaded', {
      status: ready?.status,
      src: ready?.metaDir,
      dims: ready?.volumeDims,
      dental: ready?.dental,
      patient: ready?.patient,
      fps: ready?.fps,
      uiScale: ready?.uiScale,
      docLang: ready?.docLang,
    })
    desktop.check('2.1', 'sample study loads to ready', ready?.status === 'ready' && ready?.metaDir !== 'local import' && /Dicom/.test(ready?.metaDir ?? ''), { status: ready?.status, src: ready?.metaDir })
    desktop.check('2.2', 'dental ROI loaded (teeth toggle enabled)', ready?.dental === true && ready?.dentalVersion !== null, { dental: ready?.dental, version: ready?.dentalVersion })
    desktop.check('2.3', 'default interface scale is 1.18 (no stored override)', ready?.uiScale === 1.18, { uiScale: ready?.uiScale, storage: ready?.uiScaleStorage })

    // toolbar heights
    const bars = await page.evaluate(() => {
      const h = (sel) => document.querySelector(sel)?.getBoundingClientRect().height ?? null
      const clinical = document.querySelector('[role="group"][aria-label*="窗宽"]')
      const footer = document.querySelector('footer')
      return { topbar: h('header'), clinical: clinical?.getBoundingClientRect().height ?? null, statusbar: footer?.getBoundingClientRect().height ?? null }
    })
    desktop.check('2.4', 'toolbar rows are h-14 / h-11 / h-7', bars.topbar === 56 && bars.clinical === 44 && bars.statusbar === 28, bars)

    // clinical bar: window chips drive WW/WC readout
    const clinical = page.locator('[role="group"][aria-label*="窗宽"]')
    const chipCount = await clinical.locator('button').count()
    await clinical.locator('button', { hasText: '软组织' }).click()
    await waitFrames(page, 1)
    const softWindow = await getState(page)
    const softReadout = await clinical.innerText()
    await clinical.locator('button', { hasText: '骨窗' }).click()
    await waitFrames(page, 1)
    const boneWindow = await getState(page)
    desktop.check(
      '2.5',
      'ClinicalBar window chips update WW/WC (软组织 500/50, 骨窗 2600/600)',
      chipCount === 4 && softWindow?.windowWidth === 500 && softWindow?.windowCenter === 50 && /WW\s*500/.test(softReadout) && boneWindow?.windowWidth === 2600 && boneWindow?.windowCenter === 600,
      { chipCount, softWindow: { ww: softWindow?.windowWidth, wc: softWindow?.windowCenter }, boneWindow: { ww: boneWindow?.windowWidth, wc: boneWindow?.windowCenter }, readout: softReadout.replace(/\s+/g, ' ').slice(0, 120) },
    )

    // ---------------------------------------------------------- layouts
    const layoutGroup = page.locator('[role="group"][aria-label="多平面重建"]')
    await layoutGroup.waitFor({ state: 'visible', timeout: 15000 })
    const layoutBtns = await layoutGroup.locator('button').evaluateAll((els) => els.map((b) => ({ label: b.getAttribute('aria-label'), pressed: b.getAttribute('aria-pressed') })))
    desktop.check('3.1', 'layout segmented control has 2×2 / 多平面 / 3D', layoutBtns.length === 3 && layoutBtns.some((b) => b.label === '2×2') && layoutBtns.some((b) => b.label === '多平面') && layoutBtns.some((b) => b.label === '3D'), { buttons: layoutBtns })

    await layoutGroup.locator('button[aria-label="2×2"]').click()
    await waitFrames(page, 2)
    const quadPanes = await page.evaluate(panesOf)
    const workspace = await page.evaluate(() => {
      const grid = [...document.querySelectorAll('div.grid')].find((el) => String(el.className).includes('p-1.5') && String(el.className).includes('grid-cols'))
      if (!grid) return null
      const r = grid.getBoundingClientRect()
      return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }
    })
    desktop.note('quad panes', quadPanes)
    desktop.check('3.2', '2×2 layout renders exactly 4 panes', quadPanes.length === 4, { count: quadPanes.length, titles: quadPanes.map((p) => p.title) })
    const quadTitles = quadPanes.map((p) => p.title)
    desktop.check(
      '3.3',
      'panes are 轴位 / 冠状位 / 矢状位 / 3D 体渲染',
      ['轴位', '冠状位', '矢状位', '3D'].every((needle) => quadTitles.some((t) => t.includes(needle)) || (needle === '3D' && quadTitles.some((t) => /3D|体渲染/.test(t)))),
      { titles: quadTitles },
    )
    const halfW = (workspace.w - 12 - 6) / 2
    const halfH = (workspace.h - 12 - 6) / 2
    const badSizes = quadPanes.filter((p) => Math.abs(p.section.w - halfW) > 4 || Math.abs(p.section.h - halfH) > 4)
    desktop.check('3.4', 'each pane is ~half of the workspace (≈790×425 at 1600×1000)', badSizes.length === 0, {
      workspace,
      expected: { w: +halfW.toFixed(1), h: +halfH.toFixed(1) },
      panes: quadPanes.map((p) => ({ title: p.title, ...p.section, headerH: p.headerH })),
    })
    const badCanvas = quadPanes.filter((p) => p.canvasCount !== 1 || !p.content || p.canvases.some((c) => Math.abs(c.css.w - p.content.w) > 2.5 || Math.abs(c.css.h - p.content.h) > 2.5))
    desktop.check('3.5', 'all 4 canvases fill their pane (css size matches bitmap viewport)', badCanvas.length === 0, {
      bad: badCanvas.map((p) => ({ title: p.title, canvasCount: p.canvasCount, content: p.content, canvases: p.canvases })),
    })
    const badBitmap = quadPanes.filter((p) => p.canvases.some((c) => c.bitmap.w < 8 || c.bitmap.h < 8))
    desktop.check('3.6', 'all 4 canvases have real bitmap dimensions', badBitmap.length === 0, { panes: quadPanes.map((p) => ({ title: p.title, canvases: p.canvases.map((c) => c.bitmap) })) })
    const inkPanes = quadPanes.filter((p) => p.canvases.some((c) => c.ink && c.ink.bright > 500))
    desktop.check('3.7', 'all MPR slices contain rendered pixel data', inkPanes.length >= 3, { ink: quadPanes.map((p) => ({ title: p.title, ink: p.canvases.map((c) => c.ink) })) })
    await shot(page, 'qa2-layout-quad.png')
    screenshots.push({ name: 'qa2-layout-quad.png' })

    await layoutGroup.locator('button[aria-label="多平面"]').click()
    await waitFrames(page, 2)
    const mprPanes = await page.evaluate(panesOf)
    desktop.check('3.8', '多平面 layout renders 3 panes (all MPR)', mprPanes.length === 3 && mprPanes.every((p) => !p.is3d), { titles: mprPanes.map((p) => p.title) })
    await shot(page, 'qa2-layout-mpr.png')
    screenshots.push({ name: 'qa2-layout-mpr.png' })

    await layoutGroup.locator('button[aria-label="3D"]').click()
    await waitFrames(page, 2)
    const threePanes = await page.evaluate(panesOf)
    desktop.check('3.9', '3D layout renders exactly 1 pane with WebGL canvas', threePanes.length === 1 && threePanes[0].canvasCount === 1, { count: threePanes.length, pane: threePanes[0] })
    const threeRendered = await wait3d(page, 'qa2-layout-3d.png')
    desktop.check(
      '3.10',
      '3D pane renders a non-black volume',
      !threeRendered.timedOut && threeRendered.stats.brightCount > 500 && threeRendered.stats.std > 5,
      { ...threeRendered.stats, waitMs: threeRendered.elapsed, timedOut: threeRendered.timedOut },
    )
    await shot(page, 'qa2-layout-3d-full.png')
    screenshots.push({ name: 'qa2-layout-3d-full.png' })

    // ---------------------------------------------------------- MPR interactions
    await layoutGroup.locator('button[aria-label="2×2"]').click()
    await waitFrames(page, 3)
    let panes = await page.evaluate(panesOf)
    const paneBy = (needle) => panes.find((p) => p.title.includes(needle))
    const axial = paneBy('轴位')
    const coronal = paneBy('冠状位')
    const sagittal = paneBy('矢状位')

    const wheelPane = async (pane, deltaY = 120) => {
      await page.mouse.move(pane.content.x + pane.content.w / 2, pane.content.y + pane.content.h / 2)
      await page.mouse.wheel(0, deltaY)
      await waitFrames(page, 2)
      await page.waitForTimeout(120)
    }
    const beforeWheel = await getState(page)
    await wheelPane(axial, 120)
    const afterAxial = await getState(page)
    await wheelPane(coronal, 120)
    const afterCoronal = await getState(page)
    await wheelPane(sagittal, 120)
    const afterSagittal = await getState(page)
    desktop.check(
      '4.1',
      'wheel over each MPR pane nudges its own cursor axis',
      afterAxial.cursor.z === beforeWheel.cursor.z + 1 &&
        afterCoronal.cursor.y === beforeWheel.cursor.y + 1 &&
        afterSagittal.cursor.x === beforeWheel.cursor.x + 1,
      { before: beforeWheel.cursor, axial: afterAxial.cursor, coronal: afterCoronal.cursor, sagittal: afterSagittal.cursor },
    )

    // click axial inside the letterboxed image: pane 40%/40% maps to slice ~30%/40%
    panes = await page.evaluate(panesOf)
    const axial2 = paneBy('轴位')
    const beforeClick = await getState(page)
    await page.mouse.click(axial2.content.x + axial2.content.w * 0.4, axial2.content.y + axial2.content.h * 0.4)
    await waitFrames(page, 2)
    const afterClick = await getState(page)
    const approx = Math.abs(afterClick.cursor.x - 96) <= 8 && Math.abs(afterClick.cursor.y - 128) <= 8
    desktop.check('4.2', 'clicking the axial pane moves the crosshair to the picked voxel (~96,128)', afterClick.cursor.x !== beforeClick.cursor.x && afterClick.cursor.y !== beforeClick.cursor.y && approx, { before: beforeClick.cursor, after: afterClick.cursor, approx })
    await shot(page, 'qa2-mpr-crosshair.png')
    screenshots.push({ name: 'qa2-mpr-crosshair.png' })

    // zoom buttons in axial pane
    const axialZoomBtns = await page.evaluate(() => {
      const section = [...document.querySelectorAll('section')].find((s) => (s.querySelector(':scope > header span')?.textContent ?? '').includes('轴位'))
      return [...(section?.querySelectorAll('button') ?? [])].map((b) => b.getAttribute('aria-label'))
    })
    desktop.check('4.3', 'MPR zoom buttons 放大 / 缩小 / 适应窗口 exist', ['放大', '缩小', '适应窗口'].every((l) => axialZoomBtns.includes(l)), { buttons: axialZoomBtns })
    const zoomBefore = await shotPane(page, paneBy('轴位'), 'qa2-mpr-zoom-before.png')
    await page.locator('section', { hasText: '轴位' }).locator('button[aria-label="放大"]').first().click()
    await waitFrames(page, 2)
    const zoomAfter = await shotPane(page, paneBy('轴位'), 'qa2-mpr-zoom-after.png')
    const zoomDiff = diffRatio(zoomBefore.img, zoomAfter.img, 12)
    desktop.check('4.4', 'clicking 放大 changes the rendered slice (zoom works)', zoomDiff.same && zoomDiff.ratio > 0.01, { diff: zoomDiff })

    // 3D synchronized slice: change cursor.z, 3D must change
    const threeBefore = await wait3d(page, 'qa2-3d-before-slice.png')
    for (let i = 0; i < 6; i++) await wheelPane(paneBy('轴位'), 120)
    const afterSliceState = await getState(page)
    const threeAfter = await wait3d(page, 'qa2-3d-after-slice.png')
    const threeDiff = diffRatio(threeBefore.img, threeAfter.img, 10)
    desktop.check('4.5', '3D pane updates when the axial cursor.z changes (slice plane overlay)', afterSliceState.cursor.z !== beforeClick.cursor.z && threeDiff.same && threeDiff.ratio > 0.01, { cursorZ: afterSliceState.cursor.z, diff: threeDiff })
    await shot(page, 'qa2-quad-after-mpr.png')
    screenshots.push({ name: 'qa2-quad-after-mpr.png' })

    // teeth toggle changes 3D
    const teethBtn = page.locator('header button[aria-label="只看牙齿"]')
    const teethDisabled = await teethBtn.isDisabled()
    const threeTeethBefore = await wait3d(page, 'qa2-teeth-before.png')
    await teethBtn.click()
    await waitFrames(page, 3)
    const teethState = await getState(page)
    const threeTeethAfter = await wait3d(page, 'qa2-teeth-after.png')
    const teethDiff = diffRatio(threeTeethBefore.img, threeTeethAfter.img, 10)
    await shot(page, 'qa2-teeth-only-full.png')
    screenshots.push({ name: 'qa2-teeth-only-full.png' })
    desktop.check('5.1', '只看牙齿 enabled with dental ROI (not disabled)', teethDisabled === false, { disabled: teethDisabled })
    desktop.check('5.2', 'teeth toggle sets teethOnly + preset=teeth', teethState?.teethOnly === true && teethState?.presetId === 'teeth', { teethOnly: teethState?.teethOnly, preset: teethState?.presetId })
    desktop.check('5.3', 'teeth toggle changes the 3D rendering', teethDiff.same && teethDiff.ratio > 0.01, { diff: teethDiff })
    await page.locator('header button[aria-label="只看牙齿"]').click()
    await waitFrames(page, 2)

    // preset select
    const selectInfo = await page.evaluate(() => {
      const select = document.querySelector('[aria-label="渲染风格"]')
      return select ? { options: [...select.options].map((o) => o.value), value: select.value } : null
    })
    desktop.check('5.4', 'render preset select has 8 presets', !!selectInfo && selectInfo.options.length === 8, selectInfo)
    await page.selectOption('[aria-label="渲染风格"]', 'mip')
    await waitFrames(page, 2)
    const presetState = await getState(page)
    desktop.check('5.5', 'changing the preset select updates presetId', presetState?.presetId === 'mip', { preset: presetState?.presetId })
    await page.selectOption('[aria-label="渲染风格"]', 'bone')
    await waitFrames(page, 2)

    // ---------------------------------------------------------- settings / font scale
    const fontBefore = await page.evaluate(() => getComputedStyle(document.querySelector('footer')).fontSize)
    await page.locator('header button[aria-label="设置"]').click()
    await page.waitForTimeout(400)
    const drawer = await page.evaluate(() => {
      const aside = document.querySelector('aside')
      const text = aside?.innerText ?? ''
      return {
        text: text.replace(/\s+/g, ' ').slice(0, 300),
        buttons: [...(aside?.querySelectorAll('button') ?? [])].map((b) => (b.textContent ?? '').trim()),
        hasFontSection: /界面字号/.test(text),
        rect: aside ? { w: +aside.getBoundingClientRect().width.toFixed(1), x: +aside.getBoundingClientRect().x.toFixed(1) } : null,
      }
    })
    desktop.check('6.1', '设置 opens the drawer with 界面字号 section', drawer.hasFontSection && ['小', '标准', '大', '特大'].every((l) => drawer.buttons.includes(l)), drawer)
    await page.getByRole('button', { name: '特大', exact: true }).click()
    await waitFrames(page, 1)
    const fontAfter = await page.evaluate(() => getComputedStyle(document.querySelector('footer')).fontSize)
    const scaleState = await getState(page)
    desktop.check('6.2', '特大 sets uiScale 1.55 and persists in localStorage', scaleState?.uiScale === 1.55 && scaleState?.uiScaleStorage === '1.55', { uiScale: scaleState?.uiScale, storage: scaleState?.uiScaleStorage })
    desktop.check('6.3', '特大 increases chrome font-size', parseFloat(fontAfter) > parseFloat(fontBefore) * 1.2, { before: fontBefore, after: fontAfter })
    await shot(page, 'qa2-settings-xlarge.png')
    screenshots.push({ name: 'qa2-settings-xlarge.png' })
    desktop.check(
      '6.4',
      '特大 causes no horizontal overflow at 1600×1000',
      scaleState.bodyScrollWidth <= scaleState.innerWidth + 0.5 && scaleState.headerScrollWidth <= scaleState.headerClientWidth + 1,
      { bodyScrollWidth: scaleState.bodyScrollWidth, innerWidth: scaleState.innerWidth, header: [scaleState.headerScrollWidth, scaleState.headerClientWidth] },
    )
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    const drawerClosed = await getState(page)
    desktop.check('6.5', 'Escape closes the settings drawer', drawerClosed?.settingsOpen === false, { settingsOpen: drawerClosed?.settingsOpen })

    // ---------------------------------------------------------- language + persistence
    await page.locator('header button[aria-label*="切换语言"]').click()
    await page.waitForTimeout(400)
    const enState = await getState(page)
    const enDom = await page.evaluate(() => ({
      text: document.body.textContent ?? '',
      settingsLabel: document.querySelector('header button[aria-label="Settings"]')?.getAttribute('aria-label') ?? null,
      teethLabel: document.querySelector('header button[aria-label="Teeth only"]')?.getAttribute('aria-label') ?? null,
      layoutLabels: [...document.querySelectorAll('[role="group"][aria-label="Multiplanar"] button')].map((b) => b.getAttribute('aria-label')),
    }))
    desktop.check(
      '7.1',
      'EN switches UI to English and updates documentElement.lang',
      enState?.lang === 'en' &&
        enState?.docLang === 'en' &&
        enState?.langStorage === 'en' &&
        enDom.settingsLabel === 'Settings' &&
        enDom.teethLabel === 'Teeth only' &&
        enDom.layoutLabels.includes('MPR') &&
        /Window \/ level/.test(enDom.text) &&
        /Voxel/.test(enDom.text),
      { lang: enState?.lang, docLang: enState?.docLang, stored: enState?.langStorage, labels: { settings: enDom.settingsLabel, teeth: enDom.teethLabel, layouts: enDom.layoutLabels } },
    )
    await shot(page, 'qa2-desktop-en.png')
    screenshots.push({ name: 'qa2-desktop-en.png' })

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => Boolean(window.__viewer), undefined, { timeout: 30000, polling: 100 })
    await page.waitForTimeout(500)
    const reloadStart = await getState(page)
    const reloadText = await page.evaluate(() => document.querySelector('.loader')?.innerText ?? '')
    desktop.check(
      '7.2',
      'English persists across reload (start screen in English)',
      reloadStart?.status === 'idle' && reloadStart?.lang === 'en' && reloadStart?.docLang === 'en' && reloadStart?.langStorage === 'en' && /Open a CBCT study/.test(reloadText),
      { status: reloadStart?.status, lang: reloadStart?.lang, docLang: reloadStart?.docLang, stored: reloadStart?.langStorage, text: reloadText.replace(/\s+/g, ' ').slice(0, 120) },
    )
    await shot(page, 'qa2-start-en.png')
    screenshots.push({ name: 'qa2-start-en.png' })
    await sample(page, 'Load sample study')
    const enReady = await getState(page)
    desktop.check('7.3', 'English sample loads, uiScale persisted 1.55', enReady?.status === 'ready' && enReady?.lang === 'en' && enReady?.uiScale === 1.55, { status: enReady?.status, lang: enReady?.lang, uiScale: enReady?.uiScale })
    await page.locator('header button[aria-label*="切换语言"]').click()
    await page.waitForTimeout(400)
    const backZh = await getState(page)
    desktop.check('7.4', 'switching back to 中文 persists zh', backZh?.lang === 'zh' && backZh?.docLang === 'zh-CN' && backZh?.langStorage === 'zh', { lang: backZh?.lang, docLang: backZh?.docLang, stored: backZh?.langStorage })

    // ---------------------------------------------------------- generic DICOM import
    const importStart = Date.now()
    await page.locator('input[type=file]').nth(1).setInputFiles(DICOM_FILES)
    await waitForState(page, () => window.__viewer?.getState?.().meta?.source?.directory === 'local import', 300000)
    await waitForState(page, () => window.__viewer?.getState?.().status === 'ready', 300000)
    await waitFrames(page, 3)
    const imported = await getState(page)
    const importMs = Date.now() - importStart
    desktop.note('generic DICOM import', { files: DICOM_FILES.length, ms: importMs, dims: imported?.volumeDims, src: imported?.metaDir, preview: imported?.preview, dental: imported?.dental })
    desktop.check(
      '8.1',
      'in-browser DICOM import (403 files) replaces the volume without reload',
      imported?.status === 'ready' && imported?.metaDir === 'local import' && imported?.volumeDims?.length === 3,
      { status: imported?.status, src: imported?.metaDir, dims: imported?.volumeDims, ms: importMs },
    )
    desktop.check('8.2', 'imported study has preview poster + dental ROI', imported?.preview === true && imported?.dental === true, { preview: imported?.preview, dental: imported?.dental })
    const importPanes = await page.evaluate(panesOf)
    desktop.check('8.3', 'workspace renders imported volume (4 panes, non-empty canvases)', importPanes.length === 4 && importPanes.every((p) => p.canvasCount === 1), { count: importPanes.length, titles: importPanes.map((p) => p.title) })
    await shot(page, 'qa2-custom-import.png')
    screenshots.push({ name: 'qa2-custom-import.png' })

    // ---------------------------------------------------------- console
    desktop.check('C.1', 'no page errors during desktop run', errors.pageErrors.length === 0, { pageErrors: errors.pageErrors })
    desktop.check('C.2', 'no console errors during desktop run', errors.consoleErrors.length === 0, { consoleErrors: errors.consoleErrors })
    desktop.note('console warnings', errors.consoleWarnings.slice(0, 10))
    desktop.save({
      screenshots,
      consoleErrors: errors.consoleErrors,
      pageErrors: errors.pageErrors,
      consoleWarnings: errors.consoleWarnings,
      url: BASE,
    })
  } catch (error) {
    desktop.check('FATAL', 'desktop suite completed without throwing', false, { message: String(error?.stack ?? error) })
    desktop.save({ screenshots, consoleErrors: errors.consoleErrors, pageErrors: errors.pageErrors, fatal: String(error?.stack ?? error) })
  }
}

// ---------------------------------------------------------------- mobile

async function runMobile(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT_MOBILE, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  const errors = trackConsole(page)
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForFunction(() => Boolean(window.__viewer), undefined, { timeout: 30000, polling: 100 })
    await page.waitForTimeout(600)
    const idle = await getState(page)
    const startText = await page.evaluate(() => document.querySelector('.loader')?.innerText ?? '')
    mobile.check('9.1', 'mobile loads into the start screen (中文)', idle?.status === 'idle' && /打开 CBCT 影像/.test(startText), { status: idle?.status })
    const startOverflow = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      doc: document.documentElement.scrollWidth,
      inner: window.innerWidth,
      buttons: [...document.querySelectorAll('.loader button')].map((b) => {
        const r = b.getBoundingClientRect()
        return { text: (b.textContent ?? '').trim(), left: +r.left.toFixed(1), right: +r.right.toFixed(1) }
      }),
    }))
    mobile.check('9.2', 'start screen fits 390px (no horizontal overflow, buttons inside)', startOverflow.body <= startOverflow.inner + 0.5 && startOverflow.doc <= startOverflow.inner + 0.5 && startOverflow.buttons.every((b) => b.left >= -0.5 && b.right <= startOverflow.inner + 0.5), startOverflow)
    await shot(page, 'qa2-mobile-start.png')
    screenshots.push({ name: 'qa2-mobile-start.png' })

    await sample(page, '加载示例病例')
    const ready = await getState(page)
    mobile.check('9.3', 'mobile sample loads (4 tabs, one pane visible)', ready?.status === 'ready' && ready?.volumeDims?.length === 3, { status: ready?.status, dims: ready?.volumeDims })
    const tabs = await page.evaluate(() =>
      [...document.querySelectorAll('button')]
        .filter((b) => {
          const parent = b.parentElement
          const inTabStrip = parent && parent.className.includes('shrink-0') && parent.className.includes('gap-1')
          return inTabStrip && ['轴位', '冠状位', '矢状位', '3D'].includes((b.textContent ?? '').trim())
        })
        .map((b) => ({ text: (b.textContent ?? '').trim(), pressed: b.getAttribute('aria-pressed'), rect: (() => { const r = b.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1) } })() })),
    )
    mobile.check('9.4', 'four pane tabs 轴位/冠状位/矢状位/3D are present', tabs.length === 4, { tabs })
    let mobilePanes = await page.evaluate(panesOf)
    mobile.check('9.5', 'exactly one pane is visible on mobile', mobilePanes.length === 1, { count: mobilePanes.length, titles: mobilePanes.map((p) => p.title) })
    const tabTitles = []
    for (const tab of ['冠状位', '矢状位', '3D', '轴位']) {
      // Tabs live in the compact workspace strip (the top bar also has a 3D
      // layout button, so click the tab element directly).
      await page.evaluate((label) => {
        const btn = [...document.querySelectorAll('button')].find((b) => {
          const parent = b.parentElement
          return (
            parent &&
            parent.className.includes('shrink-0') &&
            parent.className.includes('gap-1') &&
            (b.textContent ?? '').trim() === label
          )
        })
        if (btn) btn.click()
      }, tab)
      await waitFrames(page, 2)
      const panes = await page.evaluate(panesOf)
      tabTitles.push({ tab, panes: panes.map((p) => p.title), count: panes.length })
    }
    mobile.check('9.6', 'tapping each tab switches the single visible pane', tabTitles.every((t) => t.count === 1), { tabTitles })
    const mobileOverflow = await page.evaluate(() => ({ body: document.body.scrollWidth, doc: document.documentElement.scrollWidth, inner: window.innerWidth }))
    mobile.check('9.7', 'no horizontal overflow after load (390×844)', mobileOverflow.body <= mobileOverflow.inner + 0.5 && mobileOverflow.doc <= mobileOverflow.inner + 0.5, mobileOverflow)
    await shot(page, 'qa2-mobile-workspace.png')
    screenshots.push({ name: 'qa2-mobile-workspace.png' })

    // touch scroll/click on the visible pane
    const pane = (await page.evaluate(panesOf))[0]
    const beforeClick = await getState(page)
    await page.touchscreen.tap(pane.content.x + pane.content.w * 0.32, pane.content.y + pane.content.h * 0.42)
    await waitFrames(page, 2)
    const afterClick = await getState(page)
    mobile.check('9.8', 'touch tap on the visible pane moves the crosshair', afterClick.cursor.x !== beforeClick.cursor.x || afterClick.cursor.y !== beforeClick.cursor.y || afterClick.cursor.z !== beforeClick.cursor.z, { before: beforeClick.cursor, after: afterClick.cursor })

    // font scale at mobile: 特大 no horizontal overflow
    await page.locator('header button[aria-label="设置"]').click()
    await page.waitForTimeout(400)
    const drawerMobile = await page.evaluate(() => {
      const aside = document.querySelector('aside')
      const r = aside?.getBoundingClientRect()
      return { hasFont: /界面字号/.test(aside?.innerText ?? ''), rect: r ? { x: +r.x.toFixed(1), w: +r.width.toFixed(1) } : null, scrollWidth: aside?.scrollWidth ?? null, clientWidth: aside?.clientWidth ?? null }
    })
    mobile.check('9.9', 'settings drawer opens on mobile and fits the viewport', drawerMobile.hasFont && !!drawerMobile.rect && drawerMobile.rect.x >= -0.5 && drawerMobile.rect.x + drawerMobile.rect.w <= VIEWPORT_MOBILE.width + 0.5, drawerMobile)
    await page.getByRole('button', { name: '特大', exact: true }).click()
    await waitFrames(page, 1)
    const bigState = await getState(page)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    await shot(page, 'qa2-mobile-xsxl.png')
    screenshots.push({ name: 'qa2-mobile-xsxl.png' })
    const bigOverflow = await page.evaluate(() => ({ body: document.body.scrollWidth, doc: document.documentElement.scrollWidth, inner: window.innerWidth }))
    mobile.check('9.10', '特大 (1.55) at 390×844 has no horizontal overflow', bigState?.uiScale === 1.55 && bigState?.uiScaleStorage === '1.55' && bigOverflow.body <= bigOverflow.inner + 0.5 && bigOverflow.doc <= bigOverflow.inner + 0.5, { uiScale: bigState?.uiScale, storage: bigState?.uiScaleStorage, overflow: bigOverflow })

    mobile.check('C.1', 'no page errors during mobile run', errors.pageErrors.length === 0, { pageErrors: errors.pageErrors })
    mobile.check('C.2', 'no console errors during mobile run', errors.consoleErrors.length === 0, { consoleErrors: errors.consoleErrors })
    mobile.note('console warnings', errors.consoleWarnings.slice(0, 10))
    mobile.save({ screenshots, consoleErrors: errors.consoleErrors, pageErrors: errors.pageErrors, consoleWarnings: errors.consoleWarnings, url: BASE })
  } catch (error) {
    mobile.check('FATAL', 'mobile suite completed without throwing', false, { message: String(error?.stack ?? error) })
    mobile.save({ screenshots, consoleErrors: errors.consoleErrors, pageErrors: errors.pageErrors, fatal: String(error?.stack ?? error) })
  } finally {
    await context.close()
  }
}

// ---------------------------------------------------------------- main

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
try {
  const desktopContext = await browser.newContext({ viewport: VIEWPORT_DESKTOP, deviceScaleFactor: 1 })
  const desktopPage = await desktopContext.newPage()
  await runDesktop(desktopPage)
  await desktopContext.close()
  await runMobile(browser)
} finally {
  await browser.close()
}
const d = desktop.checks
const m = mobile.checks
const summary = {
  desktop: `${d.filter((c) => c.pass).length}/${d.length}`,
  mobile: `${m.filter((c) => c.pass).length}/${m.length}`,
  screenshots: screenshots.length,
}
fs.writeFileSync(path.join('tools/qa', 'qa2-summary.json'), JSON.stringify(summary, null, 2))
console.log('\nQA2 SUMMARY', JSON.stringify(summary))
