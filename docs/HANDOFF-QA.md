# HANDOFF · QA / 回归验证（CBCT Volume Lab）

> 面向下一个 AI agent：读完本文件即可在没有本次会话上下文的情况下重跑完整 QA。
> 只写 `docs/HANDOFF-QA.md`；不要改 `src/**`、`package.json`、`README.md`。

## 1. 当前状态

- 仓库为「临床阅片工作台」重做后的版本（Start screen + 2×2 四联布局 + ClinicalBar + Settings drawer）。
- 最终验证：`node tools/qa/qa2.mjs` → **desktop 42/42 + mobile 12/12 = 54/54 PASS**，**0 console error、0 page error**。
- 旧套件 `tools/qa/{desktop,mobile,mpr}.mjs` **已过时**（基于旧 UI：右侧 MPR 面板 / 只看牙齿在旧顶栏 / 旧截图 qa-*.png），一律以 `tools/qa/qa2.mjs` 为准。
- 仓库 lint 通过；`.oxlintrc.json` 的 `ignorePatterns` 已包含 `tools/qa`（QA 脚本不参与 oxlint）。
- 最近一次结果：`tools/qa/results-qa2-desktop.json`（42 pass）、`tools/qa/results-qa2-mobile.json`（12 pass）、`tools/qa/qa2-summary.json`。

## 2. 关键文件 / 命令

| 路径 | 作用 |
| --- | --- |
| `tools/qa/qa2.mjs` | 单文件 QA 套件（desktop + mobile，含启动页/导入/布局/MPR/字号/语言） |
| `tools/qa/lib.mjs` | 公共工具：Chromium 启动、PNG 解码、像素差、`makeSuite` 结果输出 |
| `tools/qa/results-qa2-*.json` | 机器可读结果（每条 check 的 pass/detail、console 日志、截图清单） |
| `tools/screenshots/qa2-*.png` | 21 张验收截图（qa2- 前缀，当前有效；qa-*.png 为旧 UI 遗留） |
| `tools/QA-REPORT.md` | 人读版 QA 报告（覆盖矩阵与证据） |

```powershell
# 1) 先启动 dev server（QA 不负责启停服务器）
pnpm dev                       # 期望 http://127.0.0.1:5173/

# 2) 确认示例资产存在
Test-Path public/data/volume_u8.bin, public/data/volume.json, public/data/dental.json

# 3) 运行 QA
node tools/qa/qa2.mjs
```

- 期望输出：终端打印每条 `PASS/FAIL` + 末尾 `QA2 SUMMARY {"desktop":"42/42","mobile":"12/12",...}`。
- 失败时先看对应 `tools/qa/results-qa2-*.json` 的 `id` 与 `detail`，再回 `tools/qa/qa2.mjs` 搜同一 id。

## 3. 环境与约定

- 浏览器：Playwright Chromium（playwright-core），可执行文件
  `${env:LOCALAPPDATA}\ms-playwright\chromium-1228\chrome-win64\chrome.exe`；可用 `CHROME_PATH` 覆盖。
- 启动参数（软件渲染）：`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`。
- 视口：desktop 1600×1000 @1x；mobile 390×844 @2x（`isMobile:true, hasTouch:true`）。
- `window.__viewer` 是 zustand store，**仅 DEV 构建注入**（`src/main.tsx`），QA 用它读 `status/layout/uiScale/cursor/meta` 等；生产构建无此对象。
- 起始页为 `status='idle'`：必须点「加载示例病例」才进入工作台；等待条件用 `status === 'ready'`（不要等 canvas）。
- 指标约定：布局/窗格用 `getBoundingClientRect`（CSS px）；截图用 `page.screenshot({ clip })` 精确裁到窗格内容区；设备像素比 desktop=1、mobile=2，canvas bitmap 尺寸 ≈ CSS×DPR（3D R3F 的 DPR 自适应范围 0.75–1.75，不要硬判等）。
- 软件渲染只有 1–6 FPS，单次全量约 2–4 分钟（desktop ~2 min、mobile ~2 min），不要用固定 `sleep` 代替帧等待。

