import { useCallback, useEffect, useRef, useState } from 'react'
import type { MprAxis, VolumeData } from '../../types'
import { mprDisplay, pickMpr } from '../../data/mpr'
import { useViewerStore } from '../../store/useViewerStore'
import { translate } from '../../i18n'

const NORMAL: Record<MprAxis, 'x' | 'y' | 'z'> = { axial: 'z', coronal: 'y', sagittal: 'x' }
const SPACING_INDEX: Record<MprAxis, 0 | 1 | 2> = { axial: 2, coronal: 1, sagittal: 0 }
/** top, bottom, left, right - radiological convention (patient right on image left). */
const ORIENT: Record<MprAxis, [string, string, string, string]> = {
  axial: ['A', 'P', 'R', 'L'],
  coronal: ['S', 'I', 'R', 'L'],
  sagittal: ['S', 'I', 'A', 'P'],
}

interface SliceImage {
  key: string
  canvas: HTMLCanvasElement
  width: number
  height: number
}

function sliceKey(
  volume: VolumeData,
  axis: MprAxis,
  cursor: { x: number; y: number; z: number },
  windowCenter: number,
  windowWidth: number,
): string {
  const [w, h, d] = volume.dims
  return `${axis}|${cursor.x}|${cursor.y}|${cursor.z}|${Math.round(windowCenter)}|${Math.round(windowWidth)}|${w}|${h}|${d}`
}

function buildSliceImage(
  volume: VolumeData,
  axis: MprAxis,
  cursor: { x: number; y: number; z: number },
  windowCenter: number,
  windowWidth: number,
): SliceImage {
  const [w, h, d] = volume.dims
  const display = mprDisplay(axis, volume.dims, cursor)
  const width = display.width
  const height = display.height
  const key = sliceKey(volume, axis, cursor, windowCenter, windowWidth)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return { key, canvas, width, height }

  const image = ctx.createImageData(width, height)
  const data = image.data
  const plane = w * h
  const u8 = volume.u8
  const [qMin, qMax] = volume.quantRange
  const huToU8 = 255 / (qMax - qMin)
  const lo = (windowCenter - windowWidth / 2 - qMin) * huToU8
  const hi = (windowCenter + windowWidth / 2 - qMin) * huToU8
  const scale = 255 / Math.max(1e-3, hi - lo)

  let p = 0
  if (axis === 'axial') {
    const base = cursor.z * plane
    for (let row = 0; row < height; row++) {
      let src = base + row * w
      for (let col = 0; col < width; col++) {
        const q = (u8[src++] - lo) * scale
        const v = q <= 0 ? 0 : q >= 255 ? 255 : q
        data[p] = v
        data[p + 1] = v
        data[p + 2] = v
        data[p + 3] = 255
        p += 4
      }
    }
  } else if (axis === 'coronal') {
    const y = cursor.y
    for (let row = 0; row < height; row++) {
      const z = d - 1 - row
      let src = z * plane + y * w
      for (let col = 0; col < width; col++) {
        const q = (u8[src++] - lo) * scale
        const v = q <= 0 ? 0 : q >= 255 ? 255 : q
        data[p] = v
        data[p + 1] = v
        data[p + 2] = v
        data[p + 3] = 255
        p += 4
      }
    }
  } else {
    const x = cursor.x
    for (let row = 0; row < height; row++) {
      const z = d - 1 - row
      let src = z * plane + x
      for (let col = 0; col < width; col++) {
        const q = (u8[src] - lo) * scale
        src += w
        const v = q <= 0 ? 0 : q >= 255 ? 255 : q
        data[p] = v
        data[p + 1] = v
        data[p + 2] = v
        data[p + 3] = 255
        p += 4
      }
    }
  }

  ctx.putImageData(image, 0, 0)
  return { key, canvas, width, height }
}

interface ViewLayout {
  offsetX: number
  offsetY: number
  scale: number
  imgW: number
  imgH: number
}

