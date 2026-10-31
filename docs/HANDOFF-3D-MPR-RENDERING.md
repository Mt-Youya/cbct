# 3D VolumeViewport 与 MPR 渲染 — AI Agent 交接文档

> 读者：接手的下一个 AI agent（无本次会话上下文）。
> 范围：3D 体渲染窗格 + 2D 多平面（MPR）窗格 + 二者同步；不覆盖 DICOM 解析、UI chrome、部署。
> 关联文档：`docs/HANDOFF-UI-UX.md`、`docs/HANDOFF-DICOM-DATA.md`、`docs/HANDOFF-QA.md`、`docs/HANDOFF-DEPLOY.md`。

## 1. 当前状态 / 范围

- 应用是“临床阅片工作台”：`2×2`（轴位/冠状位/矢状位/3D）、`多平面`（3 个 MPR）、`3D`（单窗格）三种布局，由 `src/ui/Workspace.tsx` 组合；布局值 `quad|mpr|3d` 存在 zustand store 的 `layout`。
- 3D 窗格 = `src/three/VolumeViewport.tsx` 的 `VolumeViewport`；MPR 窗格 = `src/ui/viewport/MprViewport.tsx` 的 `MprViewport`（各画一张 2D canvas，不用 WebGL）。
- 数据只有 uint8 一种格式：示例为 `320×320×200 @ 0.5 mm`，`quantRange=[-1024, 3400]`；`public/data/volume_u8.bin`（约 20 MB，被 gitignore）+ `volume.json` + `dental.json`。
- 已实现：光线步进体渲染（composite/mip/xray 三种模式 + 8 个预设）、按窗格/ROI 的相机取景、FPS 上报 + 自适应 DPR、3D 轴位切片联动（CanvasTexture）与十字线平面线框、MPR 翻层/定位/缩放/平移/十字线/方位字母/10 mm 标尺。
- 已知遗留：`src/three/VolumeCanvas.tsx`、`src/ui/MprPanel.tsx` 已无任何 import（legacy 参考实现，可删）；`src/three/VolumeViewport.tsx` 第 10/185 行注释有历史 mojibake（仅注释，不影响编译；`README.md`、`tools/qa/qa2.mjs` 已扫描确认为正常 UTF-8）；3D 仅轴位有纹理切片，冠状/矢状只有线框；切片平面始终按整个 volume 的 X/Z 尺度绘制。

## 2. 关键文件与接口

### 2.1 3D 体渲染

- `src/three/VolumeViewport.tsx` — 唯一导出 `export function VolumeViewport()`；`volume == null` 时返回 `null`（父容器必须有 `position: relative` + 明确高度）。
  - 内部符号：`frameCamera(camera, width, height, volume, teethOnly, dental, controls)`、`CameraRig({volume})`、`PerfProbe()`、`paintAxialSlice(canvas, volume, z, windowCenter, windowWidth)`、`SliceSync({volume})`、`SceneContent({volume})`；常量 `ACCENT='#2dd4bf'`、`SLICE_TEXTURE_MAX=320`。
  - Canvas 参数：`dpr={[1,2]}`、`camera={{fov:31, position:[2.5,1.72,2.5], near:0.05, far:80}}`、`gl={{antialias:true, alpha:true}}`、`onCreated` 里 `gl.toneMapping=THREE.NoToneMapping` + `gl.setClearAlpha(0)`（透明背景）。
  - 场景：`OrbitControls`（`makeDefault`、damping 0.075、`minDistance=0.6`、`maxDistance=16`、`autoRotateSpeed=0.6`）+ `VolumeMesh` + `VolumeBounds` + `SliceSync` + 可选 drei `Grid` + `PerfProbe` + `CameraRig`。
- `src/three/VolumeMesh.tsx` — 导出 `volumeWorldSize(volume): [number,number,number]`、`VolumeMesh({volume})`、`VolumeBounds()`；私有 `createVolumeTexture`、`MODE_INDEX`。
  - `volumeWorldSize`：物理尺寸 `[w*sx, h*sy, d*sz]`，按最长轴归一到 `1.6`，返回 three 轴顺序 `[physX, physZ, physY] * unit`（即 `[x, y=volume z, z=volume y]`）。
