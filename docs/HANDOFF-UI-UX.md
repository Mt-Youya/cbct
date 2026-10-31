# HANDOFF · 临床工作台 UI/UX（CBCT Volume Lab）

> 读者：接手的下一个 AI agent，无本次会话上下文。
> 范围：临床阅片工作台的界面层——TopBar、ClinicalBar、StatusBar、2×2/多平面/3D 工作区、移动端页签、Settings drawer、字号缩放、i18n、可访问性、Tailwind v4 约定与踩坑。
> 不覆盖：DICOM 与体数据管线（见 `docs/HANDOFF-DICOM-DATA.md`）、3D/MPR 渲染细节（见 `docs/HANDOFF-3D-MPR-RENDERING.md`）、QA（见 `docs/HANDOFF-QA.md`）、部署（见 `docs/HANDOFF-DEPLOY.md`）。
> 本文档只读参考：不要因为本文件而修改 `src/**`、`package.json`、`README.md`。

## 1. 当前状态 / 范围

- 应用形态：暗色临床阅片工作台。`status='idle'` 时是全屏 Start screen（`LoadingOverlay`，仅 DEV/初次进入），加载或导入完成后进入工作台：`TopBar` → `ClinicalBar` → `Workspace` → `StatusBar`，`SettingsDrawer`/`LoadingOverlay` 为覆盖层。
- 工作区布局由 store 的 `layout: 'quad' | 'mpr' | '3d'` 驱动（默认 `quad`）：
  - `quad`（2×2）：轴位/冠状位/矢状位三个 MPR + 右下 3D 体渲染，`grid-cols-2 grid-rows-2`。
  - `mpr`：三个 MPR 并排，`grid-cols-3 grid-rows-1`。
  - `3d`：单个 3D 窗格，`grid-cols-1 grid-rows-1`。
  - `<900px`（`matchMedia('(max-width: 899px)')`）不再用网格，改为单窗格 + 4 个页签（轴位/冠状位/矢状位/3D）。
- Chrome 规格：TopBar `h-14`（56px）、ClinicalBar `h-11`（44px）、StatusBar `h-7`（28px）、窗格 header `h-7`；均 `shrink-0` 且为 flex column 直接子项（`App` 根节点 `className="app flex flex-col"`）。
- 已实现：窗宽窗位快捷 chip、8 个渲染预设在临床条内切换、只看牙齿（无 dental ROI 时禁用）、界面字号 4 档（1.0/1.18/1.36/1.55）、中英切换并持久化、拖拽/文件夹/多选导入、键盘快捷键、移动端单窗格页签、全域 aria 标注。
- 遗留：`src/ui/MprPanel.tsx`、`src/three/VolumeCanvas.tsx` 已无引用（legacy 参考）；`styles.css` 仍保留一整套旧面板 CSS（`.panel`、`.preset` 等）供 Settings drawer 的 `PatientSection`/`RenderSection` 与旧样式字号覆盖使用。

## 2. 关键文件与接口

