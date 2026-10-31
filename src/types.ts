export type Vec3 = [number, number, number]

export type Lang = 'zh' | 'en'

export interface WindowPreset {
  id: string
  label: string
  center: number
  width: number
}

export interface VolumeMeta {
  schema: string
  generatedAt: string
  source: {
    directory: string
    sliceCount: number
    slicePattern: string
  }
  patient: {
    id: string
    name: string
    latinName: string
    sex: string
    age: string
    birthDate: string
  }
  study: {
    date: string
    time: string
    modality: string
    manufacturer: string
    model: string
    kvp: number | null
    exposureTime: number | null
    xrayCurrent: number | null
    doseProduct: number | null
    scanType: string
  }
  volume: {
    dims: Vec3
    spacing: Vec3
    originalDims: Vec3
    originalSpacing: Vec3
    downsampleFactor: number
    huRange: [number, number]
    quantRange: [number, number]
    dataType: { u8: string; i16?: string }
    byteOrder: string
    layout: string
  }
  files: {
    u8: string
    i16?: string
    thumbnail: string | null
    dental?: string
  }
  windows: WindowPreset[]
}

/** Normalized voxel box produced by the dental ROI analysis. */
export interface DentalRoi {
  version: number
  voxelBox: { min: Vec3; max: Vec3 }
  worldBoxMm?: { min: Vec3; max: Vec3 }
  hu?: { toothMin?: number; enamelMin?: number; boneMin?: number }
  stats?: Record<string, unknown>
}

/** CPU-side volume; the same uint8 data feeds both the 3D texture and the MPR views. */
export interface VolumeData {
  u8: Uint8Array
  dims: Vec3
  spacing: Vec3
  quantRange: [number, number]
}

export interface Cursor {
  x: number
  y: number
  z: number
}

export type RenderMode = 'composite' | 'mip' | 'xray'

export type PresetId = 'teeth' | 'bone' | 'dental' | 'soft' | 'mip' | 'xray' | 'heat' | 'teal'

export type MprAxis = 'axial' | 'coronal' | 'sagittal'
