# CBCT Volume Lab — 临床工作台重做后 QA 报告（qa2）

- 日期：2026-10-31 17:20（Asia/Shanghai）
- 测试对象：http://127.0.0.1:5173（Vite dev server / HMR，未重启服务）
- 版本：重做为“临床阅片工作台”之后的构建（Start screen + 2×2 四联布局 + ClinicalBar + Settings drawer）
- 执行：独立 QA（teammate `qa-verify`），只写 `tools/qa/**`、`tools/screenshots/qa2-*.png`、`tools/QA-REPORT.md`
- 脚本：`tools/qa/qa2.mjs`（复用 `tools/qa/lib.mjs` 的 Chromium/PNG 工具）；结果 JSON：`tools/qa/results-qa2-desktop.json`、`results-qa2-mobile.json`

## 结论

**54 / 54 项检查全部通过，0 失败、0 console error、0 page error。** 未发现产品阻塞性 bug，无需 Lead 修复。

| 套件 | 视口 | 结果 | 用时 |
|---|---|---|---|
| `qa2` desktop | 1600×1000 @1x | **42 / 42 PASS** | 117 s |
| `qa2` mobile | 390×844 @2x（isMobile/touch） | **12 / 12 PASS** | 122 s |

软件渲染（SwiftShader）下 FPS 1–4，属环境限制；截图取帧已改为“轮询非黑画面 + 等待 rAF”，避免 3D 首帧未编译时误判（本轮唯一一次 flaky 已用该方式消除，非产品问题）。

## 覆盖矩阵

### A. 启动页（Start screen）—— 3/3

| ID | 检查 | 结果 | 证据 |
|---|---|---|---|
| 1.1 | 初始 `status='idle'`，无 canvas | PASS | status idle, canvasCount 0 |
| 1.2 | 标题“打开 CBCT 影像”+ 打开 CBCT 文件夹 / 选择 DICOM 文件 / 加载示例病例 | PASS | 四个文案均命中 |
| 1.3 | 两个隐藏 `input[type=file]`（folder + files），folder 带 webkitdirectory | PASS | inputs=2, folderAttr=true |

截图：`qa2-start-zh.png`、`qa2-start-en.png`。

### B. 示例病例加载 / 工具栏 / ClinicalBar —— 6/6

| ID | 检查 | 结果 | 证据 |
|---|---|---|---|
| 2.1 | 加载示例病例 → ready，元数据来自示例目录 | PASS | src=`Dicom/20260314112507-0-1-10`，dims 320×320×200 |
| 2.2 | dental ROI 加载（teeth 按钮可用） | PASS | dental=true, version=1 |
| 2.3 | 默认界面字号 1.18（无本地覆盖） | PASS | uiScale=1.18, storage=null |
| 2.4 | 工具栏三行高度：TopBar 56 / ClinicalBar 44 / StatusBar 28 | PASS | 56 / 44 / 28 |
| 2.5 | ClinicalBar 窗位 chips 生效：软组织→WW500/WC50，骨窗→WW2600/WC600，读数同步 | PASS | readout 同步更新 |
| — | 渲染预设 select 8 项 | PASS | 见 5.4 |

### C. 布局（2×2 / 多平面 / 3D）与窗格尺寸 —— 10/10

| ID | 检查 | 结果 | 证据 |
|---|---|---|---|
| 3.1 | 布局分段控件有 2×2 / 多平面 / 3D，互斥 pressed | PASS | 3 个按钮 |
| 3.2 | 2×2 恰好 4 个窗格 | PASS | 4 panes |
| 3.3 | 四窗格为 轴位 / 冠状位 / 矢状位 / 3D 体渲染 | PASS | titles 命中 |
| 3.4 | 每窗格约为工作区一半：791×427（含 28px header），期望 791×427 | PASS | 4 个窗格尺寸一致 |
| 3.5 | 4 个 canvas CSS 尺寸 == 窗格内容区（误差 <2.5px） | PASS | 均为 789×397 |
| 3.6 | 4 个 canvas bitmap 尺寸真实非 0 | PASS | 789×397（对应 DPR1） |
| 3.7 | 三个 MPR 切片都含渲染像素（2D readback 亮像素） | PASS | 92 820 / 202 639 / 194 325 |
| 3.8 | 多平面布局 = 3 个窗格（全 MPR） | PASS | titles 轴位/冠状位/矢状位 |
| 3.9 | 3D 布局 = 1 个窗格（WebGL canvas） | PASS | 1 pane, 1586×830 |
| 3.10 | 3D 体渲染非黑（含首帧等待轮询） | PASS | mean 30.28, std 58.27, 亮像素 202 331 |