| 路径 | 作用 / 要点 |
| --- | --- |
| `src/App.tsx` | flex column 骨架；自定义事件监听；键盘快捷键；拖拽导入；两个隐藏 `input[type=file]`（见 §3.2）；`uiScale` → CSS 变量 effect。 |
| `src/ui/TopBar.tsx` | `<header class="flex h-14 shrink-0 items-center justify-between gap-2.5 overflow-hidden border-b border-[#94a3b8]/15 bg-[#04070c] px-3 ...">`；左品牌 + 患者 chip，右 Import / 布局分段控件 / 只看牙齿 / 语言 / 设置。 |
| `src/ui/ClinicalBar.tsx` | `<div class="flex h-11 shrink-0 items-center gap-2 overflow-x-auto overflow-y-hidden border-b ... bg-[#0a1118] px-3 [scrollbar-width:none] ...">`；窗宽窗位 chips + `WW/WC` + 渲染预设 `<select>`；`!meta` 时渲染等高 skeleton。 |
| `src/ui/StatusBar.tsx` | `<footer class="flex h-7 shrink-0 items-center justify-between gap-3 border-t ... bg-[#050a10] px-3 font-mono text-[9px] ...">`；体素/HU/WW·WC/预设/FPS。`!volume || !meta` 时返回 `null`。 |
| `src/ui/Workspace.tsx` | `useMediaQuery('(max-width: 899px)')`；`Pane({title, info, children})` 提供窗格 chrome；`gridClass` 映射三种布局；3D 窗格按 `${meta.source.directory}|${dims.join('x')}` 作 key。 |
| `src/ui/SettingsDrawer.tsx` | `fixed inset-0 z-40` 抽屉（`w-[360px] max-w-[94vw]`），Escape 关闭；界面字号 4 档 → `setUiScale`；内嵌 `PatientSection`/`RenderSection`。 |
| `src/ui/LoadingOverlay.tsx` | Start screen / loading / error 三态；按钮分别 dispatch `cbct:import`、`cbct:import-files`、`cbct:sample`。 |
| `src/ui/viewport/MprViewport.tsx` | MPR 窗格内容：`div.relative.h-full.w-full.overflow-hidden.bg-black` + 绝对定位 canvas（`h-full w-full touch-none select-none`）+ 右上角 `+ / − / F` 缩放按钮（aria-label：`zoom.in/out/fit`）。属"窗格 chrome"边界：标题/外框在 `Workspace.Pane`，缩放按钮在本组件。 |
| `src/i18n.ts` | `MessageKey` 联合类型（约 150 个 key）+ `ZH`/`EN` 两套字典；`translate(lang, key)`、`presetLabel(lang, id)`、`windowLabel(lang, id, fallback)`。缺 key 时 `translate` 回退返回 key 本身。 |
| `src/styles.css` | `@import "tailwindcss";`；1143 行；**末尾 1096–1143 行**是本子系统唯一的字号覆盖块（见 §3.4），其余为旧面板/加载器 CSS。 |
| `src/store/useViewerStore.ts` | zustand store（283 行）。本子系统字段：`layout`、`settingsOpen`、`uiScale`、`lang`、`teethOnly`、`presetId`、`windowCenter`、`windowWidth`、`meta`、`dental`；动作：`setLayout`、`toggleSettings`/`setSettingsOpen`、`setUiScale`、`toggleLang`/`setLang`、`setTeethOnly`、`setPreset`、`setWindow`。类型 `WorkspaceLayout = 'quad' | 'mpr' | '3d'`。 |
| `src/main.tsx` | 仅 `import.meta.env.DEV` 时 `window.__viewer = useViewerStore`（QA/手动调试依赖，勿删）。 |

## 3. 必须理解的约定

### 3.1 响应式断点（Tailwind v4 语义：`max-[Npx]:` = `width < Npx`，`min-[Npx]:` = `width >= Npx`）

- `≥900px` 桌面：`Workspace` 走网格；TopBar 品牌文字出现（`hidden min-[900px]:flex`）；ClinicalBar 两个节标题出现。
- `≤899px`：`matchMedia('(max-width: 899px)')` → 单窗格 + 4 页签；ClinicalBar 隐藏“窗宽窗位 / 渲染风格”标题（`max-[900px]:hidden`），只留 chips/读数/select。
- `<620px`（`max-[620px]:hidden`）：TopBar 按钮文字隐藏，只留 SVG 图标 + aria-label。
- `<480px`（`max-[480px]:hidden`）：患者 chip 整块隐藏（姓名/ID/日期都不显示）。
- `≥1100px`（`min-[1100px]:flex`）：TopBar 患者 chip 内显示检查日期 `YYYY-MM-DD` 与模态（`CT`）。
- `<900px`：TopBar 两处分隔线隐藏；ClinicalBar 内容在约 <510px 时出现横向滚动（`overflow-x-auto`，不是溢出）。
- `StatusBar` 用 Tailwind 默认断点逐级隐藏：`sm(640)` 起显示 HU、`md(768)` 起显示窗宽窗位、`lg(1024)` 起显示预设名、`xl(1280)` 起显示操作提示。
- Settings drawer：宽 `360px`，最大 `94vw`；`fixed inset-0 z-40` 覆盖 TopBar，见坑 §4.9。

