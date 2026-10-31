import type { Lang, PresetId } from './types'

export type MessageKey =
  | 'app.tagline'
  | 'top.look'
  | 'top.grid'
  | 'top.fps'
  | 'top.patient'
  | 'top.mpr'
  | 'top.lang'
  | 'multiplanar'
  | 'case'
  | 'patient'
  | 'studyDate'
  | 'modality'
  | 'scanner'
  | 'exposure'
  | 'volume'
  | 'matrix'
  | 'native'
  | 'voxel'
  | 'huRange'
  | 'quantized'
  | 'slices'
  | 'axialDicom'
  | 'rayMarchLook'
  | 'opacity'
  | 'samples'
  | 'cutPlane'
  | 'off'
  | 'autoRotate'
  | 'bounds'
  | 'grid'
  | 'renderNote'
  | 'teethOnly'
  | 'teethOnlyHint'
  | 'teethUnavailable'
  | 'window'
  | 'axial'
  | 'coronal'
  | 'sagittal'
  | 'clickScroll'
  | 'px'
  | 'mm'
  | 'voxelCursor'
  | 'hints.drag'
  | 'hints.zoom'
  | 'hints.pan'
  | 'hints.looks'
  | 'hints.space'
  | 'hints.panels'
  | 'loading.kicker'
  | 'loading.title'
  | 'loading.volumeReady'
  | 'loading.initializing'
  | 'loading.meta'
  | 'loading.volume'
  | 'loading.ready'
  | 'loading.errorTitle'
  | 'loading.errorHint'
  | 'loading.slices'
  | 'win.bone'
  | 'win.soft'
  | 'win.dental'
  | 'win.full'
  | 'preset.teeth'
  | 'preset.bone'
  | 'preset.dental'
  | 'preset.soft'
  | 'preset.mip'
  | 'preset.xray'
  | 'preset.heat'
  | 'preset.teal'
  | 'layout.quad'
  | 'layout.mpr'
  | 'layout.3d'
  | 'settings'
  | 'settings.title'
  | 'toolbar.window'
  | 'toolbar.render'
  | 'pane.volume'
  | 'status.cursor'
  | 'status.window'
  | 'status.dataset'
  | 'status.tips'
  | 'zoom.in'
  | 'zoom.out'
  | 'zoom.fit'
  | 'pane.orientation'
  | 'start.title'
  | 'start.subtitle'
  | 'start.openFolder'
  | 'start.pickFiles'
  | 'start.sample'
  | 'start.drop'
  | 'start.formats'
  | 'start.privacy'
  | 'start.newStudy'
  | 'loading.import'
  | 'loading.parse'
  | 'loading.importVolume'
  | 'loading.importRoi'
  | 'ui.font'
  | 'ui.fontHint'
  | 'ui.small'
  | 'ui.normal'
  | 'ui.large'
  | 'ui.xlarge'