截图：`qa2-layout-quad.png`、`qa2-layout-mpr.png`、`qa2-layout-3d.png`、`qa2-layout-3d-full.png`。

### D. MPR 交互 —— 5/5

| ID | 检查 | 结果 | 证据 |
|---|---|---|---|
| 4.1 | 滚轮落在轴位/冠状位/矢状位，分别只改 z/y/x | PASS | z 101→102、y 161→162、x 161→162 |
| 4.2 | 点击轴位窗格把十字线定位到所点体素（约 96,128） | PASS | 实测 (95,127) |
| 4.3 | 放大 / 缩小 / 适应窗口 三个 aria-label 按钮存在 | PASS | 3/3 |
| 4.4 | 点“放大”改变渲染结果 | PASS | 像素差比 31% |
| 4.5 | 轴位 cursor.z 变化时 3D 窗格同步更新（轴位切面 overlay） | PASS | z 101→107，3D 像素差比 15.3% |

截图：`qa2-mpr-crosshair.png`、`qa2-mpr-zoom-before.png`、`qa2-mpr-zoom-after.png`、`qa2-3d-before-slice.png`、`qa2-3d-after-slice.png`、`qa2-quad-after-mpr.png`。

### E. 只看牙齿 / 预设 —— 5/5

| ID | 检查 | 结果 | 证据 |
|---|---|---|---|
| 5.1 | 有 dental 时按钮未禁用 | PASS | disabled=false |
| 5.2 | 点击后 teethOnly=true 且 presetId='teeth' | PASS | — |
| 5.3 | 牙齿模式改变 3D 渲染 | PASS | 3D 像素差比 26.7% |
| 5.4 | 渲染风格 select 8 个预设（teeth/bone/dental/soft/mip/xray/heat/teal） | PASS | options=8 |
| 5.5 | 切换 select → presetId 同步（mip） | PASS | — |

截图：`qa2-teeth-before.png`、`qa2-teeth-after.png`、`qa2-teeth-only-full.png`。

### F. 设置抽屉 / 界面字号 —— 5/5

| ID | 检查 | 结果 | 证据 |
|---|---|---|---|
| 6.1 | 设置按钮打开右侧抽屉，含“界面字号”与小/标准/大/特大 | PASS | 抽屉文本/按钮命中 |
| 6.2 | 点“特大” → uiScale=1.55 且 localStorage `cbct-ui-scale`=1.55 | PASS | — |
| 6.3 | chrome 字号实际变大 | PASS | 10.62px → 13.95px（×1.31） |
| 6.4 | 1600×1000 下无横向溢出 | PASS | body 1600/1600；header 1600/1600 |
| 6.5 | Escape 关闭抽屉 | PASS | settingsOpen=false |

截图：`qa2-settings-xlarge.png`（特大字号 + 抽屉）。

### G. 语言切换 / 持久化 —— 4/4

| ID | 检查 | 结果 | 证据 |
|---|---|---|---|
| 7.1 | EN → 英文 UI、`documentElement.lang='en'`、`localStorage['cbct-lang']='en'`；Settings / Teeth only / MPR 标签切换 | PASS | — |
| 7.2 | reload 后英文保持（启动页也为英文） | PASS | status idle, lang en, docLang en |
| 7.3 | 英文下加载示例成功，且 UI 字号 1.55 继续生效 | PASS | uiScale 1.55 |
| 7.4 | 切回中文 → `zh-CN` + localStorage `zh` | PASS | — |

截图：`qa2-desktop-en.png`。

### H. 通用 DICOM 导入（真实文件，in-browser）—— 3/3

驱动第二个隐藏 input：`setInputFiles(403 个示例 .dcm 文件，313 MB)`。

