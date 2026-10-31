import type { Cursor, MprAxis, Vec3, VolumeData } from '../types'

export interface MprDisplay {
  width: number
  height: number
  /** Slice index shown along the view normal. */
  index: number
  max: number
  /** World-ish label of the changing axis. */
  axisLabel: 'X' | 'Y' | 'Z'
}

export function mprDisplay(axis: MprAxis, dims: Vec3, cursor: Cursor): MprDisplay {
  const [w, h, d] = dims
  if (axis === 'axial') return { width: w, height: h, index: cursor.z, max: d - 1, axisLabel: 'Z' }
  if (axis === 'coronal') return { width: w, height: d, index: cursor.y, max: h - 1, axisLabel: 'Y' }
  return { width: h, height: d, index: cursor.x, max: w - 1, axisLabel: 'X' }
}

function crosshair(axis: MprAxis, dims: Vec3, cursor: Cursor): [number, number] {
  const [, , d] = dims
  if (axis === 'axial') return [cursor.x, cursor.y]
  if (axis === 'coronal') return [cursor.x, d - 1 - cursor.z]
  return [cursor.y, d - 1 - cursor.z]
}

/**
 * Rasterize one multiplanar slice into a canvas and draw the synchronized
 * crosshair. Uses window center/width in Hounsfield units.
 */
export function drawMpr(
  canvas: HTMLCanvasElement,
  volume: VolumeData,
  axis: MprAxis,
  cursor: Cursor,
  windowCenter: number,
  windowWidth: number,
): void {
  const [w, h, d] = volume.dims
  const display = mprDisplay(axis, volume.dims, cursor)
  const cw = display.width
  const ch = display.height
  if (canvas.width !== cw) canvas.width = cw
  if (canvas.height !== ch) canvas.height = ch

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const image = ctx.createImageData(cw, ch)
  const data = image.data
  const u8 = volume.u8
  const plane = w * h
  const [qMin, qMax] = volume.quantRange
  const huToU8 = 255 / (qMax - qMin)
  const lo = (windowCenter - windowWidth / 2 - qMin) * huToU8
  const hi = (windowCenter + windowWidth / 2 - qMin) * huToU8
  const scale = 255 / Math.max(1e-3, hi - lo)

  let p = 0
  if (axis === 'axial') {
    const base = cursor.z * plane
    for (let y = 0; y < h; y++) {
      let src = base + y * w
      for (let x = 0; x < w; x++) {
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
    for (let row = 0; row < d; row++) {
      const z = d - 1 - row
      let src = z * plane + y * w
      for (let x = 0; x < w; x++) {
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
    for (let row = 0; row < d; row++) {
      const z = d - 1 - row
      let src = z * plane + x
      for (let y = 0; y < h; y++) {
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

  // Crosshair lines + center marker.
  const [cx, cy] = crosshair(axis, volume.dims, cursor)
  const px = Math.min(cw - 0.5, Math.max(0.5, cx + 0.5))
  const py = Math.min(ch - 0.5, Math.max(0.5, cy + 0.5))
  ctx.save()
  ctx.strokeStyle = 'rgba(45, 212, 191, 0.75)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, py)
  ctx.lineTo(cw, py)
  ctx.moveTo(px, 0)
  ctx.lineTo(px, ch)
  ctx.stroke()
  ctx.fillStyle = 'rgba(45, 212, 191, 0.95)'
  ctx.beginPath()
  ctx.arc(px, py, 2.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** Map normalized pointer position [0..1]^2 inside a view to a voxel cursor. */
export function pickMpr(axis: MprAxis, dims: Vec3, u: number, v: number): Partial<Cursor> {
  const [w, h, d] = dims
  const x = Math.min(w - 1, Math.max(0, Math.floor(u * w)))
  const y = Math.min(h - 1, Math.max(0, Math.floor(v * h)))
  const z = Math.min(d - 1, Math.max(0, d - 1 - Math.floor(v * d)))
  if (axis === 'axial') return { x, y }
  if (axis === 'coronal') return { x, z }
  return { y, z }
}
