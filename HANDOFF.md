# AGENT HANDOFF — CBCT Volume Lab

> 给下一位接手本仓库的 AI Agent。先读本文件，再按需读第 8 节的领域文档。
> 项目本身是纯前端（浏览器 TypeScript + Node 工具链），**不包含、不需要 Python**。

## 0. 一分钟现状

| 项目 | 状态 |
| --- | --- |
| 产品 | 面向医生的 CBCT 浏览器阅片工作台：2×2 大画幅 MPR（轴/冠/矢）+ 3D 体渲染、3D 切片联动、只看牙齿、中英切换、可调字号、浏览器内通用 DICOM 导入 |
| 代码 | `pnpm typecheck` 0 error，`pnpm lint` 0 error（31 warning），`pnpm build` 通过 |
| QA | `node tools/qa/qa2.mjs`：Desktop **39/42 PASS + 3 SKIP**（SKIP 为通用导入 3 项，需原始 DICOM 序列）+ Mobile **12/12 PASS**，0 console/page error；3D 非黑、字号、布局、联动均通过 |
| 部署 | **尚未真正部署**。`wrangler.jsonc` 已就绪、`pnpm deploy:dry` exit 0；本机 Cloudflare OAuth 过期且无 API token |
| 真实设备 | 未测真实 GPU 性能 / 真实手机触控；QA 使用 SwANGLE(SwiftShader) 软件渲染，FPS 无参考价值 |
| 示例数据 | `public/data/*` 为本地示例资产（volume_u8.bin/dental.json/thumbnail）；原始 DICOM 患者目录已从工作区移除，因此 `tools/import-test.mjs` 与 qa2 的 8.1–8.3 需要另行提供 DICOM 才能执行 |

## 1. 下一位 Agent 的推荐顺序

1. 读本文件 + `README.md`（产品与命令）。
2. 要改 **3D / MPR / 渲染** → `docs/HANDOFF-3D-MPR-RENDERING.md`。
3. 要改 **布局 / 顶栏 / 字号 / i18n / 移动端** → `docs/HANDOFF-UI-UX.md`。
4. 要改 **DICOM 导入 / 预处理 / ROI** → `docs/HANDOFF-DICOM-DATA.md`。
5. 要 **部署 / 排查 Cloudflare** → `docs/HANDOFF-DEPLOY.md`。
6. 改完必须回归 → `docs/HANDOFF-QA.md`，跑 `node tools/qa/qa2.mjs`。

## 2. 最短路径

```bash
pnpm install
pnpm dev                     # http://127.0.0.1:5173（起始页：打开文件夹 / 选文件 / 示例）
pnpm typecheck && pnpm lint && pnpm build
node tools/qa/qa2.mjs        # 需要 dev server + public/data 示例资产，约 2–4 分钟
```

Node 版本：见 `.node-version`。包管理：pnpm。不要引入 Python/服务端。

## 3. 目录地图（只列关键）

```
src/
  App.tsx                    应用外壳：导入事件、拖拽、快捷键、字号注入
  store/useViewerStore.ts    zustand：load/importFiles/layout/uiScale/cursor/window/teethOnly/fps
  data/dicomImport.ts        浏览器 DICOM -> u8 体数据（通用 CBCT 主路径）
  data/dentalRoi.ts          牙弓 ROI 启发式（null 时禁用只看牙齿）
  data/volumeLoader.ts       仅用于内置示例资产
  data/mpr.ts                MPR 显示/拾取几何
  ui/Workspace.tsx           2×2 / 多平面 / 3D 布局与 Pane
  ui/viewport/MprViewport.tsx 高清 MPR 画布（DPR、缩放/平移、方位、比例尺、十字线）
  three/VolumeViewport.tsx   3D 窗格 + CameraRig + 同步切片平面
  three/volumeShader.ts      ray marching / TF / 牙弓裁剪
  ui/TopBar.tsx / ClinicalBar.tsx / StatusBar.tsx / SettingsDrawer.tsx
  i18n.ts                    zh/en 字典
scripts/prepare-volume.mjs   可选：把 DICOM 序列预处理成 public/data 示例资产
tools/qa/qa2.mjs             唯一有效 QA 套件（desktop + mobile）
tools/import-test.mjs        Node 侧导入回归（必须 tsx 运行）
tools/dental-roi.mjs         可选：重新估算示例 ROI
tools/deploy-cloudflare.md   部署操作说明（HANDOFF-DEPLOY 的早期版本）
```

## 4. 绝对不能破坏的约定

1. **无 Python**：浏览器 TypeScript + Node ESM；不要新增 `.py`、venv 或 Python 步骤。
2. **不绑定病例**：不得把 `260314112318092 窦扬杰` 或任何示例路径写成默认；示例只通过「加载示例病例」进入。
3. 浏览器导入返回的 `meta.files.u8 === ''` 且 `thumbnail === null`：导入后**绝不能**再 `fetchVolumeData` / `fetchDentalRoi`。
4. 体数据只有 **u8** 一份（GPU 3D 纹理与 MPR 共用）；i16 曾因 40.96MB > Cloudflare 25MiB 单文件上限被删除，不要恢复。
5. `dental === null` ⇒「只看牙齿」按钮禁用，3D 不做牙弓裁剪；不要恢复示例专用 fallback 包围盒。
6. 坐标：体素 `uv = (x, y, z)`；3D world `x = (u-0.5)*sx, y = (z-0.5)*sy, z = (0.5-v)*sz`；MPR 为放射学显示（患者右侧在图像左侧）。
7. `uiScale` 默认 1.18（100%–155%），持久化 key `cbct-ui-scale`；字号链路 = store → `<html style="--ui-font-scale">` → `src/styles.css` 覆盖 + MprViewport canvas 字体。
8. 语言 key `cbct-lang`；`documentElement.lang` 与 UI 同步。
9. 3D 窗格必须随 `meta.source.directory + dims` 重挂载（Workspace 的 `key`），否则换病例会黑屏；CameraRig 用 `useFrame` 兜底首帧 0×0。
10. `public/data/*.bin`、示例 DICOM、`tools/screenshots` 不提交；Cloudflare 单文件上限 25MiB。

