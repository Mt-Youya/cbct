import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useViewerStore } from '../store/useViewerStore'
import { buildTransferLut, PRESET_BY_ID } from '../data/presets'
import { volumeFragmentShader, volumeVertexShader } from './volumeShader'
import type { VolumeData } from '../types'

const MODE_INDEX: Record<string, number> = { composite: 0, mip: 1, xray: 2 }

function createVolumeTexture(volume: VolumeData): THREE.Data3DTexture {
  const [w, h, d] = volume.dims
  const texture = new THREE.Data3DTexture(volume.u8, w, h, d)
  texture.format = THREE.RedFormat
  texture.type = THREE.UnsignedByteType
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.wrapR = THREE.ClampToEdgeWrapping
  texture.unpackAlignment = 1
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

/**
 * Physical box extents in world units, ordered for three.js:
 * [x, y=slices, z=rows]. Longest physical axis is normalized to 1.6.
 */
export function volumeWorldSize(volume: VolumeData): [number, number, number] {
  const [w, h, d] = volume.dims
  const [sx, sy, sz] = volume.spacing
  const physical = [w * sx, h * sy, d * sz]
  const unit = 1.6 / Math.max(...physical)
  return [physical[0] * unit, physical[2] * unit, physical[1] * unit]
}

export function VolumeMesh({ volume }: { volume: VolumeData }) {
  const presetId = useViewerStore((s) => s.presetId)
  const opacity = useViewerStore((s) => s.opacity)
  const steps = useViewerStore((s) => s.steps)
  const clip = useViewerStore((s) => s.clip)
  const teethOnly = useViewerStore((s) => s.teethOnly)
  const dental = useViewerStore((s) => s.dental)
  const preset = PRESET_BY_ID[presetId]

  const crop = useMemo(() => {
    if (!teethOnly || !dental) {
      return { enabled: 0, min: new THREE.Vector3(0, 0, 0), max: new THREE.Vector3(1, 1, 1) }
    }
    const box = dental.voxelBox
    return {
      enabled: 1,
      min: new THREE.Vector3(box.min[0], box.min[1], box.min[2]),
      max: new THREE.Vector3(box.max[0], box.max[1], box.max[2]),
    }
  }, [teethOnly, dental])

  const size = useMemo(() => volumeWorldSize(volume), [volume])
  const [w, h, d] = volume.dims

  const volumeTexture = useMemo(() => createVolumeTexture(volume), [volume])
  useEffect(() => () => volumeTexture.dispose(), [volumeTexture])

  const lutData = useMemo(() => buildTransferLut(preset, volume.quantRange), [preset, volume.quantRange])
  const lutTexture = useMemo(() => {
    const texture = new THREE.DataTexture(lutData, 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType)
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.generateMipmaps = false
    texture.needsUpdate = true
    return texture
  }, [lutData])
  useEffect(() => () => lutTexture.dispose(), [lutTexture])

  const material = useMemo(() => 
    new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: volumeVertexShader,
      fragmentShader: volumeFragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      toneMapped: false,
      uniforms: {
        uVolume: { value: volumeTexture },
        uTF: { value: lutTexture },
        uSize: { value: new THREE.Vector3(size[0], size[1], size[2]) },
        uVoxelStep: { value: new THREE.Vector3(1 / w, 1 / h, 1 / d) },
        uLightDir: { value: new THREE.Vector3(0.42, 0.88, 0.5).normalize() },
        uSteps: { value: steps },
        uOpacity: { value: opacity },
        uClipZ: { value: clip },
        uDensityMin: { value: preset.densityMin },
        uExposure: { value: preset.exposure },
        uCropEnabled: { value: crop.enabled },
        uCropMin: { value: crop.min.clone() },
        uCropMax: { value: crop.max.clone() },
        uMode: { value: MODE_INDEX[preset.mode] ?? 0 },
      },
    })
  , [volumeTexture, lutTexture, size, w, h, d, steps, opacity, clip, preset, crop])

  useEffect(() => () => material.dispose(), [material])

  useEffect(() => {
    material.uniforms.uCropEnabled.value = crop.enabled
    material.uniforms.uCropMin.value.copy(crop.min)
    material.uniforms.uCropMax.value.copy(crop.max)
  }, [material, crop])

  return (
    <mesh material={material} scale={size} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
    </mesh>
  )
}

export function VolumeBounds() {
  const volume = useViewerStore((s) => s.volume)
  const showBox = useViewerStore((s) => s.showBox)
  const size = useMemo(() => (volume ? volumeWorldSize(volume) : null), [volume])
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), [])
  useEffect(() => () => edges.dispose(), [edges])

  if (!size || !showBox) return null
  return (
    <lineSegments geometry={edges} scale={size} renderOrder={2}>
      <lineBasicMaterial color="#2f93a3" transparent opacity={0.16} depthWrite={false} toneMapped={false} />
    </lineSegments>
  )
}
