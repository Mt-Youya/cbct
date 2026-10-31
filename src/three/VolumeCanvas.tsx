import { useEffect, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { useViewerStore } from '../store/useViewerStore'
import { VolumeBounds, VolumeMesh, volumeWorldSize } from './VolumeMesh'

/**
 * Frames the volume for the current viewport aspect. Phones are far narrower
 * than the volume is wide, so the camera pulls back to keep the whole scan in
 * view instead of cropping it.
 */
function CameraRig() {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const aspectRef = useRef(0)

  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return
    const aspect = size.width / Math.max(1, size.height)
    if (Math.abs(aspect - aspectRef.current) < 0.01) return
    aspectRef.current = aspect
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
    const vertical = (0.95 * 1.12) / tanV
    const horizontal = 1.2 / (tanV * aspect)
    const distance = Math.max(vertical, horizontal)
    const direction = new THREE.Vector3(0.66, 0.46, 0.66).normalize()
    camera.position.copy(direction.multiplyScalar(distance))
    camera.lookAt(0, 0, 0)
  }, [camera, size])

  return null
}

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

      // Gentle adaptive resolution so weaker GPUs stay interactive. Rebounds
      // only after a sustained high frame rate, with a 2s cooldown.
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

function SceneContent() {
  const volume = useViewerStore((s) => s.volume)
  const autoRotate = useViewerStore((s) => s.autoRotate)
  const showGrid = useViewerStore((s) => s.showGrid)
  const floorY = volume ? -volumeWorldSize(volume)[1] / 2 - 0.26 : -0.76

  return (
    <>
      <OrbitControls
        makeDefault
        target={[0, 0, 0]}
        enableDamping
        dampingFactor={0.075}
        rotateSpeed={0.75}
        zoomSpeed={0.8}
        panSpeed={0.6}
        minDistance={0.4}
        maxDistance={16}
        autoRotate={autoRotate}
        autoRotateSpeed={0.9}
      />
      {volume && <VolumeMesh volume={volume} />}
      <VolumeBounds />
      {showGrid && (
        <Grid
          position={[0, floorY, 0]}
          args={[10, 10]}
          cellSize={0.1}
          cellThickness={0.6}
          cellColor="#22384a"
          sectionSize={0.5}
          sectionThickness={1}
          sectionColor="#12718a"
          fadeDistance={6}
          fadeStrength={1.2}
          infiniteGrid
        />
      )}
      <PerfProbe />
      <CameraRig />
    </>
  )
}

export function VolumeCanvas() {
  return (
    <Canvas
      className="volume-canvas"
      dpr={[1, 1.75]}
      gl={{
        antialias: false,
        alpha: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false,
        stencil: false,
      }}
      camera={{ position: [2.5, 1.72, 2.5], fov: 31, near: 0.01, far: 60 }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.NoToneMapping
        gl.setClearAlpha(0)
      }}
      onPointerMissed={() => {
        /* keep orbit interactions from clearing selection; noop by design */
      }}
    >
      <SceneContent />
    </Canvas>
  )
}