| ID | 检查 | 结果 | 证据 |
|---|---|---|---|
| 8.1 | 导入后不刷新页面直接把体数据替换为导入结果 | PASS | `meta.source.directory === 'local import'`，dims 320×320×200，耗时 7.5 s（两轮 7.1 / 11.6 s） |
| 8.2 | 导入后生成 preview poster + dental ROI | PASS | preview=true, dental=true |
| 8.3 | 导入后工作区仍四联渲染 | PASS | 4 panes 全在 |

截图：`qa2-custom-import.png`（导入后的四联工作台）。

> 说明：Lead 估计 2–6 s；本机 headless SwiftShader + 313 MB 文件实际测得 7.5–11.6 s，属环境性能差异，非失败。

### I. 移动端 390×844 @2x —— 12/12

| ID | 检查 | 结果 | 证据 |
|---|---|---|---|
| 9.1 | 初始启动页（中文） | PASS | status idle |
| 9.2 | 启动页无横向溢出，3 个按钮都在视口内 | PASS | body/doc/inner=390 |
| 9.3 | 加载示例成功 | PASS | dims 320×320×200 |
| 9.4 | 四个页签 轴位/冠状位/矢状位/3D 存在 | PASS | 4 tabs（排除顶栏 3D 布局按钮干扰） |
| 9.5 | 始终只显示 1 个窗格 | PASS | count=1 |
| 9.6 | 逐个点页签切换窗格 | PASS | 轴位→冠状位→矢状位→3D→轴位 均切换 |
| 9.7 | 加载后无横向溢出 | PASS | 390/390/390 |
| 9.8 | 触摸点击窗格移动十字线 | PASS | (160,160,100) → (101,115,100) |
| 9.9 | 设置抽屉在移动端展开且不越界 | PASS | x=30, w=360 |
| 9.10 | 特大字号（1.55）下无横向溢出 | PASS | body 390/390 |
| C.1/C.2 | 无 page error / console error | PASS | 0 / 0 |

截图：`qa2-mobile-start.png`、`qa2-mobile-workspace.png`、`qa2-mobile-xsxl.png`。

## 控制台 / WebGL 警告（单独列出，均非 error）

- **console error：0；pageerror：0**（桌面 + 移动端）。
- 仅有的 warning：
  1. `THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.` —— three.js/@react-three 内部弃用提示，应用层无直接影响（出现 1–3 次）。
  2. `Canvas2D: Multiple readback operations using getImageData are faster with the willReadFrequently attribute set to true.` —— **来自 QA 脚本对 MPR 画布做像素读回**，非应用代码路径；若希望消除，可在测试侧去掉 readback，或产品侧对做 `getImageData` 的 2D 上下文加 `{ willReadFrequently: true }`（非必须）。
- 无 WebGL context lost / shader 编译错误日志。

## 稳定性说明（flaky 处理，非产品 bug）

- 首次完整跑测时 3D 布局首帧在软件渲染下偶发全黑（R3F canvas 刚挂载、shader 未编译完）：改为**轮询窗格截图直到非黑（最多 25 s）**后连续 2 轮均稳定通过。
- MPR 点击坐标按“图像 letterbox 后的实际视图”换算（窗格 40%/40% ≈ 切片 30%/40%），修正后 PASS；产品行为本身正确。

## 复现

```powershell
# 前提：dev server 已在 http://127.0.0.1:5173/ 运行
node tools/qa/qa2.mjs
```

输出：`tools/qa/results-qa2-desktop.json` / `results-qa2-mobile.json` / `qa2-summary.json`，截图 `tools/screenshots/qa2-*.png`（21 张）。

## 未覆盖 / 说明

- 未执行 `pnpm build` / `vite preview`（生产构建仍由 Lead 负责）。
- “无 dental 时只看牙齿按钮禁用”未构造到真实场景（示例与导入都有 dental）；仅验证有 dental 时 not disabled。若需要可后续构造一个无 ROI 数据集验证。
- 未做真机 GPU 性能测试；FPS 仅代表 SwiftShader 软件渲染环境。
- 本报告替代上一版（旧 UI 的 `qa-*.png` 截图已过时，以 `qa2-*.png` 为准）。
