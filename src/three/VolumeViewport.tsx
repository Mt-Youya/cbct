import { type ComponentRef, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { translate } from '../i18n'
import type { DentalRoi, Vec3, VolumeData } from '../types'
import { useViewerStore } from '../store/useViewerStore'
import { VolumeBounds, VolumeMesh, volumeWorldSize } from './VolumeMesh'

const ACCENT = '#2dd4bf'
/** The source volume is ~320铏?in-plane, so this is a 1:1 bitmap in practice. */
const SLICE_TEXTURE_MAX = 320
type CameraControls = ComponentRef<typeof OrbitControls>
const DIRECTIONS = {
  free: [0.66, 0.46, 0.66],
  front: [0, 0, 1],
  back: [0, 0, -1],
  left: [1, 0, 0],
  right: [-1, 0, 0],
  top: [0, 1, 0.0001],
  bottom: [0, -1, 0.0001],
} satisfies Record<string, Vec3>
type CameraRequest = { direction: keyof typeof DIRECTIONS }

/**
 * Frames the volume (or the dental ROI when teeth-only mode is active) for
 * the current pane aspect. A narrow pane pulls the camera back so the whole
 * scan stays visible instead of being cropped.
 */
function frameCamera(
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
  volume: VolumeData,
  teethOnly: boolean,
  dental: DentalRoi | null,
  controls: CameraControls | null,
  request: CameraRequest | null,
): void {
  const aspect = width / Math.max(1, height)
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
  const vertical = (0.95 * 1.12) / tanV
  const horizontal = 1.08 / (tanV * aspect)
  let distance = Math.max(vertical, horizontal)

  const target = new THREE.Vector3(0, 0, 0)
  if (teethOnly && dental) {
    const [min, max] = [dental.voxelBox.min, dental.voxelBox.max]
    const s = volumeWorldSize(volume)
    const cx = (min[0] + max[0]) / 2
    const cy = (min[1] + max[1]) / 2
    const cz = (min[2] + max[2]) / 2
    // uv -> world: x=(u-0.5)*sx, y=(w-0.5)*sy, z=(0.5-v)*sz
    target.set((cx - 0.5) * s[0], (cz - 0.5) * s[1], (0.5 - cy) * s[2])
    const halfExtent = new THREE.Vector3(
      ((max[0] - min[0]) * s[0]) / 2,
      ((max[2] - min[2]) * s[1]) / 2,
      ((max[1] - min[1]) * s[2]) / 2,
    )
    distance *= Math.min(1.4, Math.max(0.3, (halfExtent.length() / 1.22) * 1.55))
  }

  if (controls && request) {
    // Flush orbit inertia before positioning the camera.
    const { enableDamping, autoRotate } = controls
    controls.enableDamping = false
    controls.autoRotate = false
    controls.update()
    controls.enableDamping = enableDamping
    controls.autoRotate = autoRotate
  }
  const direction = new THREE.Vector3(...DIRECTIONS[request?.direction ?? 'free']).normalize()
  camera.position.copy(direction.multiplyScalar(distance).add(target))
  camera.lookAt(target)
  if (controls) {
    controls.target.copy(target)
    controls.update()
  }
}

function CameraRig({ volume, request }: { volume: VolumeData; request: CameraRequest | null }) {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const controls = useThree((s) => s.controls) as CameraControls | null
  const teethOnly = useViewerStore((s) => s.teethOnly)
  const dental = useViewerStore((s) => s.dental)
  const framedRef = useRef(false)

  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return
    if (size.width < 1 || size.height < 1) return
    frameCamera(camera, size.width, size.height, volume, teethOnly, dental, controls, request)
  }, [camera, size, controls, teethOnly, dental, volume, request])

  // First layout pass can report a 0x0 size; the effect above then bails and may
  // never re-run. Frame from the render loop once a real pane size exists.
  useFrame((state) => {
    if (framedRef.current) return
    const width = state.size.width
    const height = state.size.height
    if (width < 1 || height < 1) return
    if (!(state.camera instanceof THREE.PerspectiveCamera)) return
    const store = useViewerStore.getState()
    frameCamera(
      state.camera,
      width,
      height,
      volume,
      store.teethOnly,
      store.dental,
      state.controls as CameraControls | null,
      request,
    )
    framedRef.current = true
  })

  return null
}

/**
 * Reports FPS into the store and slightly adapts resolution so weak GPUs inside
 * a small pane stay interactive. Rebounds only after sustained high FPS.
 */