- `src/three/volumeShader.ts` — 导出字符串 `volumeVertexShader`、`volumeFragmentShader`（GLSL3，WebGL2 `sampler3D`）。
  - uniforms：`uVolume`、`uTF`（256×1 RGBA LUT）、`uSize`（world 尺寸）、`uVoxelStep`（`1/dims`）、`uLightDir`、`uSteps`、`uOpacity`、`uClipZ`、`uDensityMin`、`uExposure`、`uCropEnabled`、`uCropMin/Max`、`uMode`（0 composite / 1 mip / 2 xray）；`MAX_STEPS=512`。
- 预设/传递函数：`src/data/presets.ts` — 导出 `PRESETS`（8 个）、`PRESET_BY_ID`、`huToNorm`、`buildTransferLut(preset, quantRange)`（HU 阈值 → 256×1 RGBA）、`defaultWindow(meta)`（默认骨窗 600/2600）。

### 2.2 MPR（2D）

- `src/ui/viewport/MprViewport.tsx` — 唯一导出 `export function MprViewport({ axis, className = '' }: { axis: MprAxis; className?: string })`。
  - 内部：`ORIENT`（方位字母）、`SPACING_INDEX`、`sliceKey()`（缓存键）、`buildSliceImage()`（CPU 生成整层 ImageData）、`ViewLayout`、`draw()`（letterbox 适配 + 叠加层）。
  - 交互：滚轮翻层、左键点击/拖拽定位十字线、右键/中键/Shift+左键拖拽平移、Ctrl/Meta+滚轮缩放、双击复位、`+ / − / F` 按钮；`ResizeObserver` 监听容器；DPR 画布。
- `src/data/mpr.ts` — 导出 `MprDisplay`（interface）、`mprDisplay(axis, dims, cursor)`、`drawMpr(canvas, volume, axis, cursor, wc, ww)`、`pickMpr(axis, dims, u, v)`。
  - 注意：`drawMpr` 只被 legacy `src/ui/MprPanel.tsx` 使用（当前未挂载）；`MprViewport` 只用 `mprDisplay`/`pickMpr`，自己 `buildSliceImage`（带缓存、DPR、letterbox、方位字母、标尺）。

### 2.3 组合与状态

- `src/ui/Workspace.tsx` — 唯一导出 `export function Workspace()`；内部 `Pane({title, info, children})` 提供窗格 chrome、`useMediaQuery`。
  - **关键**：3D 窗格挂载 `<VolumeViewport key={`${meta.source.directory}|${meta.volume.dims.join('x')}`} />` —— 换病例/导入后重建 Canvas；MPR 窗格 key 用 `axis`。
  - `Pane` 的 `section` 类名包含 `relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden`，内容区 `relative min-h-0 flex-1`；网格子项外层为 `flex min-h-0 min-w-0`。移动端 `<900px` 单窗格 + 页签。
- `src/store/useViewerStore.ts` — 导出 `useViewerStore`、类型 `WorkspaceLayout`；本子系统相关状态/方法：
  - 数据：`volume`、`meta`、`dental`、`status`、`preview`；
  - 渲染：`presetId`、`teethOnly`、`opacity`、`steps`、`clip`、`autoRotate`、`showBox`、`showGrid`、`fps`；
  - 同步：`cursor:{x,y,z}`、`windowCenter`、`windowWidth`；
  - 动作：`setCursor`（按 dims clamp）、`nudgeCursor(axis, delta)`、`setWindow(center,width)`、`setPreset`、`setTeethOnly`、`setFps`、`setLayout`、`setUiScale`。
  - `src/main.tsx` 仅在 `import.meta.env.DEV` 暴露 `window.__viewer = useViewerStore`（QA 和手动调试依赖，勿删）。
- `src/types.ts` — `Vec3`、`VolumeMeta`、`DentalRoi`、`VolumeData {u8, dims, spacing, quantRange}`、`Cursor`、`PresetId`、`MprAxis`、`RenderMode`。
- 数据辅助：`src/data/volumeLoader.ts`（`fetchVolumeMeta`/`fetchVolumeData`/`fetchDentalRoi`、`huFromU8`/`u8FromHu`/`huAtVoxel`）、`src/data/dentalRoi.ts`（`computeDentalRoi`）、`src/data/dicomImport.ts`（`importDicomFiles(files, onProgress)`）。
- 3D/MPR 之外的 chrome 在 `src/ui/TopBar.tsx`、`src/ui/ClinicalBar.tsx`、`src/ui/StatusBar.tsx`、`src/ui/SettingsDrawer.tsx`、`src/ui/LoadingOverlay.tsx`，不属于本文范围。

