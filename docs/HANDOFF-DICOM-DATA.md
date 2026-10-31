# HANDOFF · DICOM 数据管线（CBCT Volume Lab）

> 面向下一个 AI agent：读完本文件即可在没有本次会话上下文的情况下定位/修改/验证 CBCT 数据链路。
> 本次只写 `docs/HANDOFF-DICOM-DATA.md`，不要改 `src/**`、`package.json`、`README.md` 或其他 docs。
> 相关：`docs/HANDOFF-QA.md`（验证套件）、`docs/HANDOFF-3D-MPR-RENDERING.md` / `HANDOFF-UI-UX.md` / `HANDOFF-DEPLOY.md`（若已生成）。

## 1. 当前状态 / 范围

- 数据链路四段：① **可选 Node 预处理**（`scripts/prepare-volume.mjs`，只用于生成内置示例）→ ② **浏览器通用 DICOM 导入**（`src/data/dicomImport.ts`，产品主路径）→ ③ **牙弓 ROI**（`src/data/dentalRoi.ts`）→ ④ **`cbct-volume/1` 元数据 + uint8 体数据格式**（`src/types.ts`）。
- 产品主路径**不依赖 Python、服务器、示例数据**：医生选任意 CBCT DICOM 文件夹即可在浏览器内重建体数据；示例病例只是「加载示例病例」按钮的可选资产。
- 纯前端：`dicom-parser`（已从 devDependencies 移到 `dependencies`）+ 主线程顺序读取；无 Web Worker、无 WASM codec、无网络请求。
- 输入接受：**单序列、未压缩 16-bit CT/CBCT、显式/隐式 VR 小端**（`Modality` 为 `CT` 或空但有像素+几何）；压缩传输语法（JPEG/JPEG2000/RLE 等）明确报中文错误。
- 输出固定 8-bit：体数据同时供 WebGL2 3D 纹理与 MPR 使用；浏览器导入自适应降采样到最长边 ≤320。
- 已完成验证：`pnpm exec tsx tools/import-test.mjs` PASS；`node tools/qa/qa2.mjs` 的导入用例 8.1–8.3 PASS（42/42 + 12/12）；`pnpm typecheck` / `pnpm lint` / `pnpm build` 通过。

## 2. 关键文件与接口

| 路径 | 作用 |
| --- | --- |
| `scripts/prepare-volume.mjs` | Node 预处理：DICOM 序列 → `public/data/volume_u8.bin` + `volume.json`（+ 可选 thumbnail）。**默认输入目录是 `dicom/`，该目录不存在，必须显式 `--input`**；`--out` 默认 `public/data`；`--factor` 仅 1/2/4（默认 2）。 |
| `src/data/dicomImport.ts` | 浏览器导入核心：`importDicomFiles(files, onProgress)`、`ImportProgress`、`ImportResult`；内部 `probeFile`（第一遍读头）、`analyzeSeries`（校验+排序+算层距）、`buildVolumeFromSlices`（第二遍累加+分位数+量化）、`renderPreview`（PNG poster）。 |
| `src/data/dentalRoi.ts` | `computeDentalRoi(volume, meta): DentalRoi \| null`，纯 typed-array 启发式 AABB，~0.2–0.3 s（320×320×200）。 |
| `src/data/volumeLoader.ts` | **仅服务内置示例**：`fetchVolumeMeta` / `fetchVolumeData` / `fetchDentalRoi` + `huFromU8` / `u8FromHu` / `huAtVoxel`。 |
| `src/data/mpr.ts` | MPR 光栅化：直接用 `volume.u8` + `quantRange` 反解 HU 后加窗，是「u8 同时供 MPR」的实现处。 |
| `src/types.ts` | `VolumeMeta`（schema `cbct-volume/1`）、`VolumeData`、`DentalRoi`、`Vec3` 等唯一权威类型。 |
| `public/data/` | 可选示例资产：`volume_u8.bin`（20,480,000 B = 19.53 MiB）、`volume.json`、`dental.json`、`thumbnail.png`。 |
| `tools/import-test.mjs` | Node 侧导入冒烟测试 + 原始 DICOM 像素一致性校验 + 错误路径断言。 |
| `tools/dental-roi.mjs` | 旧版 Node ROI 分析器，仅用于重新生成示例 `public/data/dental.json` 与预览图（非浏览器路径）。 |

### 2.1 浏览器导入契约（不兼容改动前先搜全仓库）