function PerfProbe() {
  const setFps = useViewerStore((s) => s.setFps)
  const stats = useRef({ frames: 0, elapsed: 0, lastAdjust: 0 })

  useFrame((state, delta) => {
    stats.current.frames += 1
    stats.current.elapsed += delta
    if (stats.current.elapsed >= 1) {
      const fps = stats.current.frames / stats.current.elapsed
      setFps(Math.max(1, Math.round(fps)))
      stats.current.frames = 0
      stats.current.elapsed = 0

      const now = performance.now()
      const dpr = state.viewport.dpr
      if (now - stats.current.lastAdjust > 2000) {
        if (fps < 27 && dpr > 0.76) {
          state.setDpr(Math.max(0.75, dpr - 0.25))
          stats.current.lastAdjust = now
        } else if (fps > 54 && dpr < 1.5) {
          state.setDpr(Math.min(1.5, dpr + 0.25))
          stats.current.lastAdjust = now
        }
      }
    }
  })

  return null
}

/** Rasterizes the axial slice at `z` into the cached 2D canvas (WW/WC mapping). */
function paintAxialSlice(
  canvas: HTMLCanvasElement,
  volume: VolumeData,
  z: number,
  windowCenter: number,
  windowWidth: number,
): void {
  const [w, h, d] = volume.dims
  const cw = canvas.width
  const ch = canvas.height
  const ctx = canvas.getContext('2d')
  if (!ctx || cw < 1 || ch < 1) return

  const image = ctx.createImageData(cw, ch)
  const data = image.data
  const u8 = volume.u8
  const plane = w * h
  const base = Math.max(0, Math.min(d - 1, Math.round(z))) * plane

  const [qMin, qMax] = volume.quantRange
  const huToU8 = 255 / (qMax - qMin)
  const lo = (windowCenter - windowWidth / 2 - qMin) * huToU8
  const hi = (windowCenter + windowWidth / 2 - qMin) * huToU8
  const scale = 255 / Math.max(1e-3, hi - lo)

  let p = 0
  for (let row = 0; row < ch; row++) {
    // Nearest-neighbor only matters for volumes larger than the bitmap cap.
    const y = Math.min(h - 1, Math.floor(((row + 0.5) * h) / ch))
    const rowBase = base + y * w
    for (let col = 0; col < cw; col++) {
      const x = Math.min(w - 1, Math.floor(((col + 0.5) * w) / cw))
      const q = (u8[rowBase + x] - lo) * scale
      const v = q <= 0 ? 0 : q >= 255 ? 255 : q
      data[p] = v
      data[p + 1] = v
      data[p + 2] = v
      data[p + 3] = 255
      p += 4
    }
  }
  ctx.putImageData(image, 0, 0)
}

/**
 * Slices synchronized with the MPR cursor: the current axial slice is drawn as
 * a textured plane at volume z = cursor.z, plus thin outlines marking the
 * coronal/sagittal planes so the crosshair position is visible in 3D.
 *
 * World mapping (matches VolumeMesh + the volume shader):
 *   world x = (uv.x - 0.5) * sx, world y = (uv.z - 0.5) * sy, world z = (0.5 - uv.y) * sz
 * The axial plane is local XY rotated +锜?2 about X, which maps texture top rows
 * (volume y = 0) to world +z, the same orientation as the 2D MPR view.
 */
