# CBCT Volume Lab

面向医生的 CBCT 浏览器阅片工作台：**2×2 大画幅 MPR（轴位/冠状位/矢状位 + 3D 体渲染）**、同步十字线、
**3D 切片联动**、牙弓专注视图、可调界面字号、中英切换，并支持 **在浏览器里直接打开任意 CBCT DICOM 文件夹**
（纯前端实现、无需服务端预处理、文件不上传）。

技术栈：**three.js · @react-three/fiber · TypeScript · zustand · Tailwind CSS v4 · Vite · dicom-parser**。
可部署到 Cloudflare Workers（自定义域 `cbct.cyrusdoyle.me`）。

![clinical workspace](docs/preview.png)

## 快速开始

```bash
pnpm install
pnpm dev            # http://127.0.0.1:5173
```

打开后是「打开 CBCT 影像」起始页，可直接：

- **打开 CBCT 文件夹** / **选择 DICOM 文件**：浏览器内解析、重建体数据并进入阅片界面；
- **加载示例病例**：仓库内置的示例体积资产（需要先运行一次 `pnpm prepare-volume` 生成）。

> 解析、降采样、牙弓 ROI、窗宽窗位、MPR 光栅化全部在浏览器（TypeScript）完成；
> 仓库里的 Node 脚本仅用于可选的示例数据预处理。

## 功能（按医生阅片习惯重做）

- **2×2 临床工作区**：轴位、冠状位、矢状位、3D 体渲染四个大窗格；窗格标题显示方位、层号/总层数、
  mm 位置、WW/WC；可切换 `2×2 / 多平面 / 3D` 布局。
- **大画幅 MPR**：窗格随窗口自适应，按容器尺寸高清渲染（DPR 感知），保留 320² 像素诊断信息；
  方位字母（A/P、R/L、S/I）、10 mm 比例尺、层号角标独立于窗格标题。
- **阅片交互**：滚轮翻层（轴位 Z / 冠状位 Y / 矢状位 X），单击定位十字线，右键或 Shift+拖拽平移，
  Ctrl+滚轮 / 窗格右上 `+ − F` 缩放与适应，双击复位；MPR 三视图与体素光标实时同步。
- **3D 切片联动**：滚动 2D 层时，3D 窗格中的轴位切片平面与十字线平面实时跟随，医生在 3D 中始终看到
  当前层的位置；3D 支持轨道旋转/缩放/平移、可选自动旋转。
- **只看牙齿**：基于浏览器计算的牙弓 ROI（`dental.json` / `computeDentalRoi`）裁剪 3D 渲染；
  没有可用牙弓 ROI 时按钮自动禁用，不会误用示例病例的坐标。
- **中英切换**：顶栏 `EN / 中文`，默认中文，`localStorage` 记忆，`<html lang>` 同步。
- **可调界面字号**：设置（齿轮）→「界面字号」：小 / 标准 / 大 / 特大（100%–155%），即时缩放顶栏、
  工具栏、窗格标题、状态栏、设置面板与 MPR 画布内文字；浏览器记住选择。
- **通用 CBCT 支持**：任意单序列、未压缩 16-bit CT/CBCT DICOM（显式/隐式 VR 小端）；
  自动按 SeriesInstanceUID 分组、按 ImagePositionPatient 排序、按几何降采样到 ≤320 体素长轴，
  并自适应计算 HU 窗位；非 DICOM 文件静默跳过，压缩传输语法/缺 PixelData 给出中文提示。
- **移动端**：≤900 px 单窗格 + 轴位/冠状位/矢状位/3D 页签；顶栏图标化并保留 aria-label；
  工具栏横向滚动；设置抽屉为底部/右侧浮层。

## 浏览器端 DICOM 导入

`src/data/dicomImport.ts` 提供 `importDicomFiles(files, onProgress)`：

1. 逐个读取文件（同一时刻只保留一张原始切片 + 降采样累加器，内存安全）；
2. 解析 patient/study/geometry/rescale，按 SeriesInstanceUID 选最大序列；
3. 按 `dot(ImagePositionPatient, normal)` 排序，计算层间距与 0.5 mm 级别体素；
4. HU 域块平均降采样，直方图置信区间计算 `quantRange`，生成 uint8 体数据；
5. `src/data/dentalRoi.ts` 用牙釉质高密度连通域 + 稳健分位数包围盒估算牙弓 ROI（不可信时返回 null）；
6. 返回 `VolumeMeta` / `VolumeData` / `DentalRoi` / 加载页预览图。