### 3.2 自定义事件（跨组件唯一通信方式，勿改成 props 层层透传）

- `cbct:import`：打开**文件夹**选择器（`input[type=file]` 第 0 个，挂载 `webkitdirectory`/`directory`）；TopBar「打开/Import」、Start screen「打开 CBCT 文件夹」、错误页按钮都 dispatch 它。
- `cbct:import-files`：打开**多文件**选择器（第 1 个 input，无目录属性）；Start screen「选择 DICOM 文件」使用。QA 用 `.nth(1).setInputFiles(...)` 做通用导入。
- `cbct:sample`：加载内置示例病例（`load()`）；Start screen「加载示例病例」使用。
- 监听都在 `App.tsx` 的一个 `useEffect` 里注册/清理；新增入口只需 `window.dispatchEvent(new Event(...))`，不要直接操作 `input` DOM。

### 3.3 键盘快捷键（`App.tsx`，输入框/textarea/select/contentEditable 内不触发）

- `Space` 暂停/恢复自动旋转；`G` 网格开关；`T` 只看牙齿；`S` 打开/关闭 Settings；`L` 循环 `quad→mpr→3d`；`1–8` 依次切 8 个渲染预设（顺序见 `src/data/presets.ts` 的 `PRESETS`）。

### 3.4 字号缩放链路（改字号/加文字前必读）

1. Settings drawer 4 档：`1.0 小 / 1.18 标准 / 1.36 大 / 1.55 特大` → `setUiScale(value)`（clamp `0.8..1.6`，写 `localStorage['cbct-ui-scale']`）。默认 `detectUiScale()` = `1.18`。
2. `App.tsx` effect：`document.documentElement.style.setProperty('--ui-font-scale', String(uiScale))`，并 `document.documentElement.dataset.uiScale = 'on'`。
3. `styles.css` 末尾：`:root { --ui-font-scale: 1.18; }` + `[data-ui-scale] .text-\[7.5px|8|9|9.5|10|11|11.5|12|13|14|20|22|26px\] { font-size: calc(Npx * var(--ui-font-scale)); }`，并覆盖旧面板类（`.panel-section`、`.section-kicker`、`.patient__name`、`.stat__value`、`.toggle`、`.chip`、`.mpr-view__*`、`.loader__*` 等）。
4. Canvas 内文字**不吃 CSS**：`MprViewport` 用 `Math.round(10 * uiScale)`、`Math.round(9 * uiScale)`、`labelPad = 9 * uiScale` 手动乘；3D 侧文字在 DOM 中，正常继承。
5. 规则：**新增任何 `text-[Npx]` 任意字号，必须同步在 `styles.css` 尾部覆盖块加一行**，否则特大字号下该文字不放大、界面比例失真。

### 3.5 持久化与 QA 契约

- localStorage keys：`cbct-lang`（`'zh' | 'en'`，默认 `zh`，`setLang` 写入）、`cbct-ui-scale`（数字字符串，合法范围 `0.8–1.6`，非法则回退 `1.18`）。
- 两处 `detect*()` 都在 store 初始化时读取；SSR/无 window 时给默认值。
- QA 依赖 `window.__viewer.getState()` 读取 `lang/uiScale/layout/settingsOpen/teethOnly/...` 与 `document.documentElement.lang`、`localStorage` 值。

### 3.6 可访问性与 Tailwind v4

- 文字隐藏 ≠ 可访问名消失：`max-[620px]:hidden` 只隐藏 `span`，按钮始终保留 `aria-label`；布局按钮/牙齿/设置/移动端页签/窗宽 chips 都有 `aria-pressed`；`<select>` 有 `aria-label`（`toolbar.render`）；抽屉背板按钮 `aria-label="close settings"`，`Escape` 可关闭；牙齿按钮在 `dental == null` 时 `disabled` 且 title 换成 `teethUnavailable`。
- Tailwind v4 无 `tailwind.config.*`：`styles.css` 首行 `@import "tailwindcss";`，`vite.config.ts` 用 `@tailwindcss/vite` 插件，内容自动扫描。样式一律 utility；唯二例外是 `styles.css` 尾部的字号覆盖块与 legacy 面板 CSS。动态内联 style 只用于：Settings 字号预览按钮、加载器缩略图 `backgroundImage`、进度条宽度。