```ts
export interface ImportProgress {
  phase: 'read' | 'parse' | 'volume' | 'roi' | 'done'
  done: number
  total: number
  message?: string
}
export interface ImportResult {
  meta: VolumeMeta
  volume: VolumeData
  dental: DentalRoi | null
  previewDataUrl: string | null // 320×320 轴位 PNG data URL；Node 下为 null
}
export async function importDicomFiles(
  files: File[],
  onProgress: (progress: ImportProgress) => void,
): Promise<ImportResult>
```

- 进度节流到 **≤200 次**（示例 403 文件实际 108 次）；`done/total` 可直接作为 0–1 进度。
- 错误全部是**中文、可行动**：空选择 / 无可用序列 / 压缩 DICOM / 不支持的传输语法 / 非 16-bit / 序列 <10 层 / Rows·Cols·PixelSpacing·IOP 不一致。
- 调用方：`src/store/useViewerStore.ts` 的 `importFiles(files)`（phase → i18n key `loading.import|parse|importVolume|importRoi`）；`src/App.tsx` 负责隐藏 file input、`webkitdirectory`、拖拽目录递归与 `cbct:import` / `cbct:import-files` / `cbct:sample` 事件。

### 2.2 牙弓 ROI 契约

- `computeDentalRoi` 返回 `DentalRoi`：`version: 1`、`voxelBox`（归一化 UV/纹理空间 AABB）、`worldBoxMm`、`hu { toothMin:1250, enamelMin:2200, boneMin:850 }`、`stats.method = 'browser heuristic'`。
- 消费者：3D 渲染的裁剪盒与相机取景（`src/three/VolumeMesh.tsx`、`src/three/VolumeViewport.tsx`）；MPR 不做 ROI 裁剪。
- `dental === null` 时：`teethOnly` 不得为 true（store 中 `setPreset('teeth')`/`setTeethOnly` 已按 `get().dental` 短路，3D crop 也默认关闭）；UI 的「只看牙齿」应保持禁用态。

## 3. 必须理解的约定

1. **导入后绝不能走 `fetchVolumeData` / `fetchDentalRoi`**：浏览器导入返回的 `meta.files.u8 === ''`、`meta.files.thumbnail === null`、无 `files.dental`；`fetchVolumeData` 会请求 `data/` 空路径，`fetchDentalRoi` 会回落去 fetch 示例 `dental.json` 并套到新体数据上（错 ROI）。直接用 `ImportResult.volume / .dental / .previewDataUrl`；`fetch*` 只属于 `store.load()`（示例）路径。
2. **u8 双用途与反量化**：索引 `i = x + y*W + z*W*H`（x 最快，C order）；`HU = qMin + u8/255*(qMax-qMin)`，反函数 `u8 = clamp(round((HU-qMin)/(qMax-qMin)*255),0,255)`；`quantRange = [qMin,qMax]` 必须随体数据一起传递，不能硬编码。
3. **降采样与量化**：`factor = max(1, ceil(max(Rows,Cols,N)/320))`，输出 `[floor(Cols/factor), floor(Rows/factor), floor(N/factor)]`（≥1）；块平均只累加完整块（尾部不足一块的 row/col/slice 被丢弃），因此每个输出体素固定 `factor^3` 个样本，无需 count 数组；间距 = 原间距 × factor。
4. **quantRange 由直方图分位数决定**：4096 bin、范围 `[-2048, 6144)` + 溢出计数；`qMin = max(-12000, min(-1024, floor(p0.1)))`、`qMax = min(30000, max(3000, ceil(p99.9)))`，并保证 `qMax > qMin+1`；`huRange` 取实际 min/max（同样夹到 `[-12000,30000]`）。示例资产由预处理脚本固定 `[-1024, 3400]`，浏览器导入示例则得 `[-1024, 3000]`，两者都合法，**不要假设固定 3400**。
5. **ROI 是启发式 AABB，不是逐牙分割**：UV 约定 = 体素 `i` 中心在 `uv=(i+0.5)/n`，盒子面落在体素边界（`min=i0/n`，`max=(i1+1)/n`）；uv.x=volume x、uv.y=volume y、uv.z=volume z。阈值自适应：先试 HU≥1900，再 1700、1500，仍太稀则取 guard 内最密 0.15% 作为兜底；guard = x 10–90%、y<62%（前牙区）、z 12–88%；根长补偿 14 mm、x/y 外扩 3 mm；若核心体素 <200、密度 <0.02% guard，或任一轴 >85% 体积则返回 `null`。
6. **输入接受矩阵**：单序列、未压缩、16-bit、`PixelRepresentation` 0/1、显式或隐式 VR 小端。多序列文件时自动选「切片最多」的序列（并列取 StudyDate+Time 最新），**没有多序列选择 UI**；压缩 DICOM 会抛「压缩的 DICOM 暂不支持，请导出未压缩序列（Explicit VR Little Endian）。」
7. **数据二进制与示例数据**：`public/data/*.bin` 被 `.gitignore` 忽略；示例资产不是必需的（起始页可直接导入）。云部署单个 asset ≤ **25 MiB（26,214,400 B）**，这是只保留 u8、删除 i16 的原因。
8. **无 Python**：`scripts/` 只有 `prepare-volume.mjs`；旧 `tools/*.py` 已删除。DICOM 解析、体数据重建、ROI 全在 Node 脚本或浏览器 JS 内完成，不要重新引入 Python 依赖。

