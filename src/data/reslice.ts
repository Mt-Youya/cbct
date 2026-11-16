import type { Cursor, Vec3, VolumeData } from '../types'

export interface GrayRaster {
  width: number
  height: number
  values: Uint8Array
}

export interface SlicePlane {
  center: Vec3
  right: Vec3
  down: Vec3
  widthMm: number
  heightMm: number
}

function dot(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function obliqueGeometry(volume: VolumeData, cursor: Cursor, yaw: number, tilt: number) {
  const azimuth = yaw * Math.PI / 180
  const elevation = tilt * Math.PI / 180
  const [c, s] = [Math.cos(azimuth), Math.sin(azimuth)]
  const [cosTilt, sinTilt] = [Math.cos(elevation), Math.sin(elevation)]
  const right: Vec3 = [c, s, 0]
  const down: Vec3 = [-s * sinTilt, c * sinTilt, -cosTilt]
  const normal: Vec3 = [-s * cosTilt, c * cosTilt, sinTilt]
  const [sx, sy, sz] = volume.spacing
  const [w, h, d] = volume.dims
  const extent: Vec3 = [w * sx, h * sy, d * sz]
  const midpoint: Vec3 = [(w - 1) * sx / 2, (h - 1) * sy / 2, (d - 1) * sz / 2]
  const projectedWidth = (axis: Vec3) => dot(extent, [Math.abs(axis[0]), Math.abs(axis[1]), Math.abs(axis[2])])
  const depth = dot([cursor.x * sx - midpoint[0], cursor.y * sy - midpoint[1], cursor.z * sz - midpoint[2]], normal)
  const halfDepth = projectedWidth(normal) / 2
  const widthMm = projectedWidth(right)
  const heightMm = projectedWidth(down)

  return {
    min: -halfDepth - depth,
    max: halfDepth - depth,
    plane(offset: number): SlicePlane {
      const distance = depth + offset
      return {
        center: [
          midpoint[0] + normal[0] * distance,
          midpoint[1] + normal[1] * distance,
          midpoint[2] + normal[2] * distance,
        ],
        right,
        down,
        widthMm,
        heightMm,
      }
    },
  }
}

/** Sample a plane in physical mm, preserving geometry with anisotropic voxels. */
export function resliceVolume(volume: VolumeData, plane: SlicePlane): GrayRaster {
  const [w, h, d] = volume.dims
  const [sx, sy, sz] = volume.spacing
  const { center, right, down, widthMm, heightMm } = plane
  const pixel = Math.max(Math.min(sx, sy, sz), widthMm / 650, heightMm / 650)
  // Discard roundoff from projecting cardinal angles (e.g. cos(90°)).
  const width = Math.max(1, Math.ceil(widthMm / pixel - 1e-8))
  const height = Math.max(1, Math.ceil(heightMm / pixel - 1e-8))
  const values = new Uint8Array(width * height)
  const stride = w * h
  const source = volume.u8

  const sample = (x: number, y: number, z: number) => {
    if (x < -0.5 || y < -0.5 || z < -0.5 || x > w - 0.5 || y > h - 0.5 || z > d - 0.5) return 0
    x = Math.max(0, Math.min(w - 1, x))
    y = Math.max(0, Math.min(h - 1, y))
    z = Math.max(0, Math.min(d - 1, z))
    const ix = Math.floor(x)
    const iy = Math.floor(y)
    const iz = Math.floor(z)
    const dx = Math.min(1, w - 1 - ix)
    const dy = Math.min(1, h - 1 - iy) * w
    const dz = Math.min(1, d - 1 - iz) * stride
    const base = iz * stride + iy * w + ix
    const fx = x - ix
    const fy = y - iy
    const fz = z - iz
    const top = source[base] * (1 - fx) + source[base + dx] * fx
    const bottom = source[base + dy] * (1 - fx) + source[base + dy + dx] * fx
    const nextTop = source[base + dz] * (1 - fx) + source[base + dz + dx] * fx
    const nextBottom = source[base + dz + dy] * (1 - fx) + source[base + dz + dy + dx] * fx
    return Math.round(((1 - fy) * top + fy * bottom) * (1 - fz) + ((1 - fy) * nextTop + fy * nextBottom) * fz)
  }

  for (let row = 0; row < height; row++) {
    const v = (row - (height - 1) / 2) * pixel
    for (let col = 0; col < width; col++) {
      const u = (col - (width - 1) / 2) * pixel
      values[row * width + col] = sample(
        (center[0] + u * right[0] + v * down[0]) / sx,
        (center[1] + u * right[1] + v * down[1]) / sy,
        (center[2] + u * right[2] + v * down[2]) / sz,
      )
    }
  }

  return { width, height, values }
}