## 4. 已踩坑清单（症状 / 根因 / 修复 / 验证）

1. **窗格按内容收缩，2×2 大面积黑边、MPR 很小**
   - 症状：工作区只剩一个按标题文字宽度的小黑窗格，canvas 接近 0；或四宫格尺寸不均。
   - 根因：`grid`/`flex` 子项里的 `section` 缺 `h-full w-full min-w-0 min-h-0`，被内容（header 文本）撑成收缩宽度；3D canvas 父容器无确定尺寸后塌陷。
   - 修复：`Workspace.Pane` 的 section 固定 `relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-md border border-[#94a3b8]/15 bg-[#020508]`；内容区 `relative min-h-0 flex-1`；网格子项外层 `flex min-h-0 min-w-0`；`VolumeViewport` 自带 `div.relative.h-full.w-full`。
   - 验证：1600×1000 下四窗格 ≈`791×427`（含 28px header），canvas CSS ≈`789×397`；`qa2` 3.4–3.6 PASS；拖窗口缩放不塌陷。

2. **Tailwind 任意字号 `text-[9px]` 不随根字号缩放**
   - 症状：把浏览器/`html` 根字号调大或做“特大”档，面板文字变大但用任意 px 的 chrome 文字不变。
   - 根因：`text-[9px]` 编译为绝对 `font-size: 9px`，不继承 rem/根字号。
   - 修复：不改工具类数量、不全局 `transform: scale`；由 App 设 `--ui-font-scale` + `data-ui-scale`，在 `styles.css` 尾部用 `[data-ui-scale] .text-\[9px\] { font-size: calc(9px * var(--ui-font-scale)); }` 等逐档覆盖（含旧面板类）。
   - 验证：`qa2` 6.x 与 9.10——`设置 → 特大` 后 `uiScale===1.55`、`localStorage['cbct-ui-scale']==='1.55'`，1600×1000 与 390×844 均无横向溢出；`qa2-settings-xlarge.png`、`82-font-xlarge.png` 可目检。

3. **顶栏/临床条在 390px 溢出**
   - 症状：移动端 TopBar 右侧按钮被裁掉，或临床条把页面撑出横向滚动（body scrollWidth > innerWidth）。
   - 根因：桌面放了品牌文字、患者 study 字段与按钮世界文字，窄屏总宽超过视口。
   - 修复：品牌 `<900` 隐藏；检查日期/模态 `<1100` 隐藏；按钮文字 `<620` 隐藏（保留图标 + aria-label）；患者 chip `<480` 整块隐藏；TopBar 根节点 `overflow-hidden` + 左右两簇 `min-w-0 flex-1` / `shrink-0` 截断；ClinicalBar 用 `overflow-x-auto` + 子项 `shrink-0`。
   - 验证：390×844 无横向溢出（`qa2` 9.2/9.7）；手动在 620/619、480/479 边界检查 `header.scrollWidth === header.clientWidth`。

4. **3D 与 MPR 的 section / canvas 尺寸 / DPR 约定**
   - 约定：3D 用 R3F `<Canvas dpr={[1,2]}>`，`PerfProbe` 会按 FPS 自适应到 0.75–1.5，**不要硬判 canvas bitmap 尺寸**；MPR 用 `dpr = min(2, devicePixelRatio)`，`ResizeObserver` 读 CSS 尺寸，bitmap = `round(cssW*dpr) × round(cssH*dpr)`，`ctx.setTransform(dpr,...)` 后按 CSS 坐标绘制。
   - 坑：用 `window.innerWidth` 或 `document.querySelector` 给窗格定尺寸 → 布局切换/移动端页签后错位；首帧 0×0 → 3D 黑屏（`CameraRig` 用 `useFrame` 兜底，见渲染文档）。
   - 修复/验证：一切尺寸来自父容器（`h-full w-full`）与 `ResizeObserver`/`useThree(s=>s.size)`；`qa2` 3.5/3.6、4.3/4.4 PASS。