## 5. 最容易踩的坑（详见各领域文档）

| 症状 | 根因 / 修复 | 详见 |
| --- | --- | --- |
| 3D 窗格偶发全黑 | react-use-measure 首帧 0×0 → CameraRig 提前 return；已用 useFrame 首帧兜底 + volume 切换 key 重挂载 | 3D 文档 |
| MPR 窗格很小、右侧大片空白 | Pane `<section>` 缺 `h-full w-full`，flex 按内容收缩 | UI 文档 |
| 字号调了没反应 | Tailwind 任意 `text-[9px]` 是固定 px；需在 styles.css 用 `[data-ui-scale]` 覆盖 | UI 文档 |
| 换病例后 3D 还是旧体积 | 未按 source/dims 重挂载 Canvas | 3D 文档 |
| 导入后 404 / 一直 loading | 对导入数据误用 `fetchVolumeData`（`meta.files.u8===''`） | 数据文档 |
| 切片顺序错乱 | 用文件名排序；必须 `dot(ImagePositionPatient, normal)` + 中位层距 | 数据文档 |
| 中文变乱码 | 用 PowerShell `Set-Content` 重写中文文件；一律用 `write/edit` 工具 | 本文第 7 节 |
| `node tools/import-test.mjs` 报 ERR_MODULE_NOT_FOUND | 必须 `pnpm exec tsx tools/import-test.mjs` | 数据文档 |
| `pnpm deploy` 没部署 | `deploy` 是 pnpm 内建命令；必须 `pnpm run deploy` | 部署文档 |
| `wrangler login --device` 拿不到 code | 默认 IPv6 超时；`NODE_OPTIONS='--dns-result-order=ipv4first --no-network-family-autoselection'` 可拿到 code，仍需用户批准或 API token | 部署文档 |
| QA 3D 偶发黑帧 | SwiftShader 首帧慢；QA 轮询非黑帧，不是产品 bug | QA 文档 |

## 6. 当前阻塞与下一步

**唯一硬阻塞：Cloudflare 凭据。** 用户登录后：

```bash
pnpm exec wrangler login        # 或 export CLOUDFLARE_API_TOKEN=...
pnpm exec wrangler whoami
pnpm build && pnpm run deploy
# 验证
curl -I https://cbct.cyrusdoyle.me/
curl -I https://cbct.cyrusdoyle.me/data/volume_u8.bin   # 若打包了示例资产
```

**未经用户明确要求不要部署。**

后续可选（按优先级）：
1. 线上验证 + 真实手机/真实 GPU 跑一遍；把真实设备结果写回 `docs/HANDOFF-QA.md`。
2. 3D 的冠状/矢状同步平面（目前只画轴位切片 + 十字线）。
3. 压缩 DICOM（JPEG/JPEG2000）WASM 解码；Web Worker 导入。
4. 测量工具（距离/角度）、窗位拖拽、per-pane zoom 持久化。

## 7. Agent 协作纪律（血泪）

- **编辑中文文件只用 `read` / `write` / `edit` 工具**。不要用 PowerShell/`Set-Content` 处理含中文的源码/文档——本会话发生过多次 mojibake（`·` 变成 `路`、注释变 `鈥?`）。
- 外部 oxfmt/IDE 保存会与你竞争写文件，出现 `ReplaceFileW EIO (Win32 32)`：重新 `read` 再 `edit`，不要重复盲写。
- 大改前看 `docs/HANDOFF-*.md` 的“易回归点”；改完跑 `pnpm typecheck && pnpm lint && pnpm build && node tools/qa/qa2.mjs`。
- 共享工作区：多 Agent 并行时按文件/目录划清写范围；不要同时改同一文件。
- 不要删 `tools/qa/qa2.mjs`、`tools/import-test.mjs`、`tools/dental-roi.mjs`、`tools/deploy-cloudflare.md`；`tools/` 已精简到这四个（约 80KB）。
- 数据隐私：DICOM 只在浏览器本地解析，不上传；示例数据含患者信息，公开演示前先脱敏。
- 医疗声明：本工具仅供浏览/定位，不是医疗器械，不能用于诊断。

## 8. 文档索引

| 文档 | 内容 |
| --- | --- |
| `README.md` | 产品功能、快速开始、数据格式、部署摘要 |
| `docs/HANDOFF-3D-MPR-RENDERING.md` | 3D/MPR 渲染、坐标、CameraRig、切片联动、shader/ROI 裁剪 |
| `docs/HANDOFF-UI-UX.md` | 2×2 布局、TopBar/ClinicalBar/StatusBar、设置抽屉、字号缩放、i18n、移动端、断点 |
| `docs/HANDOFF-DICOM-DATA.md` | 浏览器导入、预处理脚本、u8/quantRange、牙弓 ROI、数据格式与错误处理 |
| `docs/HANDOFF-DEPLOY.md` | Cloudflare Workers 静态资源、域名、dry-run、登录/部署/验证/回滚 |
| `docs/HANDOFF-QA.md` | qa2 套件、环境、flaky 处理、回归清单、未覆盖风险 |

> 说明：`tools/` 已清理为 4 个文件；QA 截图/报告不再入库，运行 `node tools/qa/qa2.mjs` 会重新生成 `tools/screenshots/qa2-*.png` 与汇总输出（各领域文档中的截图路径均指这种运行时产物）。