## 4. 已踩坑清单（症状 / 根因 / 修复 / 验证）

1. **原 i16 体数据 40.96 MB 超过 Cloudflare 单文件上限**
   - 症状：`wrangler deploy` / dry-run 报 asset 超过 25 MiB；`dist/data/volume_i16.bin` 存在。
   - 根因：旧的 16-bit 精确体数据 400×640×640×2 = 40,960,000 B > 26,214,400 B。
   - 修复：只产出 u8（20,480,000 B = 19.53 MiB）；MPR 用 u8 反量化，示例量化步长 (3400+1024)/255 ≈ 17.4 HU → 误差约 ±9 HU；浏览器导入步长 (3000+1024)/255 ≈ 15.8 HU。
   - 验证：`pnpm build` 后 `dist/data` 只有 4 个文件、最大 20,480,000 B；`tools/deploy-cloudflare.md` 有实测记录。
2. **400×640×640 原始切片不能全部驻留内存**
   - 症状：把 `Promise.all(files.map(arrayBuffer))` 或全部 `Int16Array` 缓存后，移动端/低内存标签页 OOM 或长时间 GC。
   - 根因：403 文件约 328 MB；Node `Buffer` + 视图翻倍。
   - 修复：两遍顺序处理——第一遍逐文件读头后立即释放（只留 `SliceProbe`），第二遍按计算好的顺序重读、只留一张原始切片 + `Float32Array` 累加器，累加后即丢弃。**禁止** `Promise.all` 读文件。
   - 验证：`tools/import-test.mjs` 的 lazy File 读取，峰值 RSS 约 104–190 MB；最终 u8 20.48 MB。
3. **切片顺序不能按文件名排**
   - 症状：通用序列导出命名不保证与解剖 z 同序，按文件名累加得到翻转/错位体数据。
   - 根因：DICOM 无「文件名有序」约定。
   - 修复：`normal = cross(IOP 前三个, IOP 后三个)`，按 `dot(ImagePositionPatient, normal)` 升序排序；层距取相邻正差的中位数（为 0 时回退 SliceThickness 或 1）；缺 IPP 时回退 InstanceNumber。`scripts/prepare-volume.mjs` 仍按文件名排序并要求严格等距，只适用于示例，不要当通用算法。
   - 验证：`tools/import-test.mjs` 用 3 个随机体素与原始 DICOM 原始像素块平均比对，最大误差 5.46 HU（量化步长 15.78 HU），证明顺序/偏移正确。
4. **Rescale 标签写错**
   - 症状：HU 全错/全 0。
   - 根因：Rescale 是 `(0028,1052) RescaleIntercept` / `(0028,1053) RescaleSlope`；`(0028,0105)/(0028,0104)` 不是 rescale。
   - 修复：HU = raw × slope + intercept，缺失时 slope=1、intercept=0；逐切片读取（不同切片可能不同）。示例序列 slope=1、intercept=0。
   - 验证：导入示例 `huRange [-1000, 3240]`、骨窗/牙窗显示正常。
5. **非 DICOM 文件、压缩 DICOM、坏序列的处理**
   - 症状：用户选整个检查目录（含 `thumbnail.jpg`、`slice.index`、序列信息文件）时导入失败或卡死。
   - 根因：目录里通常混有非 DICOM 文件；也有机器导出 JPEG/JPEG2000 压缩序列。
   - 修复：无 PixelData / 非 CT / 解析失败的文件**静默跳过并计数**（示例 403 文件跳过 3 个，`message` 提示）；压缩或大端等不支持格式、序列层数 <10、几何不一致则抛中文错误（<10 层会提示「可能不是完整 CBCT 序列」）。
   - 验证：`tools/import-test.mjs` 断言「空选择」「非 DICOM only」两类错误文案；qa2 导入用例走 403 文件真实路径。