5. **移动端 Playwright `getByRole('button',{name:'3D'})` 命中两个元素**
   - 症状：点“3D”页签实际点到 TopBar 的 3D 布局按钮，或 strict mode 报多个匹配。
   - 根因：TopBar 布局分段控件与移动端页签都叫 `3D`（`max-[620px]:hidden` 只隐藏可见文字，`textContent` 仍在）。
   - 修复：`.last()`，或先用 `parent.className` 定位页签容器（`shrink-0` + `gap-1`）再点（`qa2` 用后者）；禁止只按可见文本断言唯一性。
   - 验证：`qa2` mobile 9.4/9.6——4 个页签逐一切换、始终 1 个窗格。

6. **用 PowerShell `Set-Content`/重定向写中文 → mojibake（本仓库真实发生过）**
   - 症状：`tools/QA-REPORT.md`、`README.md`、`VolumeViewport.tsx` 注释出现 `铏?`/`锜?`/`璁剧疆` 等乱码。
   - 根因：Windows PowerShell 默认编码/管道按 GBK 等代码页解码 UTF-8 中文后落盘。
   - 修复：写/改含中文文件**一律用 `write`/`edit` 工具（UTF-8）**，不要 `Set-Content`/`>`/here-string；修乱码整文件重写，不要逐行 sed。
   - 验证：`read` 工具打开中文正常、无 `?`/异常码点；当前乱码只在注释/文档，不影响 `pnpm typecheck`。

7. **oxfmt 外部保存与手写编辑竞争（EIO EBUSY）**
   - 症状：编辑器/代理保存 `src/**` 或文档时偶发 `EIO`/`EBUSY`，或格式化器写入被覆盖。
   - 根因：`oxfmt --write` 与另一个进程（编辑器自动保存、并行 agent）同时写同一文件；Windows 文件锁语义下重命名/替换会失败。
   - 修复：不要在一次编辑流里穿插 `oxfmt`；最终只由一个 owner 执行格式化；失败就**重读文件 → 重新 edit（幂等）**，不要盲目重试整目录格式化。
   - 验证：`pnpm typecheck` / `pnpm lint` 通过且文件内容为期望版本（本仓库无 git，改前先 read 再 edit）。

8. **字号 155%（特大）不能溢出（1600 与 390 都测过）**
   - 症状：切到 1.55 后 TopBar 右侧被裁、临床条撑破视口或患者 chip 与按钮重叠。
   - 根因：字号放大后按钮/文字实际宽度变大，桌面按 1.18 设计的宽度余量不足。
   - 修复：字号只通过 §3.4 链路放大；布局继续依赖隐藏规则（<620 图标化、<480 隐 chip、品牌 <900 隐藏）+ `min-w-0`/`truncate`/`overflow-x-auto`，不要为特大字号加固定宽度。
   - 验证：`qa2` 桌面 6.x、移动 9.10（1.55 @1600×1000 与 390×844 均 `bodyScrollWidth<=innerWidth`）；`qa2-settings-xlarge.png`、`qa2-mobile-xsxl.png` 可目检。

9. **Settings drawer 打开时 Playwright 点 TopBar 无效（背板拦截）**
   - 症状：`设置` 打开后继续点 TopBar/工作区，出现 “subtree intercepts pointer events” 或点击落空。
   - 根因：抽屉是 `fixed inset-0 z-40`，背板 `<button aria-label="close settings">` 覆盖全屏，属于预期交互。
   - 修复：自动化先 `keyboard.press('Escape')` 或点 `button[aria-label="close settings"]` 关闭抽屉，再操作底层；手动验收同理。
   - 验证：`qa2` 6.x 逐档字号后继续跑布局/语言检查均 PASS。

10. **ClinicalBar 未加载/未导入时的占位与 StatusBar 空态**
    - 症状：`meta` 为空时临床条突然少 44px 导致工作区跳变；或状态栏在 Start screen 也占位。
    - 根因：数据依赖组件直接 `return null`。
    - 修复：ClinicalBar 在 `!meta` 时渲染**同高 `h-11` skeleton**（`aria-hidden` + `animate-pulse`），保证布局不跳；StatusBar 在 `!volume || !meta` 返回 `null`（Start screen 由全屏 loader 覆盖，视觉上无抖）。新增加载态时沿用该约定。
    - 验证：Start screen → 加载示例病例过程中工作区不发生高度跳动；`qa2` 3.x 尺寸断言稳定。