## 4. 已踩坑清单（症状 / 根因 / 修复 / 验证）

1. **3D 窗格首帧全黑**
   - 症状：切到 2×2 或 3D 布局后立即截图，3D canvas 全黑（bright=0、std≈0）。
   - 根因：SwiftShader 下 R3F canvas 刚挂载/尺寸变化后需要多帧 + shader 编译；非渲染逻辑 bug。
   - 修复：`qa2.mjs` 的 `wait3d()` 轮询窗格截图直到 `bright>500 且 std>4`（最多 25s），再比较/截图。
   - 验证：Lead 用 8s settle 重跑同一流程 8/8 非黑（mean≈28、bright≈14.7%），故判定为环境 flake，**不要报产品 bug**。
2. **`getByRole('button',{name:'3D'})` 命中两个元素**
   - 症状：移动端点“3D”页签，实际点到顶栏 3D 布局按钮（或 strict mode 报多个匹配）。
   - 根因：顶栏布局分段控件与移动端 tab 的可见/隐藏文本都叫 `3D`（`max-[620px]:hidden` 仍有 textContent）。
   - 修复：`.last()`，或限定 tab 容器（`parent.className` 含 `shrink-0` + `gap-1`）后再点击；qa2 用后者。
   - 验证：mobile 9.6 四个 tab 逐一切换均 PASS。
3. **截图 / 像素读取偶发超时**
   - 症状：`page.screenshot` 在含 `backdrop-filter` 面板或大分辨率时偶尔 >30s 超时。
   - 根因：软件合成器慢（尤其首帧/动画中）。
   - 修复：截图超时统一放宽到 `120000ms`（`tools/qa/lib.mjs` 的 `shot/shotClip` 与 qa2 内联 screenshot）。
   - 验证：最终连续 2 轮全量无超时。
4. **旧 QA 套件对不上新 UI**
   - 症状：旧脚本找 `.panel--right`、旧顶栏 `只看牙齿` 位置、旧 `.preset` 按钮等全部失败。
   - 根因：UI 已重做为四联工作台 + Startup screen + Settings drawer。
   - 修复：只维护 `tools/qa/qa2.mjs`；旧 `desktop/mobile/mpr.mjs` 与 `results-*.json` 视为历史。
5. **用 PowerShell 写含中文的 Markdown 出现 mojibake**
   - 症状：`QA-REPORT.md` 中文变乱码/问号（Windows 控制台编码）。
   - 根因：PowerShell 重定向/管道编码非 UTF-8。
   - 修复：**一律用 `write` 工具（UTF-8）** 写中文文件，不要用 `Set-Content`/`>`。
   - 验证：`Get-Content -Encoding UTF8` 或直接打开无乱码。
6. **3D 画布首帧尺寸/黑屏与 remount 的关系**
   - 症状：切换布局/导入后 3D 首帧黑或尺寸 0，后续帧才恢复。
   - 根因：`VolumeViewport` 的 `CameraRig` 首帧可能拿到 0×0 尺寸，代码用 `useFrame` 兜底重新取景（`framedRef`）；canvas remount（key 含 `source.directory|dims`）也会重置。
   - 修复：QA 侧等待首帧；若真实回归先查 `src/three/VolumeViewport.tsx` 的 `CameraRig` 兜底逻辑，不要先怀疑渲染数据。
   - 验证：3.10 稳定 PASS（mean≈30、bright 202k）。

## 5. 回归清单（新 Agent 改完必跑）

```powershell
pnpm typecheck
pnpm lint
pnpm build
pnpm dev   # 另一个终端；build 成功后再跑 QA
node tools/qa/qa2.mjs
```