## 3. 必须理解的约定（改代码前先确认）

### 3.1 `uv = (x, y, z)` 轴顺序

- `VolumeData.u8` 的线性索引：`index = (z * h + y) * w + x`（先 x 后 y 后 z）。
- 3D 纹理采样坐标 `uv =(u, v, w)` 对应 `(volume x, volume y, volume z)` 的 0..1 归一化；`uVoxelStep = (1/w, 1/h, 1/d)`。
- `dental.voxelBox.min/max`、`uCropMin/uCropMax`、shader 裁剪判断都用同一套 `uv` 归一化空间（`x,y,z` 顺序），不要混入 three 的 world 轴。

### 3.2 体积 UV → world 映射（与 `volumeWorldSize`/shader 完全一致）

- `world.x = (uv.x - 0.5) * size[0]`
- `world.y = (uv.z - 0.5) * size[1]`（**volume z = 层号轴 → world +y**）
- `world.z = (0.5 - uv.y) * size[2]`（**volume y = 行号轴 → world −z**）
- 因此 `size = [physX, physZ, physY] * unit`（`unit = 1.6 / max(phys)`）。示例 320×320×200 @0.5 mm → `size = [1.6, 1.0, 1.6]`。
- 相机取景/`SliceSync`/`VolumeBounds`/`camera.lookAt` 必须全部用这套坐标；新加物体时先用它换算。

### 3.3 MPR 放射学显示约定

- 轴位（normal `z`）：图像宽 `w`、高 `h`；行 = volume y（0 在上 = 前 A，向下 = 后 P）；列 = volume x（左标 R、右标 L）。
- 冠状位（normal `y`）：宽 `w`、高 `d`；行 = `z = d-1-row`（上 S、下 I）；列 = volume x（左 R、右 L）。
- 矢状位（normal `x`）：宽 `h`、高 `d`；行 = `z = d-1-row`（上 S、下 I）；列 = volume y（左 A、右 P）。
- 即“患者右侧显示在图像左侧”的放射学约定：`ORIENT = { axial: [A,P,R,L], coronal: [S,I,R,L], sagittal: [S,I,A,P] }`（上/下/左/右）。不要为了“看起来正常”翻转 volume 或 MPR 行序；3D 切片方向也要与它一致。
- `pickMpr(axis, dims, u, v)` 使用 letterbox 后的图像内归一化坐标（`MprViewport` 用 `viewRef` 的 offset/scale 反算）；`v` 方向在冠状/矢状要做 `z = d-1-floor(v*d)`。

### 3.4 dental ROI 的 UV 包围盒

- `DentalRoi.voxelBox.min/max` 是 0..1 的 **volume x,y,z 归一化体素框**，`max = (voxelIndex+1)/dim`（上界偏“开区间”）；`worldBoxMm` 只是 mm 换算信息。
- `VolumeMesh` 裁剪：`teethOnly && dental` 才启用 `uCropEnabled=1`，`uCropMin/Max = voxelBox`（同一 uv 空间）。
- 相机取景的 ROI 中心/半尺寸换算：`target=( (cx-0.5)*size[0], (cz-0.5)*size[1], (0.5-cy)*size[2] )`，半尺寸元组顺序为 `(x 轴, z 轴→world y, y 轴→world z)`；`distance` 再乘 `clamp(halfExtent.length()/1.22 * 1.55, 0.3, 1.4)`。
- 无 dental（`dental == null`）时：不做任何裁剪，`teethOnly` 不允许被置 true（见坑 5）。

### 3.5 u8 / quantRange / HU / 窗宽窗位