## 5. 易回归点 / 不要做的事

- **不要把工作区改回右侧 352px 小面板 / absolute 覆盖式 MPR 面板**：现在是 flex column 中 `Workspace` 占 `flex-1` 的临床网格；`leftOpen/rightOpen` 是旧面板遗留字段，勿再驱动布局。
- **不要移除移动端 aria-label / aria-pressed**：文字在 <620px 被隐藏后，aria-label 是唯一可访问名；`qa2` 与无障碍都依赖它。
- **不要用固定 px 或 `transform: scale()` 掩盖字号缩放**：必须走 `uiScale → --ui-font-scale → styles.css 覆盖 + canvas 手动乘`；新增 `text-[Npx]` 必须同步补覆盖行。
- **不要把患者 chip / 病例信息放回 Start screen 逻辑**：工作台顶部常驻患者身份；Start screen 只负责导入入口（文件夹/多文件/示例/拖拽）。
- **不要改 `Workspace.Pane` 的 `h-full w-full min-h-0 min-w-0` 组合**，也不要给网格子项加固定宽高；否则回到坑 1。
- **不要让 TopBar/ClinicalBar 在窄屏恢复文字**（620–900 区间尤其）：空间不足会溢出；需要新信息时优先用 aria-label + title。
- **不要删除 `window.__viewer`**（`main.tsx` DEV hook）：QA 与手动调试依赖。
- **不要删 ClinicalBar 的 skeleton / StatusBar 的空态**；不要在加载中插入会改变 56/44/28px 高度的内容。
- **不要用 `Get-Content`/`Set-Content` 处理中文文件写回**（读也会受代码页影响）：一律 read/write/edit 工具。
- **不要新增全局 CSS 覆盖 Tailwind 字号**（除 `styles.css` 尾部覆盖块外）：会造成双份字号规则互相打架。

## 6. 验证命令与预期

```powershell
pnpm install
pnpm typecheck     # tsc -b，期望 0 error（noUnusedLocals 严格）
pnpm lint          # oxlint，期望 0 warning/error
pnpm build         # tsc -b && vite build
pnpm dev           # http://127.0.0.1:5173
node tools/qa/qa2.mjs   # 需先启动 dev server；约 2–4 分钟
```

- QA 期望：`QA2 SUMMARY {"desktop":"42/42","mobile":"12/12","screenshots":21}`，0 console error、0 page error；desktop 1600×1000、mobile 390×844。
- 若运行 qa2 报 `Cannot find module './lib.mjs'`：说明 `tools/qa/lib.mjs`（Chromium 启动/PNG 解码/makeSuite 工具）不在工作区，先按 `docs/HANDOFF-QA.md` §2 恢复；`qa2.mjs` 自身产出 `tools/qa/qa2-summary.json`，截图/明细由 `lib.mjs` 写入 `tools/screenshots/qa2-*.png` 与 `tools/qa/results-qa2-*.json`。
- 手动验收（每项都能在 30s 内确认）：
  - 布局：`2×2 / 多平面 / 3D` 三段切换 → 窗格数量 4 / 3 / 1；`<900px` 变单窗格 + 4 页签，页签切换只留 1 个窗格。
  - 字号：`设置 → 特大` → 字号整体放大、`localStorage['cbct-ui-scale']='1.55'`；在 1600 与 390 宽下均无横向滚动；刷新后保持。
  - 语言：`EN / 中文` 切换 → `document.documentElement.lang` 变 `en`/`zh-CN`，`localStorage['cbct-lang']` 持久化；刷新后按钮/标题文案一致。
  - 顶栏尺寸：`header` 高 56px、临床条 44px、状态栏 28px；390px 宽下 `header.scrollWidth === header.clientWidth`（无裁切）。
  - 牙齿：有 dental ROI 时按钮可用；无 ROI 时 `disabled` + title=`teethUnavailable`，3D 不裁剪。
  - 导入：Start screen「打开 CBCT 文件夹 / 选择 DICOM 文件 / 加载示例病例」三入口均可用；拖拽目录到窗口出现 overlay 且松手导入。
  - 键盘：`L` 循环布局、`S` 抽屉、`T` 牙齿、`Space` 旋转、`1–8` 预设。