6. **通用 CBCT 上牙弓 ROI 可能返回 null**
   - 症状：某些扫描「只看牙齿」不可用，或 ROI 框过大。
   - 根因：CBCT 的 HU 标定不统一，牙釉质阈值不一定 ≥1900；视野外高密度物、金属伪影会把 bbox 拉大。
   - 修复：阈值 1900→1700→1500 自适应 + 最密 0.15% 兜底；前牙区 guard 框 + 稳健分位数（x/y 0.5%/99.5%，z 1%/99%）抑制离群点；不可信时返回 `null`，UI 禁用牙齿视图而不是画错框。
   - 验证：`tools/import-test.mjs` 打印示例 ROI：`min=[0.284375,0.128125,0.22] max=[0.753125,0.4625,0.71]`、x[91,240] y[41,147] z[44,141]、threshold 1895 HU、core 6928、dense 0.089%；小序列（10 层）返回 `dental=null`。
7. **浏览器导入速度受环境支配**
   - 症状：软件渲染 QA 环境导入 403 文件（约 313 MiB）耗时 7.5–11.6 s，看起来像卡死。
   - 根因：SwiftShader / 无 GPU 的 CI 环境 + 约 313 MiB 文件 I/O 与两遍解析；真实桌面 Chrome（GPU）约 2–6 s。
   - 修复：不做假优化；保证 `onProgress` 连续更新、允许 300 s 超时（qa2 用 `waitForState(...,300000)`），把慢归因为环境而非产品 bug。
   - 验证：`tools/qa/results-qa2-desktop.json` 的 `generic DICOM import` note 记录 ms；真机桌面 Chrome 手工验收约 2–6 s。
8. **`node tools/import-test.mjs` 直接跑会失败**
   - 症状：`ERR_MODULE_NOT_FOUND: Cannot find module .../src/data/dentalRoi imported from .../src/data/dicomImport.ts`。
   - 根因：Node 原生 TS strip 不做无扩展名解析，`src/data/dicomImport.ts` 里 `import { computeDentalRoi } from './dentalRoi'` 无 `.ts` 后缀；README 里的 `node tools/import-test.mjs` 已过时。
   - 修复：用 `pnpm exec tsx tools/import-test.mjs`（已验证 PASS）；若坚持原生 Node，需要把源码相对导入改成带 `.ts` 后缀（Vite 允许，但会影响全部 src，先与 Lead 确认）。
   - 验证：`pnpm exec tsx tools/import-test.mjs` 输出 `[test] PASS`；`node tools/import-test.mjs` 可复现上述报错。
9. **用 PowerShell 写中文 Markdown 会乱码**
   - 症状：中文变 `??` / 锟斤拷。
   - 根因：Windows 控制台/管道默认编码不是 UTF-8。
   - 修复：**一律用 `write` 工具（UTF-8）** 写本仓库中文文档，不要 `Set-Content` / `>` 重定向。
   - 验证：用 `read` 工具打开文件确认中文正常。

## 5. 易回归点 / 不要做的事

- **不要重新引入 Python 依赖**（`tools/*.py` 已删；DICOM 解析只用 `dicom-parser`）。
- **不要把示例病例写死为默认**：起始页 `status='idle'`，只有用户点「加载示例病例」才 `store.load()`；导入是主路径。
- **不要默认 fetch `volume.json`**：导入路径不得调用 `fetchVolumeMeta/Data/Dental`（见第 3 节第 1 条）。
- **不要用文件名排序切片**；不要假设层间距均匀、不要假设 IPP 一定存在。
- **不要缓存全部原始切片**、不要 `Promise.all` 批量读文件（内存爆炸）。
- **不要给导入结果写 `files.u8` 路径或 `files.dental` 路径**（内存数据，无 URL；写了会诱导别人去 fetch）。
- **不要硬编码 `quantRange`/`huRange`**；所有窗位/阈值都要按当前 `VolumeData.quantRange` 换算。
- **不要把 `dental === null` 当错误**或强制开牙齿视图；UI 必须禁用。
- **不要为绕过 25 MiB 重新生成 i16**；如确需高精度，用 R2/分块/运行时计算，而不是再加一个大 bin。
- **不要改 `package.json` 的依赖位置**（`dicom-parser` 必须在 `dependencies`，否则生产构建/部署漏依赖）。
- **不要在第 3 节约定之外改 `src/types.ts` 的字段名**（schema 解析、示例 json、store、渲染层全都依赖）。