- 编码：`u8 = clamp(round((HU - qMin)/(qMax - qMin) * 255), 0, 255)`；反解：`HU = qMin + u8/255 * (qMax - qMin)`（`volumeLoader.huFromU8/u8FromHu`）。示例 `qMin=-1024, qMax=3400`。
- 体渲染：密度 = `texture(uVolume, uv).r`（0..1 归一化），查 256×1 LUT（`buildTransferLut(preset, quantRange)`，按 HU 生成 stop 颜色/alpha）；`steps`、`opacity`、`densityMin`、`exposure` 来自当前 preset。
- MPR/3D 切片窗宽窗位（同一公式）：`huToU8 = 255/(qMax-qMin)`，`lo=(WC-WW/2-qMin)*huToU8`，`hi=(WC+WW/2-qMin)*huToU8`，`scale=255/max(1e-3, hi-lo)`，`v=clamp((u8-lo)*scale,0,255)` 并写入 RGBA（灰度）。改窗口/层号要重画；`SliceSync` 只在 `cursor.z / windowCenter / windowWidth / volume` 变化时重绘。

### 3.6 DPR / 画布尺寸

- 3D：R3F `dpr={[1,2]}`，`PerfProbe` 按 FPS 自适应（<27 降 0.25、>54 升 0.25，2 s 冷却，夹在 `[0.75, 1.5]`）。`Canvas` 父容器尺寸由 `react-use-measure` 提供。
- MPR：`dpr = min(2, window.devicePixelRatio || 1)`；`ResizeObserver` 读内容区 CSS 尺寸，bitmap = `round(cssW*dpr) × round(cssH*dpr)`，`ctx.setTransform(dpr,...)` 后按 CSS 坐标绘制。
- 任何窗格重排/窗口缩放都必须走“容器尺寸变化 → 重绘/重取景”，不要用 `window.innerWidth` 全局尺寸。

## 4. 已踩坑清单（症状 / 根因 / 修复 / 验证）

### 4.1 react-use-measure 首帧 0×0 → 3D 窗格偶发全黑

- 症状：加载后或切布局/移动端切页签时 3D 窗格全黑；首帧截图黑、稍后又正常。
- 根因：R3F 的 `size` 初值为 `0×0`，`CameraRig` 的 effect 在 `size.width<1` 时提前 `return`，之后依赖不再变化 → 相机永远没被摆到正确位置（若不做 aspect guard 还会出现 Infinity/NaN 相机）。
- 修复：effect 保留 0 尺寸 guard；同时在 `CameraRig` 里用 `useFrame` 一次性兜底（`framedRef`，等 `state.size` 真实后调 `frameCamera` 并只执行一次）。另外 `Workspace` 给 `VolumeViewport` 按病例 key 重建 Canvas（见 2.3），避免复用旧相机/旧几何。
- 验证：反复在 `2×2 ↔ 3D` 切换、移动端页签切换 3D，窗格始终有画面；`qa2` 3.9/3.10 PASS；历史证据 `tools/screenshots/90-3d-reliability-*.png`。

### 4.2 SwiftShader 首帧/纹理上传慢导致 QA 截图黑屏（非产品 bug）

- 症状：headless QA 第一次截 3D 布局得到全黑 PNG，被误判为产品失败；FPS 只有 1–6。
- 根因：软件 WebGL（SwiftShader）下 shader 编译 + 20 MB 3D 纹理上传需要多帧；刚挂载的 R3F canvas 在若干帧内没有像素。
- 修复：QA 封装 `wait3d(page, name, minBright=500, timeout=25000)`：对 3D 窗格截图 → `decodePng`/`imageStats`，直到 `brightCount > 500 && std > 4`，每轮 `waitFrames(2)` + 400 ms 轮询；超时才判失败。不要降低阈值/不要以第一帧判黑。
- 验证：`node tools/qa/qa2.mjs` → `{"desktop":"42/42","mobile":"12/12","screenshots":21}`，0 console/page error。

### 4.3 窗格 `section` 未加 `h-full w-full` → 按 header 文本宽度收缩（整屏小黑窗格）

- 症状：整个工作区只剩一个“小黑窗格”，宽度只有标题文字那么宽；canvas 尺寸接近 0。
- 根因：网格项里的 `section` 没有 `h-full w-full`（也无 `min-w-0`），flex/grid 收缩到内容宽度（header 文本）；3D canvas 的父容器无明确尺寸 → 画布塌陷。
- 修复：`Workspace.Pane` 的 `section` 固定为 `relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden ...`；内容区 `relative min-h-0 flex-1`；网格子项外层 `flex min-h-0 min-w-0`；`VolumeViewport` 自带 `div.relative.h-full.w-full` 包裹。
- 验证：1600×1000 下四窗格均约 `791×427`（含 28 px header），4 个 canvas CSS 尺寸约 `789×397`（`qa2` 3.4–3.6）；窗口缩放后不塌陷。