## 7. 未完成 & 建议下一步

- 快捷键提示面板/问号帮助：目前快捷键只存在于 `App.tsx`，UI 无 discoverability（可在 Settings drawer 或底栏加 `?` 入口）。
- 更多布局：2-up（轴向对比）、1×3 竖排、可拖拽分栏；需要扩展 `WorkspaceLayout` 与 `Workspace` 的 `gridClass`/panes，并同步 qa2 布局断言。
- 主题/对比度：当前只有暗色主题；可加高对比度/亮色或色盲友好的窗宽窗位 chip 配色，并为 `prefers-reduced-motion` 关闭过渡。
- 触摸手势：MPR 目前只支持 `Ctrl/⌘+滚轮` 缩放，移动端无双指 pinch；可加 pointer 双指手势与双击缩放动画。
- per-pane 状态持久化：`MprViewport` 的 `zoom/pan` 为本地 state，切布局即丢失（提升到 store 需按 axis 存、避免每帧写 store）。
- 抽屉焦点管理：无 focus trap / 返回焦点，键盘用户 Tab 可逃出抽屉；补 focus trap 与 `aria-modal`。
- 移动端 480–620px 区间患者 chip 与图标按钮较挤：可考虑 <560px 也隐藏 chip，或 chip 只显示姓名。
- i18n 完整性：新增文案必须同时加 `MessageKey` 与 `ZH/EN` 两套值（`Record<MessageKey,string>` 会强制）；可加缺 key 的 lint/脚本检查。
- 视觉回归：目前只有 qa2 截图人工目检；可接 Playwright `toHaveScreenshot` 基线（先固定 dev server 与 DPR）。

## 8. 相关产物

- QA 截图（21 张）：`tools/screenshots/qa2-*.png` —— 启动/语言 `qa2-start-zh.png`、`qa2-start-en.png`、`qa2-desktop-en.png`；布局 `qa2-layout-quad.png`、`qa2-layout-mpr.png`、`qa2-layout-3d.png`、`qa2-layout-3d-full.png`；交互 `qa2-mpr-crosshair.png`、`qa2-mpr-zoom-before/after.png`、`qa2-3d-before/after-slice.png`、`qa2-quad-after-mpr.png`；功能 `qa2-teeth-before/after.png`、`qa2-teeth-only-full.png`、`qa2-settings-xlarge.png`、`qa2-custom-import.png`；移动端 `qa2-mobile-start.png`、`qa2-mobile-workspace.png`、`qa2-mobile-xsxl.png`。
- 文档/图片：`docs/preview.png`（README hero）、`docs/import-view.png`、`docs/teeth-view.png`；本目录其它交接文档 `docs/HANDOFF-3D-MPR-RENDERING.md`、`docs/HANDOFF-DICOM-DATA.md`、`docs/HANDOFF-QA.md`、`docs/HANDOFF-DEPLOY.md`。
- QA 报告与机器结果：`tools/QA-REPORT.md`、`tools/qa/results-qa2-desktop.json`、`tools/qa/results-qa2-mobile.json`、`tools/qa/qa2-summary.json`。
- 说明：`tools/screenshots/`、`tools/QA-REPORT.md`、`results-qa2-*.json` 与 `tools/qa/lib.mjs` 可能处于清理/再生成状态（以一次成功的 qa2 运行为准）；缺失时重跑 `node tools/qa/qa2.mjs` 重建，不要手写假结果。
- 视觉基线判断：`qa2-layout-quad.png`（四窗格、右下 3D 非黑）、`qa2-layout-3d.png`（全屏 3D）、`qa2-settings-xlarge.png` / `qa2-mobile-xsxl.png`（特大字号不破版）是 UI 回归最直接的证据。