## 6. 验证

```powershell
pnpm typecheck
pnpm lint
pnpm build

# 可选：重新生成示例资产（会覆盖 public/data/volume_u8.bin、volume.json、thumbnail.png）
pnpm prepare-volume --input "260314112318092 窦扬杰/Dicom/20260314112507-0-1-10"
# 可选：只重算示例 dental.json
node tools/dental-roi.mjs

# 浏览器导入冒烟测试（必须用 tsx，见坑 8）
pnpm exec tsx tools/import-test.mjs

# 端到端 QA（先另开终端 pnpm dev，预期 http://127.0.0.1:5173/）
node tools/qa/qa2.mjs
```

- `tools/import-test.mjs` 期望关键输出：`input files: 403 (400 .dcm)`、`dims [320, 320, 200]`、`spacing [0.5, 0.5, 0.5]`、`original dims [640, 640, 400] @ [0.25,0.25,0.25]`、`quantRange [-1024, 3000]`、`huRange [-1000, 3240]`、`previewDataUrl null (Node)`、ROI 见坑 6、`[test] PASS`；耗时约 2–3 s、RSS 约 100–200 MB。
- `qa2.mjs` 导入用例：检查 8.1「403 文件免刷新替换体数据且 `meta.source.directory==='local import'`」、8.2「preview + dental 均存在」、8.3「4 个窗格/非空 canvas」；总结果应为 `desktop 42/42 + mobile 12/12`。
- 部署体积：`Get-ChildItem dist/data -File | Sort-Object Length -Descending | Select-Object -First 3 Name, Length`，最大应为 20,480,000 B，**不得出现 volume_i16.bin**。

## 7. 未完成 & 建议下一步

- 压缩 DICOM 解码：可选 WASM codec（OpenJPEG-JPEG2000 / CharLS-JPEG-LS / jpeg-lossless），注意 25 MiB 与首屏体积预算；当前明确报错是产品决策。
- 多序列/多 study 选择 UI：目前自动取切片最多的序列；医生可能需要先列 series（UID + 层数 + 日期）再选。
- Web Worker 导入：主线程 2–12 s 阻塞，可把 `probeFile`/`buildVolumeFromSlices` 移入 Worker（`Uint8Array` transferable），并保留 `onProgress` 节流。
- ROI 手动修正：对 `dental===null` 或框不准的病例，允许拖拽/重置 AABB 并写回 `DentalRoi`（保持 UV 约定）。
- 超大体积/移动端内存上限：>400 层或 >320³ 时考虑分块累加、降低最大目标尺寸（如 256）、或提示用户。
- 原生 Node 跑测试：把源码相对导入补 `.ts` 后缀，让 `node tools/import-test.mjs` 与 README 一致（需 Lead 决定）。
- 进度文案 i18n：`ImportProgress.message` 目前是中文；若 UI 要英文化，改为传 key 而不是文案。
- 补齐测试数据：`dental=null` 的真实 CBCT、压缩序列、混合 series、缺 PixelSpacing/Orientation 的机器导出。

## 8. 相关产物路径

- 源码：`src/data/dicomImport.ts`、`src/data/dentalRoi.ts`、`src/data/volumeLoader.ts`、`src/data/mpr.ts`、`src/types.ts`、`src/store/useViewerStore.ts`、`src/App.tsx`
- 脚本/测试：`scripts/prepare-volume.mjs`、`tools/import-test.mjs`、`tools/dental-roi.mjs`、`tools/qa/qa2.mjs`
- 示例资产：`public/data/volume_u8.bin`（19.53 MiB）、`public/data/volume.json`、`public/data/dental.json`、`public/data/thumbnail.png`
- 示例 DICOM：`260314112318092 窦扬杰/Dicom/20260314112507-0-1-10/`（400 张 .dcm + 3 个非 DICOM，共 328,444,882 B）
- 文档：`docs/HANDOFF-DICOM-DATA.md`（本文件）、`docs/HANDOFF-QA.md`、`tools/deploy-cloudflare.md`、`README.md`（数据管线说明与部分过时命令）