const ZH: Record<MessageKey, string> = {
  'app.tagline': 'three.js · react-three-fiber · zustand',
  'top.look': '风格',
  'top.grid': '网格',
  'top.fps': '帧率',
  'top.patient': '患者',
  'top.mpr': '多平面',
  'top.lang': 'EN',
  multiplanar: '多平面重建',
  case: '病例',
  patient: '患者',
  studyDate: '检查日期',
  modality: '检查类型',
  scanner: '设备',
  exposure: '曝光',
  volume: '体数据',
  matrix: '矩阵',
  native: '原始',
  voxel: '体素',
  huRange: 'HU 范围',
  quantized: '8-bit 量化',
  slices: '层数',
  axialDicom: '轴位 DICOM',
  rayMarchLook: '体渲染风格',
  opacity: '不透明度',
  samples: '采样数',
  cutPlane: '剖切面',
  off: '关闭',
  autoRotate: '自动旋转',
  bounds: '包围盒',
  grid: '网格',
  renderNote: '拖动旋转 · 滚轮缩放 · 右键平移。按键 1–7 切换风格，空格暂停旋转。',
  teethOnly: '只看牙齿',
  teethOnlyHint: '裁剪到牙弓区域并增强牙体',
  teethUnavailable: '牙弓 ROI 数据缺失',
  window: '窗宽窗位',
  axial: '轴位',
  coronal: '冠状位',
  sagittal: '矢状位',
  clickScroll: '点击/滚轮',
  px: '像素',
  mm: '毫米',
  voxelCursor: '体素',
  'hints.drag': '拖动旋转',
  'hints.zoom': '滚轮缩放',
  'hints.pan': '右键平移',
  'hints.looks': '1–7 风格',
  'hints.space': '空格自动旋转',
  'hints.panels': 'M / P 面板',
  'loading.kicker': 'DICOM · 体数据重建',
  'loading.title': '体绘制',
  'loading.volumeReady': '体数据就绪',
  'loading.initializing': '初始化中',
  'loading.meta': '读取元数据',
  'loading.volume': '下载体数据',
  'loading.ready': '就绪',
  'loading.errorTitle': '体数据加载失败',
  'loading.errorHint': '请先运行 pnpm prepare-volume 生成体积资产，然后刷新页面。',
  'loading.slices': '层',
  'win.bone': '骨窗',
  'win.soft': '软组织',
  'win.dental': '牙科',
  'win.full': '全范围',
  'preset.teeth': '牙齿',
  'preset.bone': '骨窗',
  'preset.dental': '牙科',
  'preset.soft': '软组织',
  'preset.mip': 'MIP',
  'preset.xray': 'X 光',
  'preset.heat': '热力',
  'preset.teal': '青色',
  'layout.quad': '2×2',
  'layout.mpr': '多平面',
  'layout.3d': '3D',
  settings: '设置',
  'settings.title': '显示与渲染设置',
  'toolbar.window': '窗宽窗位',
  'toolbar.render': '渲染风格',
  'pane.volume': '3D 体渲染',
  'status.cursor': '体素',
  'status.window': '窗宽窗位',
  'status.dataset': '体数据',
  'status.tips': '滚轮翻层 · 单击定位 · 右键拖拽平移 · Ctrl+滚轮缩放',
  'zoom.in': '放大',
  'zoom.out': '缩小',
  'zoom.fit': '适应窗口',
  'pane.orientation': '方位',
  'start.title': '打开 CBCT 影像',
  'start.subtitle': '在浏览器内重建 DICOM 体数据，文件不会上传到服务器。',
  'start.openFolder': '打开 CBCT 文件夹',
  'start.pickFiles': '选择 DICOM 文件',
  'start.sample': '加载示例病例',
  'start.drop': '或把 DICOM 文件夹拖到这里',
  'start.formats': '支持未压缩 16-bit CT / CBCT DICOM（单序列即可）',
  'start.privacy': '全部计算在本机浏览器完成 · 无服务端上传',
  'start.newStudy': '打开新的 CBCT',
  'loading.import': '读取 DICOM 文件',
  'loading.parse': '解析 DICOM 切片',
  'loading.importVolume': '重建体数据',
  'loading.importRoi': '分析牙弓区域',
  'ui.font': '界面字号',
  'ui.fontHint': '调整整个界面的文字大小（浏览器会记住）',
  'ui.small': '小',
  'ui.normal': '标准',
  'ui.large': '大',
  'ui.xlarge': '特大',
}