示例序列（400 × 640 × 640）：浏览器导入约 **2–6 s**（桌面 Chrome），输出 320 × 320 × 200 @ 0.5 mm。
Node 侧可用 `pnpm exec tsx tools/import-test.mjs` 做回归。

## 示例数据（可选）

源序列：`260314112318092 窦扬杰/Dicom/20260314112507-0-1-10/`（400 张轴位，0.25 mm，640 × 640）。
`pnpm prepare-volume --input "path/to/series"` 会生成可选的演示资产：

```
public/data/volume_u8.bin    20 MB   uint8 归一化 HU（GPU 3D 纹理 + MPR 共用）
public/data/volume.json              几何 / 患者 / 窗位元数据
public/data/dental.json              示例牙弓 ROI（analyze 脚本生成）
public/data/thumbnail.png            加载页海报
```

**这不是必需步骤**：应用不再默认绑定任何病例目录；浏览器导入是主路径。二进制资产被 gitignore。
`scripts/prepare-volume.mjs` 的默认输入目录是 `dicom/`，必须显式传 `--input` 指向你的序列：

```bash
pnpm prepare-volume --input "path/to/DICOM/series" --factor 2
```

牙弓 ROI 分析脚本（Node）：

```bash
node tools/dental-roi.mjs        # 重新生成 public/data/dental.json 与预览图
```

## 技术实现（关键文件）

```
src/data/dicomImport.ts      浏览器端 DICOM -> 体数据（通用 CBCT）
src/data/dentalRoi.ts        浏览器端牙弓 ROI 估计
src/data/volumeLoader.ts     加载内置示例资产 / HU 换算
src/data/mpr.ts              MPR 显示几何 / 拾取
src/ui/Workspace.tsx         2×2 / 多平面 / 3D 布局 + 窗格框架
src/ui/viewport/MprViewport  高清 MPR 画布（DPR、缩放/平移、方位、比例尺、十字线）
src/three/VolumeViewport.tsx 3D 体渲染窗格 + 同步切片平面/十字线
src/three/volumeShader.ts    ray marching / TF / 牙弓裁剪
src/ui/TopBar.tsx            临床顶栏（布局、导入、牙弓、语言、设置）
src/ui/ClinicalBar.tsx       窗宽窗位 chips + 渲染风格选择
src/ui/SettingsDrawer.tsx    界面字号 / 患者信息 / 渲染参数
src/store/useViewerStore.ts  zustand：加载、导入、布局、字号、光标、窗位
src/i18n.ts                  中英字典
```

窗格坐标约定：`uv = (x, y, z)`，`uv.x=volume x`、`uv.y=volume y`（前→后）、`uv.z=volume z`（下→上）；
MPR 采用放射学显示约定（患者右侧在图像左侧），3D 世界坐标 `world=(x, z_slice, -y)`。

## 部署到 Cloudflare

`wrangler.jsonc` 已配置 Workers Static Assets（`name=cbct`，`assets.directory=./dist`，
自定义域 `cbct.cyrusdoyle.me`）。本机曾经没有有效 Cloudflare 凭据，因此部署前需要：

```bash
pnpm exec wrangler login     # 或 API token：CLOUDFLARE_API_TOKEN
pnpm exec wrangler whoami
pnpm deploy                  # = pnpm build && wrangler deploy
```

- Cloudflare 单文件上限 25 MiB：构建后最大文件约 19.5 MiB（示例体积），无超限；
- `wrangler deploy --dry-run` 已通过；
- 部署后验证 `https://cbct.cyrusdoyle.me/` 与 `/data/volume_u8.bin`（内置示例时）；
- 回滚：`wrangler rollback` 或 Dashboard Deployments。

## 验证

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm exec tsx tools/import-test.mjs   # Node 侧 DICOM 导入 + 像素一致性校验
node tools/qa/qa2.mjs               # 临床工作区 QA（desktop 42 + mobile 12）
```

QA 截图输出到 `tools/screenshots/qa2-*.png`（可随时重新生成）。无头 Chromium 使用 SwiftShader 软件渲染，FPS 不代表真实 GPU 性能。

## 限制

- 仅支持未压缩 16-bit CT/CBCT DICOM；JPEG/JPEG2000 等压缩传输语法会提示先导出未压缩序列。
- 牙弓 ROI 为启发式包围盒（高密度牙釉质连通域），不是逐牙分割；不可信时返回 null 并禁用「只看牙齿」。
- 浏览器端为降采样 + 8-bit HU 纹理（示例 0.5 mm，约 ±9 HU 量化误差）；原始 DICOM 不改动。
- 本项目不是医疗器械软件，仅供浏览/定位使用，不能用于诊断。