### 4.4 牙弓裁剪 smoothstep 0.05 UV 会吃牙面

- 症状：牙齿模式（teeth-only）下牙冠/切缘被削掉一圈。
- 根因：ROI 包围盒距釉质只有约 3 mm（≈2–3 体素）；早期按“0.05 UV”做边缘淡出（320 体素时 ≈16 体素）会把牙面当边缘淡掉。
- 修复：shader 用 `uVoxelStep` 把 UV 边缘距离换算成体素：`minEdgeVoxels / uVoxelStep` 后 `smoothstep(0.0, 2.5, minEdge)`（`volumeShader.ts` 中 `cropFade` 段）；`uCropMin/Max` 保持精确。
- 验证：`qa2` 5.2/5.3 PASS；`tools/screenshots/qa2-teeth-only-full.png`、`78-teeth-3d-sync.png` 牙面完整。

### 4.5 移除示例专属 `FALLBACK_DENTAL_BOX`

- 症状：没有 dental ROI 的通用病例仍被裁成“示例牙弓”位置（错误裁掉数据 / 误报有牙）。
- 根因：旧 `VolumeMesh` 有示例专属 UV 常量 `FALLBACK_DENTAL_BOX`，`teethOnly` 时无条件使用，导致任意数据集都套用示例坐标。
- 修复：删除 fallback；`crop` 仅当 `teethOnly && dental` 才启用。store 侧：`setTeethOnly(true)` 在 `dental == null` 时直接 `return`；`setPreset('teeth')` 仅当 `dental` 存在才置 `teethOnly=true`（否则只换预设不裁剪）；UI 按 `dental` 禁用“只看牙齿”。
- 验证：导入/构造一个无 ROI 数据集 → 按钮 disabled、3D 无裁剪；有 dental 的示例 → `qa2` 5.1–5.3 PASS。样本 `public/data/dental.json` 由 `tools/dental-roi.mjs`/`computeDentalRoi` 生成。

### 4.6 3D 切片平面：opacity / 深度排序 / CanvasTexture 方向

- 症状：切片平面像一块不透明板贴在最前面盖住 3D 体渲染；或平面图像与轴位 MPR 左右/上下镜像。
- 根因：体渲染材质 `depthWrite=false`，透明对象按 `renderOrder` 排序；平面若 renderOrder 低/不透明度过高会整块覆盖。纹理方向由 `CanvasTexture.flipY` 与绕 X 旋转方向共同决定（`+π/2` vs `−π/2` 差一个上下翻转）。
- 修复：`meshBasicMaterial({ transparent:true, opacity:0.42, side:DoubleSide, depthWrite:false, toneMapped:false })`，`renderOrder=5`（十字线 6，体渲染 0、bounds 2）；平面 `rotation=[Math.PI/2,0,0]`，使 `CanvasTexture` 首行（volume y=0）→ world +z，与 `VolumeMesh`/shader 轴一致，**不需要再翻转**；纹理 `colorSpace=THREE.SRGBColorSpace`、`LinearFilter`、无 mipmap；只缓存一张 320² canvas，`needsUpdate` 只在 `cursor.z/WW/WC/volume` 变化时置 true。
- 验证：`qa2` 4.5（轴位 z 101→107 后 3D 像素差约 15.3%）；人工对照 3D 平面与轴位 MPR 同层解剖方位一致（牙弓朝 +z 一侧）。

### 4.7 MPR 滚轮翻层 vs Ctrl+滚轮缩放 / 右键平移 / 双击复位