const EN: Record<MessageKey, string> = {
  'app.tagline': 'three.js · react-three-fiber · zustand',
  'top.look': 'LOOK',
  'top.grid': 'GRID',
  'top.fps': 'FPS',
  'top.patient': 'Patient',
  'top.mpr': 'MPR',
  'top.lang': '中文',
  multiplanar: 'Multiplanar',
  case: 'Case',
  patient: 'Patient',
  studyDate: 'Study date',
  modality: 'Modality',
  scanner: 'Scanner',
  exposure: 'Exposure',
  volume: 'Volume',
  matrix: 'Matrix',
  native: 'native',
  voxel: 'Voxel',
  huRange: 'HU range',
  quantized: '8-bit quantized',
  slices: 'Slices',
  axialDicom: 'axial DICOM',
  rayMarchLook: 'Ray-march look',
  opacity: 'Opacity',
  samples: 'Samples',
  cutPlane: 'Cut plane',
  off: 'off',
  autoRotate: 'Auto-rotate',
  bounds: 'Bounds',
  grid: 'Grid',
  renderNote: 'Drag to orbit · scroll to zoom · right-drag to pan. Keys 1–7 switch looks, space pauses rotation.',
  teethOnly: 'Teeth only',
  teethOnlyHint: 'Crop to the dental arch and boost tooth density',
  teethUnavailable: 'Dental ROI data missing',
  window: 'Window',
  axial: 'Axial',
  coronal: 'Coronal',
  sagittal: 'Sagittal',
  clickScroll: 'click / scroll',
  px: 'px',
  mm: 'mm',
  voxelCursor: 'voxel',
  'hints.drag': 'Drag orbit',
  'hints.zoom': 'Scroll zoom',
  'hints.pan': 'Right-drag pan',
  'hints.looks': '1–7 looks',
  'hints.space': 'Space auto-rotate',
  'hints.panels': 'M / P panels',
  'loading.kicker': 'DICOM · VOLUME RECONSTRUCTION',
  'loading.title': 'volume render',
  'loading.volumeReady': 'Volume ready',
  'loading.initializing': 'Initializing',
  'loading.meta': 'Reading volume metadata',
  'loading.volume': 'Downloading volume',
  'loading.ready': 'Ready',
  'loading.errorTitle': 'Unable to load the volume',
  'loading.errorHint': 'Generate the web assets first: pnpm prepare-volume, then reload.',
  'loading.slices': 'slices',
  'win.bone': 'Bone',
  'win.soft': 'Soft tissue',
  'win.dental': 'Dental',
  'win.full': 'Full range',
  'preset.teeth': 'Teeth',
  'preset.bone': 'Bone',
  'preset.dental': 'Dental',
  'preset.soft': 'Soft',
  'preset.mip': 'MIP',
  'preset.xray': 'X-ray',
  'preset.heat': 'Heat',
  'preset.teal': 'Teal',
  'layout.quad': '2×2',
  'layout.mpr': 'MPR',
  'layout.3d': '3D',
  settings: 'Settings',
  'settings.title': 'Display & render settings',
  'toolbar.window': 'Window / level',
  'toolbar.render': 'Render look',
  'pane.volume': '3D Volume',
  'status.cursor': 'Voxel',
  'status.window': 'Window',
  'status.dataset': 'Volume',
  'status.tips': 'Wheel slices · click to crosshair · right-drag pan · Ctrl+wheel zoom',
  'zoom.in': 'Zoom in',
  'zoom.out': 'Zoom out',
  'zoom.fit': 'Fit',
  'pane.orientation': 'Orientation',
  'start.title': 'Open a CBCT study',
  'start.subtitle': 'Reconstruct the DICOM volume locally in your browser. Nothing is uploaded.',
  'start.openFolder': 'Open DICOM folder',
  'start.pickFiles': 'Choose DICOM files',
  'start.sample': 'Load sample study',
  'start.drop': 'or drop a DICOM folder here',
  'start.formats': 'Uncompressed 16-bit CT / CBCT DICOM, one series',
  'start.privacy': 'Everything runs on this device · no server upload',
  'start.newStudy': 'Open another CBCT',
  'loading.import': 'Reading DICOM files',
  'loading.parse': 'Parsing DICOM slices',
  'loading.importVolume': 'Building volume',
  'loading.importRoi': 'Analyzing dental arch',
  'ui.font': 'Interface text size',
  'ui.fontHint': 'Scales all interface text (remembered by this browser)',
  'ui.small': 'Small',
  'ui.normal': 'Normal',
  'ui.large': 'Large',
  'ui.xlarge': 'Extra large',
}

const DICT: Record<Lang, Record<MessageKey, string>> = { zh: ZH, en: EN }

export function translate(lang: Lang, key: MessageKey): string {
  return DICT[lang][key] ?? key
}

export function presetLabel(lang: Lang, id: PresetId): string {
  return translate(lang, `preset.${id}` as MessageKey)
}

export function windowLabel(lang: Lang, id: string, fallback: string): string {
  const key = `win.${id}` as MessageKey
  return key in ZH ? translate(lang, key) : fallback
}