function SliceSync({ volume }: { volume: VolumeData }) {
  const cursor = useViewerStore((s) => s.cursor)
  const windowCenter = useViewerStore((s) => s.windowCenter)
  const windowWidth = useViewerStore((s) => s.windowWidth)

  const size = useMemo(() => volumeWorldSize(volume), [volume])
  const [sx, sy, sz] = size
  const [w, h, d] = volume.dims

  // One 2D canvas + GPU texture for the whole life of the volume.
  const prepared = useMemo(() => {
    const [vw, vh] = volume.dims
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, SLICE_TEXTURE_MAX / Math.max(vw, vh))
    canvas.width = Math.max(1, Math.round(vw * scale))
    canvas.height = Math.max(1, Math.round(vh * scale))
    const texture = new THREE.CanvasTexture(canvas)
    // Windowed values are display-referred; sRGB round-trips them unchanged.
    texture.colorSpace = THREE.SRGBColorSpace
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    return { canvas, texture }
  }, [volume])

  useEffect(() => () => prepared.texture.dispose(), [prepared])

  // Redraw only when the slice index or the window changes, never per frame.
  useEffect(() => {
    paintAxialSlice(prepared.canvas, volume, cursor.z, windowCenter, windowWidth)
    prepared.texture.needsUpdate = true
  }, [prepared, volume, cursor.z, windowCenter, windowWidth])

  // Crosshair planes at the cursor position in world space.
  const worldX = ((cursor.x + 0.5) / w - 0.5) * sx
  const worldY = ((cursor.z + 0.5) / d - 0.5) * sy
  const worldZ = (0.5 - (cursor.y + 0.5) / h) * sz
  const sliceWidth = sx
  const sliceDepth = sz

  // Unit square border shared by both crosshair outlines.
  const outline = useMemo(() => new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), [])
  useEffect(() => () => outline.dispose(), [outline])

  return (
    <>
      <mesh position={[0, worldY, 0]} rotation={[Math.PI / 2, 0, 0]} renderOrder={5}>
        <planeGeometry args={[sliceWidth, sliceDepth]} />
        <meshBasicMaterial
          map={prepared.texture}
          transparent
          opacity={0.42}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* coronal plane (volume y) */}
      <lineSegments
        geometry={outline}
        position={[0, 0, worldZ]}
        scale={[sx, sy, 1]}
        renderOrder={6}
      >
        <lineBasicMaterial
          color={ACCENT}
          transparent
          opacity={0.7}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>

      {/* sagittal plane (volume x) */}
      <lineSegments
        geometry={outline}
        position={[worldX, 0, 0]}
        rotation={[0, Math.PI / 2, 0]}
        scale={[sz, sy, 1]}
        renderOrder={6}
      >
        <lineBasicMaterial
          color={ACCENT}
          transparent
          opacity={0.7}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
    </>
  )
}

function SceneContent({ volume, request }: { volume: VolumeData; request: CameraRequest | null }) {
  const autoRotate = useViewerStore((s) => s.autoRotate)
  const showGrid = useViewerStore((s) => s.showGrid)
  const size = useMemo(() => volumeWorldSize(volume), [volume])
  const floorY = -size[1] / 2 - 0.26

  return (
    <>
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.075}
        rotateSpeed={0.75}
        zoomSpeed={0.8}
        panSpeed={0.6}
        minDistance={0.6}
        maxDistance={16}
        autoRotate={autoRotate}
        autoRotateSpeed={0.6}
      />
      <VolumeMesh volume={volume} />
      <VolumeBounds />
      <SliceSync volume={volume} />
      {showGrid && (
        <Grid
          position={[0, floorY, 0]}
          args={[8, 8]}
          cellSize={0.08}
          cellThickness={0.5}
          cellColor="#1b2f3d"
          sectionSize={0.4}
          sectionThickness={0.9}
          sectionColor="#0e5c70"
          fadeDistance={5}
          fadeStrength={1.4}
          fadeFrom={1}
          infiniteGrid
        />
      )}
      <PerfProbe />
      <CameraRig volume={volume} request={request} />
    </>
  )
}

/**
 * Embeddable 3D volume pane. Fills its parent (parent must be positioned and
 * have a definite size).
 */
export function VolumeViewport() {
  const volume = useViewerStore((s) => s.volume)
  const lang = useViewerStore((s) => s.lang)
  const setAutoRotate = useViewerStore((s) => s.setAutoRotate)
  const [request, setRequest] = useState<CameraRequest | null>(null)

  if (!volume) return null

  return (
    <div className="relative h-full w-full">
      <Canvas
        className="h-full w-full"
        dpr={[1, 2]}
        camera={{ fov: 31, position: [2.5, 1.72, 2.5], near: 0.05, far: 80 }}
        gl={{ antialias: true, alpha: true }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.NoToneMapping
          gl.setClearAlpha(0)
        }}
      >
        <SceneContent volume={volume} request={request} />
      </Canvas>
      <select
        aria-label={translate(lang, 'volume.direction')}
        value=""
        onChange={(event) => {
          setAutoRotate(false)
          setRequest({ direction: event.currentTarget.value as CameraRequest['direction'] })
        }}
        className="absolute right-2 top-2 rounded border border-teal-300/35 bg-[#07121a] px-2 py-1 text-[11px] text-teal-100 focus-visible:outline focus-visible:outline-teal-300"
      >
        <option value="" disabled>{translate(lang, 'volume.direction')}</option>
        {(Object.keys(DIRECTIONS) as CameraRequest['direction'][]).map((direction) => (
          <option key={direction} value={direction}>{translate(lang, `volume.direction.${direction}`)}</option>
        ))}
      </select>
    </div>
  )
}