- 症状：用户以为滚轮是缩放却被翻层；右键或 Shift+拖拽没反应；Ctrl+滚轮触发浏览器页面缩放。
- 根因：交互约定与浏览器默认行为不同，且 `wheel` 监听需要非 passive。
- 修复：普通 `wheel` = 翻层（按轴 `z/y/x` ±1，`preventDefault`）；`Ctrl/Meta + wheel` = 缩放（`zoom *= exp(-deltaY*0.0018)`，夹在 `0.4..12`）；右键/中键/Shift+左键拖拽 = 平移；左键点击/拖拽 = 定位十字线；`dblclick` = 复位 zoom/pan；容器 `touch-none`、`onContextMenu` 阻止默认菜单。
- 验证：`qa2` 4.1（轴位/冠状位/矢状位分别只改 z/y/x）、4.2（点击定位）、4.3/4.4（+/−/F 存在且像素差约 31%）、移动端 9.8。

### 4.8 中文/注释 mojibake（写入方式坑）

- 症状：源码注释里的 `320²`、`+π/2` 等非 ASCII 字符被写坏，出现「铏?」「锜?」等乱码（当前仅 `src/three/VolumeViewport.tsx` 第 10/185 行附近；`README.md` 与 `tools/qa/qa2.mjs` 已扫描确认为正常 UTF-8，不要按控制台乱码误判）。
- 根因：曾用 PowerShell here-string / `Set-Content` 写 UTF-8 中文，被按 GBK 等代码页解码后落盘。
- 修复：写中文文件一律用编辑器/文件写入工具（显式 UTF-8）；不要用 shell 重定向/here-string 修中文。修复现存乱码要整文件重写，不要逐行 sed。
- 验证：`pnpm typecheck` 不受影响；`read` 文件确认中文正常；README 渲染正常。

## 5. 易回归点 / 不要做的事

- **不要恢复 i16 双格式**：当前 u8-only 是刻意选择（20 MB 资产、Cloudflare 25 MiB/文件限制、`RedFormat` 3D 纹理、MPR/WW 共用同一份数据）。若要 i16，需同时改 `prepare-volume`、导入器、纹理格式、内存/带宽预算，不要只改 shader。
- **不要让 0 尺寸把 Canvas 永久卡死**：保留 `size.width<1 || size.height<1` guard + `useFrame` 首帧兜底；父容器必须有明确高度（`Pane` 已保证）。
- **不要给 `VolumeViewport` 用随机/索引 key**：换病例必须用数据标识 key（当前 `directory|dims`），否则 Canvas 复用旧相机/旧 3D 纹理；但也不要在同一病例上频繁换 key（会重编译 shader、闪黑）。
- **不要每帧重绘切片纹理/新建材质**：只在 `cursor.z`、窗宽窗位、volume 变化时重绘；`setFps` 每秒一次已是上限。
- **不要把切片平面 `opacity` 调回 0.9+、或 renderOrder 调到体渲染之前**：透明排序会让它变成不透明挡板；0.42 是“可见但不挡”的折衷。
- **不要用固定 UV 距离做 ROI 边缘渐变**：必须用 `uVoxelStep` 换算体素（4.4）。
- **不要用 `document.querySelector`/`window.innerWidth` 给 3D 窗格定尺寸**：一律 `useThree(s=>s.size)` / `ResizeObserver`。
- **不要在 `VolumeViewport` 内加标题、边框、加载文案**：窗格 chrome 属于 `Workspace.Pane`，加载态由 `LoadingOverlay` 负责。
- **不要删 `window.__viewer`**（`main.tsx` DEV hook）：`qa2.mjs` 依赖它读 store 状态。
- **不要为了 `THREE.Clock` deprecation warning 降级 three**：来自 @react-three 内部，忽略即可。
- **不要用 PowerShell 写中文文件**（见 4.8）。

## 6. 验证命令与预期

```bash
pnpm install
pnpm typecheck        # tsc -b，严格模式（noUnusedLocals），期望 0 error
pnpm dev              # http://127.0.0.1:5173
```