- 桌面 2×2：4 窗格各 ≈791×427（含 28px header，工作区 1600×872 的一半）；4 个 canvas CSS≈789×397 且 bitmap 非 0。
- MPR：轴/冠/矢滚轮分别只改 z/y/x；点击窗格 → 十字线落到所点体素；放大/缩小/适应窗口可用且缩放改变画面。
- 3D：轴位 cursor.z 变化时 3D 切面同步（像素差 >5%）；3D 非黑。
- 字号：默认 1.18；`设置 → 特大` → uiScale 1.55 + `localStorage['cbct-ui-scale']='1.55'`，且 1600/390 均无横向溢出。
- 语言：EN/中文切换、`documentElement.lang`、`localStorage['cbct-lang']` 跨 reload 持久化。
- 导入：起始页 → 示例加载；再对第二个 `input[type=file]` `setInputFiles(403 个 .dcm)` → `meta.source.directory === 'local import'`，免刷新替换体数据。
- 移动端：启动页适配 390、4 个 tab、始终 1 窗格、tab 切换、触摸定位、设置抽屉不越界、特大字号无溢出。
- 全程 **0 console error / 0 pageerror**（THREE.Clock deprecation warning 可忽略；Canvas2D readback warning 来自 QA 自身 getImageData）。

## 6. 未覆盖 / 风险

- 真实 GPU 性能（FPS 数据仅代表 SwiftShader；真机/独显未测）。
- 真实手机触控（仅 Playwright isMobile 模拟，无 iOS/Android 真机）。
- `dental === null`（无 ROI 病例）：“只看牙齿”禁用态未构造真实数据验证。
- 压缩/JPEG-LS/JPEG2000 DICOM、多序列/多 study、超大体积导入未覆盖。
- 真实 Cloudflare 线上部署验证（`pnpm deploy`）未做；本 QA 只对 dev server。
- 旧 `tools/screenshots/qa-*.png` 与 `tools/qa/results-{desktop,mobile,mpr}.json` 为历史产物，勿作为当前验收依据。

## 7. 建议下一步

- 把 `qa2.mjs` 拆成多个 suite（start/import/layout/mpr/settings/mobile），失败可独立重跑、并行加速。
- 接入 CI（GitHub Actions/本地脚本）：`pnpm typecheck && pnpm lint && pnpm build` + `node tools/qa/qa2.mjs`，上传 screenshots 作为 artifact。
- 截图对比阈值化（当前用 `diffRatio` 经验阈值 1%–5%），把阈值集中成常量并记录基线图。
- 增加导入错误路径测试：空文件、非 DICOM、损坏切片、只选部分序列、超大文件的内存/超时。
- 增加 `dental=null` 数据集测试（teeth 按钮禁用态）。
- 若 UI 再改版：同步更新 `tools/QA-REPORT.md` 与本文件第 1/5 节，并保留 `qa2` 的 id 编号便于 diff。

## 8. 相关产物路径

- 套件：`tools/qa/qa2.mjs`、`tools/qa/lib.mjs`
- 结果：`tools/qa/results-qa2-desktop.json`、`tools/qa/results-qa2-mobile.json`、`tools/qa/qa2-summary.json`
- 报告：`tools/QA-REPORT.md`
- 截图（21 张）：`tools/screenshots/qa2-*.png`
  - 启动/语言：`qa2-start-zh.png`、`qa2-start-en.png`、`qa2-desktop-en.png`
  - 布局：`qa2-layout-quad.png`、`qa2-layout-mpr.png`、`qa2-layout-3d.png`、`qa2-layout-3d-full.png`
  - 交互：`qa2-mpr-crosshair.png`、`qa2-mpr-zoom-before/after.png`、`qa2-3d-before/after-slice.png`、`qa2-quad-after-mpr.png`
  - 功能：`qa2-teeth-before/after.png`、`qa2-teeth-only-full.png`、`qa2-settings-xlarge.png`、`qa2-custom-import.png`
  - 移动端：`qa2-mobile-start.png`、`qa2-mobile-workspace.png`、`qa2-mobile-xsxl.png`