export function MprViewport({ axis, className = '' }: { axis: MprAxis; className?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sliceRef = useRef<SliceImage | null>(null)
  const viewRef = useRef<ViewLayout>({ offsetX: 0, offsetY: 0, scale: 1, imgW: 1, imgH: 1 })
  const dragRef = useRef<{ mode: 'pan' | 'pick'; x: number; y: number; panX: number; panY: number } | null>(null)

  const volume = useViewerStore((s) => s.volume)
  const cursor = useViewerStore((s) => s.cursor)
  const windowCenter = useViewerStore((s) => s.windowCenter)
  const windowWidth = useViewerStore((s) => s.windowWidth)
  const setCursor = useViewerStore((s) => s.setCursor)
  const nudgeCursor = useViewerStore((s) => s.nudgeCursor)
  const lang = useViewerStore((s) => s.lang)
  const uiScale = useViewerStore((s) => s.uiScale)

  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) setSize({ w: Math.round(rect.width), h: Math.round(rect.height) })
    })
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [])

  const resetView = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !volume || size.w < 8 || size.h < 8) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const cssW = size.w
    const cssH = size.h
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr)
      canvas.height = Math.round(cssH * dpr)
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, cssW, cssH)

    const cache = sliceRef.current
    const expectedKey = sliceKey(volume, axis, cursor, windowCenter, windowWidth)
    const image = cache && cache.key === expectedKey ? cache : buildSliceImage(volume, axis, cursor, windowCenter, windowWidth)
    sliceRef.current = image

    const pad = 2
    const fit = Math.min((cssW - pad * 2) / image.width, (cssH - pad * 2) / image.height)
    const scale = fit * zoom
    const dw = image.width * scale
    const dh = image.height * scale
    const offsetX = (cssW - dw) / 2 + pan.x
    const offsetY = (cssH - dh) / 2 + pan.y
    viewRef.current = { offsetX, offsetY, scale, imgW: image.width, imgH: image.height }

    ctx.imageSmoothingEnabled = zoom < 2.5
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image.canvas, offsetX, offsetY, dw, dh)

    // Orientation letters around the image edges.
    ctx.fillStyle = 'rgba(45, 212, 191, 0.85)'
    ctx.font = `600 ${Math.round(10 * uiScale)}px ui-monospace, SFMono-Regular, Menlo, monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const labelPad = 9 * uiScale
    const [top, bottom, left, right] = ORIENT[axis]
    ctx.fillText(top, offsetX + dw / 2, offsetY + labelPad)
    ctx.fillText(bottom, offsetX + dw / 2, offsetY + dh - labelPad)
    ctx.fillText(left, offsetX + labelPad, offsetY + dh / 2)
    ctx.fillText(right, offsetX + dw - labelPad, offsetY + dh / 2)

    // 10 mm scale bar, bottom-right.
    const spacingMm = volume.spacing[SPACING_INDEX[axis]]
    const tenMm = (10 / spacingMm) * scale
    if (tenMm > 6 && tenMm < dw - 24) {
      const bx = offsetX + dw - 12
      const by = offsetY + dh - 22
      ctx.strokeStyle = 'rgba(226, 244, 255, 0.8)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(bx - tenMm, by)
      ctx.lineTo(bx, by)
      ctx.stroke()
      ctx.fillStyle = 'rgba(226, 244, 255, 0.75)'
      ctx.font = `${Math.round(9 * uiScale)}px ui-monospace, SFMono-Regular, Menlo, monospace`
      ctx.textAlign = 'right'
      ctx.fillText('10 mm', bx, by - 5)
    }

    // Synchronized crosshair.
    const display = mprDisplay(axis, volume.dims, cursor)
    const [, , d] = volume.dims
    const cx = axis === 'sagittal' ? cursor.y : cursor.x
    const cy = axis === 'axial' ? cursor.y : d - 1 - cursor.z
    const px = offsetX + (cx + 0.5) * scale
    const py = offsetY + (cy + 0.5) * scale
    const inside = px >= offsetX && px <= offsetX + dw && py >= offsetY && py <= offsetY + dh
    if (inside) {
      ctx.save()
      ctx.strokeStyle = 'rgba(45, 212, 191, 0.62)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(offsetX, py)
      ctx.lineTo(offsetX + dw, py)
      ctx.moveTo(px, offsetY)
      ctx.lineTo(px, offsetY + dh)
      ctx.stroke()
      ctx.fillStyle = 'rgba(45, 212, 191, 0.95)'
      ctx.beginPath()
      ctx.arc(px, py, 2.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    // Slice index badge bottom-left (kept in the image, not the pane chrome).
    ctx.fillStyle = 'rgba(125, 147, 168, 0.9)'
    ctx.font = `${Math.round(9 * uiScale)}px ui-monospace, SFMono-Regular, Menlo, monospace`
    ctx.textAlign = 'left'
    ctx.fillText(`${display.index + 1} / ${display.max + 1}`, offsetX + 8, offsetY + dh - 9)
  }, [axis, cursor, pan, size, uiScale, volume, windowCenter, windowWidth, zoom])

  useEffect(() => {
    draw()
  }, [draw])

  const pick = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current
      const canvas = canvasRef.current
      if (!wrap || !canvas || !volume) return
      const rect = canvas.getBoundingClientRect()
      const sx = clientX - rect.left
      const sy = clientY - rect.top
      const view = viewRef.current
      const u = (sx - view.offsetX) / view.scale / view.imgW
      const v = (sy - view.offsetY) / view.scale / view.imgH
      if (u < 0 || u > 1 || v < 0 || v > 1) return
      setCursor(pickMpr(axis, volume.dims, u, v))
    },
    [axis, setCursor, volume],
  )

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) {
        setZoom((value) => Math.min(12, Math.max(0.4, value * Math.exp(-event.deltaY * 0.0018))))
      } else {
        nudgeCursor(NORMAL[axis], event.deltaY > 0 ? 1 : -1)
      }
    },
    [axis, nudgeCursor],
  )

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    wrap.addEventListener('wheel', handleWheel, { passive: false })
    return () => wrap.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const panMode = event.button === 2 || event.button === 1 || event.shiftKey
    dragRef.current = {
      mode: panMode ? 'pan' : 'pick',
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    if (!panMode) pick(event.clientX, event.clientY)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag) return
    if (drag.mode === 'pan') {
      setPan({ x: drag.panX + (event.clientX - drag.x), y: drag.panY + (event.clientY - drag.y) })
    } else {
      pick(event.clientX, event.clientY)
    }
  }

  const endDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
  }

  return (
    <div ref={wrapRef} className={`relative h-full w-full overflow-hidden bg-black ${className}`}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full cursor-crosshair touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={resetView}
        onContextMenu={(event) => event.preventDefault()}
      />
      <div className="absolute right-1.5 top-1.5 flex flex-col gap-1">
        {[
          { label: translate(lang, 'zoom.in'), symbol: '+', action: () => setZoom((v) => Math.min(12, v * 1.25)) },
          { label: translate(lang, 'zoom.out'), symbol: '-', action: () => setZoom((v) => Math.max(0.4, v / 1.25)) },
          { label: translate(lang, 'zoom.fit'), symbol: 'F', action: resetView },
        ].map((item) => (
          <button
            key={item.label}
            type="button"
            aria-label={item.label}
            title={item.label}
            onClick={item.action}
            className="grid h-6 w-6 place-items-center rounded border border-[#94a3b8]/25 bg-[#050a10]/75 font-mono text-[11px] text-[#9fb4c8] backdrop-blur transition hover:border-teal-300/50 hover:text-teal-200"
          >
            {item.symbol}
          </button>
        ))}
      </div>
    </div>
  )
}