- 手动验收：打开后是“打开 CBCT 影像”起始页 → 点「加载示例病例」→ `status='ready'`、`dims=320×320×200`、`dental=true`、出现 4 窗格（3 MPR + 3D 体渲染）。控制台只应有 `THREE.Clock ... deprecated` 警告，无 error、无 shader 编译失败。
- 3D 判断：软件渲染下先等 2–5 s（可再等几秒）；`3D` 布局单窗格必须可见体渲染（非全黑）。持续全黑先查：`window.__viewer.getState().volume` 是否非空、窗格高度是否为 0、`CameraRig` 是否执行（见 4.1）。真实 GPU 下不应黑屏。
- MPR 判断：轴位/冠状位/矢状位三张图有像素、方位字母/10 mm 标尺/十字线正常；滚轮只改对应轴；轴位改层后 3D 切片平面实时移动。
- 自动化 QA（需先起 dev server）：
  ```bash
  node tools/qa/qa2.mjs
  ```
  期望约 2–4 分钟，输出 `QA2 SUMMARY {"desktop":"42/42","mobile":"12/12","screenshots":21}`；产物 `tools/qa/results-qa2-desktop.json`、`tools/qa/results-qa2-mobile.json`、`tools/qa/qa2-summary.json`、`tools/screenshots/qa2-*.png`（21 张）。0 console/page error 才通过。
- 截图判读：`qa2-layout-quad.png`（四窗格，右下 3D 非黑）、`qa2-layout-3d.png`（全屏 3D）、`qa2-mpr-crosshair.png`、`qa2-teeth-before/after.png`（牙齿模式前后应明显不同）、`qa2-3d-before-slice/after-slice.png`（改层后 3D 应变化）。
- 生产构建 `pnpm build` 由部署负责人验证；`qa2` 只覆盖 dev server。

## 7. 未完成 & 建议下一步

- 冠状位/矢状位 3D 切片纹理（当前只有 `EdgesGeometry` 线框）：可复用 `paintAxialSlice` 的 CanvasTexture 方案，注意行/列翻转要与 `mpr.ts` 的 `buildSliceImage` 完全一致。
- 切片平面与 clip/ROI 联动：`teethOnly` 时平面/线框仍按整个 volume 的 X/Z 尺度，可裁剪到 dental ROI 框内；`uClipZ` 切片时平面也应随 clip 显隐。
- 深度遮挡：体渲染不写深度，平面只能靠 renderOrder 覆盖；若要“真正嵌入体积”，需要 depth pre-pass 或深度感知的透明排序（成本较高，先评估）。
- per-pane zoom/pan 持久化：`MprViewport` 的 `zoom`/`pan` 是本地 state，切布局/卸载即丢失；可提升到 store（按 axis 存）或 sessionStorage，注意不要每帧写 store。
- FPS 目前是全局单值 `store.fps`（多 Canvas 会互相覆盖）；若要每窗格 FPS，需要按 pane 存并在 `PerfProbe` 里带 pane id。
- 性能：`steps` 192–224、`MAX_STEPS=512`；SwiftShader 仅 1–6 FPS，真实 GPU 未实测。可用 `renderer.info` / GPU timer 评估，必要时降 3D 分辨率或跳过空帧渲染。
- 相机重置策略：窗格 resize 会重新取景（当前设计），如需保留用户的旋转/缩放，记录 spherical（polar/azimuth/distance）并按尺寸比例调整。
- 清理：删除无引用的 `src/three/VolumeCanvas.tsx`、`src/ui/MprPanel.tsx`（先确认 CSS 引用），并整文件重写修复 `VolumeViewport.tsx` 第 10/185 行的 mojibake 注释（见 4.8）。
- 可选：给 MPR 的 2D context 加 `{ willReadFrequently: true }`，消除 QA 像素读回警告（非必须）。

## 8. 相关产物

- QA 报告：`tools/QA-REPORT.md`（54/54 PASS、覆盖矩阵、flaky 说明）。
- 截图：`tools/screenshots/qa2-*.png`（21 张，当前 UI 的唯一可信视觉基线；旧 `qa-*.png` 已过时）。
- 截图：`docs/preview.png`（README hero）、`docs/import-view.png`、`docs/teeth-view.png`。
- QA 结果 JSON：`tools/qa/results-qa2-desktop.json`、`tools/qa/results-qa2-mobile.json`、`tools/qa/qa2-summary.json`。
- 数据：`public/data/volume.json`、`public/data/volume_u8.bin`（gitignored，需 `pnpm prepare-volume`）、`public/data/dental.json`、`public/data/thumbnail.png`。
- ROI 分析：`tools/dental-roi.mjs`、`tools/dental-preview/*.png`（mask/MIP/三视图）。
- 部署说明：`wrangler.jsonc` + `tools/deploy-cloudflare.md`（另见 `docs/HANDOFF-DEPLOY.md`）。
