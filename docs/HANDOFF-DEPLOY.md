# HANDOFF — Cloudflare 部署（cbct.cyrusdoyle.me）

> 交接对象：下一位 AI Agent。
> 目标：把 Vite 静态 SPA（WebGL2 CBCT 阅片器）部署到 **Cloudflare Workers + Workers Static Assets**，
> 通过自定义域 **https://cbct.cyrusdoyle.me** 访问。完整操作手册见 `tools/deploy-cloudflare.md`；
> 本文件只记录**当前状态、已验证事实、已踩坑、下一步**，避免重复调查。
> 最后核查时间：**2026-10-31 18:40（Asia/Shanghai）**。

## 1. 当前状态

- ✅ `wrangler.jsonc` 已配置好：Workers Static Assets + 自定义域 `cbct.cyrusdoyle.me`（详见第 2 节）。
- ✅ 构建与配置验证通过：`pnpm build` 成功；`pnpm deploy:dry`（= build + `wrangler deploy --dry-run`）**exit 0**。
- ❌ **尚未真正部署**：本机没有有效 Cloudflare 凭据（OAuth 过期 + 无 API token），`wrangler deploy` 无法执行。
- ❌ 线上域名当前不可用：`cbct.cyrusdoyle.me` 权威 DNS 查询为 **NXDOMAIN**（交接时无任何记录）。
- 结论：**剩下唯一的硬阻塞是"人类凭据"**。配置、资产、DNS 前置条件都已就绪；登录后一条命令即可上线。
- 未验证项：zone `cyrusdoyle.me` 是否在目标账号、自定义域 SSL 签发、线上页面渲染——都需要登录后确认。

## 2. 关键文件与命令

### 关键文件

- `wrangler.jsonc`（仓库根目录，可直接使用）：
  - `name: "cbct"`，`compatibility_date: "2026-10-31"`，`$schema` 指向 `./node_modules/wrangler/config-schema.json`。
  - `assets.directory: "./dist"`，`not_found_handling: "single-page-application"`，`html_handling: "auto-trailing-slash"`。
  - `routes: [{ "pattern": "cbct.cyrusdoyle.me", "custom_domain": true }]`。
  - **没有 `main`**：纯静态 assets-only Worker，无边缘函数代码。
  - 注意：`routes` 存在时 `workers_dev` 默认 `false`（只发自定义域），见坑 4.3。
- `tools/deploy-cloudflare.md`：完整部署手册（认证、自定义域、Dashboard 兜底、回滚、排障）。
- `package.json` scripts（**勿改**，下一位 Agent 只读）：`build`、`prepare-volume`、`cf:login`、`deploy:dry`、`deploy`。
- `docs/preview.png`：浏览器端预览截图，部署后做视觉对照用。

### 关键命令

```powershell
cd D:\Codes\demos\CBCT
pnpm install
pnpm prepare-volume        # 仅当 public/data 缺少 volume_u8.bin / volume.json / thumbnail.png 时
pnpm build                 # tsc -b && vite build → dist/
pnpm deploy:dry            # = pnpm build && wrangler deploy --dry-run（已实测 exit 0）
pnpm exec wrangler whoami  # 认证检查：需要先登录（见第 5 节）
pnpm run deploy            # = pnpm build && wrangler deploy（真正部署）
```

- ⚠️ **不要用裸 `pnpm deploy`**：pnpm 会把它解析为内建命令 `deploy`（"Deploy a package from a workspace"），
  **不会**执行 package.json 里的同名 script。必须 `pnpm run deploy`，或 `pnpm exec wrangler deploy`；
  `pnpm deploy:dry` 不是 pnpm 内建命令，可直接用（已实测）。
- 等价底层命令：`pnpm exec wrangler deploy --dry-run` / `pnpm exec wrangler deploy`。
- 登录命令：`pnpm exec wrangler login`（别名脚本 `pnpm cf:login`）。

## 3. 已知事实与证据（2026-10-31 实测）

- **dist 体积**：8 个文件，合计 **21,855,378 B ≈ 20.84 MiB ≈ 21.8–21.9 MB**（随构建 hash 略有浮动）。
- **最大文件**：`dist/data/volume_u8.bin` = **20,480,000 B（19.53 MiB）**，小于 Cloudflare 单文件上限
  **25 MiB = 26,214,400 B**；无任何文件超限。
- **dist 内容**：`index.html`、`favicon.png`、`assets/index-*.js`（约 1.27 MB）、`assets/index-*.css`、
  `data/volume_u8.bin`、`data/volume.json`、`data/dental.json`、`data/thumbnail.png`。
- **dry-run 证据**：输出 `✨ Read 10 files from the assets directory D:\Codes\demos\CBCT\dist` 与
  `--dry-run: exiting now.`，exit code 0（"10 个条目" = 8 个文件 + `assets/`、`data/` 两个目录）。
- **DNS 现状**：
  - `cyrusdoyle.me` 的 NS = `micah.ns.cloudflare.com` / `sandra.ns.cloudflare.com` → 域名已托管在 Cloudflare。
  - `www.cyrusdoyle.me` CNAME 到 `*.vercel-dns-017.com`，apex 解析到 Vercel anycast IP → **与 cbct 子域不冲突**。
  - `cbct.cyrusdoyle.me`：权威 NS 查询返回 NXDOMAIN（交接时无记录，可直接挂自定义域）。
- **凭据现状**：无 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`；wrangler 本地 OAuth token 已于
  `2026-09-19` 过期（refresh 返回 `400 invalid_grant`）；`cf auth whoami` 返回 `{"authenticated": false}`。
- **网络现状**：`api.cloudflare.com` IPv4 可达；`dash.cloudflare.com` 默认路径（IPv6 优先）超时/极慢，
  强制 IPv4 可通（坑 4.2 有 workaround 与实测证据）。
- **zone 账号归属**：未登录无法确认；部署前必须验证 `cyrusdoyle.me` 在目标账号且 Active。

## 4. 已踩坑清单（症状 / 根因 / 修复 / 验证）

### 4.1 40.96 MB 的 volume_i16.bin 超出 Cloudflare 25 MiB 单文件上限

- **症状/根因**：旧 `dist/data/volume_i16.bin`（40,960,000 B）超过 Cloudflare 单文件 25 MiB 上限，
  而早期 `prepare-volume` 会为 MPR 生成 i16 体积。
- **修复（已落地）**：i16 不再生成/不再随构建输出，MPR 改用 u8 体积（`prepare-volume` 只写
  `volume_u8.bin` + `volume.json` + `thumbnail.png`）；干净 `pnpm build` 会清空 `dist`，i16 消失。
- **验证**：`Get-ChildItem dist -Recurse -File | Where-Object Length -gt 26214400` 输出为空。

### 4.2 wrangler OAuth 过期，且 device flow 拿不到 code

- **症状**：`pnpm exec wrangler whoami` 报 token 过期/无法刷新；`wrangler login --device` 卡在
  "Attempting to login via OAuth Device Authorization Grant..."，长时间不打印 code。
- **根因（两层）**：
  1. 本机 wrangler OAuth refresh token 已失效——手工向 `https://dash.cloudflare.com/oauth2/token`
     发 refresh 请求返回 `400 {"error":"invalid_grant"}`（**是认证问题，不是密码错误**）。
  2. 本机到 `dash.cloudflare.com` 的**默认（IPv6 优先）路径不可用/极慢**，device flow 请求
     `https://dash.cloudflare.com/oauth2/device/auth` 连接超时，拿不到 user code。实测 Node fetch 报
     `UND_ERR_CONNECT_TIMEOUT`（约 10s），而 `curl --ipv4` 同一端点返回 200。
- **修复 / workaround**：需要**人类**登录（Agent 无法代替）：`pnpm exec wrangler login`，或设置 API Token
  （见第 5 节）；凭据过期只能重新授权，不能"刷新"。若必须用 device flow，先强制 IPv4 再执行——
  `$env:NODE_OPTIONS='--dns-result-order=ipv4first --no-network-family-autoselection'` 后
  `pnpm exec wrangler login --device`（实测可打印 code，但仍需真人浏览器批准）。
- **补充**：CI/无 TTY 直接 deploy 会报 "In a non-interactive environment, it's necessary to set a
  CLOUDFLARE_API_TOKEN environment variable..." → 必须用 API Token 认证。
- **验证**：`pnpm exec wrangler whoami` 能输出账号（Account Name / ID）与 token 权限即成功。

### 4.3 `routes` 存在时 workers_dev 默认 false

- **症状**：部署后没有 `https://cbct.<account>.workers.dev` 地址，只有自定义域。
- **根因**：wrangler 默认逻辑 `workers_dev = (routes.length === 0)`；配置了 `routes` 就默认关闭 workers.dev。
- **修复**：想先拿 workers.dev 地址验证，在 `wrangler.jsonc` 顶层显式加 `"workers_dev": true`；
  只想发 workers.dev 则注释掉 `routes` 块。当前配置是"只发自定义域"。
- **验证**：deploy 输出会列出实际发布的 URL；或直接 curl 对应地址。

### 4.4 自定义域挂载前提与失败兜底

- **前提**：`cyrusdoyle.me` zone 必须在**同一个 Cloudflare 账号**且 Active；`cbct.cyrusdoyle.me`
  **不能已有冲突 DNS 记录**（交接时 NXDOMAIN，无冲突）。
- **修复/兜底**：若 `wrangler deploy` 挂自定义域失败（zone 不在当前账号、记录冲突、token 缺 Zone 权限）：
  临时注释 `routes`（或加 `"workers_dev": true`）把 Worker 发上去；再在 Dashboard → Workers & Pages →
  `cbct` → Settings → Domains & Routes → Add → Custom domain，输入 `cbct.cyrusdoyle.me`，等 SSL Active
  （约 1–2 分钟）。**不要**手动建 A/CNAME 指到 `*.workers.dev`（必须用 Workers Custom Domain 机制）。
- **验证**：`curl.exe -I https://cbct.cyrusdoyle.me/` 返回 200 且证书有效。

### 4.5 生产 base 路径 `/`，SPA 回退只对非资产路径生效

- `vite.config.ts` 未设置 `base`（默认 `/`）；`index.html` 引用 `/assets/...`，数据在 `/data/...`。
- `not_found_handling: "single-page-application"` 只对**找不到的普通路径**返回 `index.html`；
  `/data/volume_u8.bin` 等真实资产若缺失不会被 SPA 回退掩盖，会 404。
- **验证**：`curl.exe -I https://cbct.cyrusdoyle.me/data/volume_u8.bin` 应为 200、content-length ≈ 20480000；
  任意前端路由（如 `/viewer`）应返回 `index.html` 而不是 404。

### 4.6 生成物不入库，新机器必须先准备数据

- `dist/` 与 `public/data/*.bin` 都在 `.gitignore` 中；`dist/data` 二进制由 `pnpm prepare-volume` 生成。
- 新机器/CI 部署顺序必须是：`pnpm install` →（缺数据时 `pnpm prepare-volume`）→ `pnpm build` → deploy。
- **验证**：`dist/data/volume_u8.bin`、`volume.json`、`thumbnail.png` 存在且体积正常。

## 5. 未完成事项与建议下一步

- **需要人类/用户执行**（Agent 无法代替）：
  - `pnpm exec wrangler login`（或 `pnpm cf:login`）完成浏览器 OAuth；或创建 API Token：
    Dashboard → My Profile → API Tokens → Create Token → 模板 **"Edit Cloudflare Workers"**，
    权限至少 Account/Workers Scripts: Edit、Zone/Workers Routes: Edit、Zone/Zone: Read，
    自定义域报权限错误时再补 Zone/DNS: Edit。然后（**不要提交 token**）：
    ```powershell
    $env:CLOUDFLARE_API_TOKEN='<token>'
    $env:CLOUDFLARE_ACCOUNT_ID='<account-id>'   # 可选
    pnpm exec wrangler whoami
    ```
  - 确认 `cyrusdoyle.me` zone 在同一账号且 Active。
- **Agent 在凭据可用后的顺序**：
  1. `pnpm exec wrangler whoami`（确认账号/权限）
  2. `pnpm build`
  3. `pnpm deploy:dry`（可选：确认 0 超限、10 条目、exit 0）
  4. `pnpm run deploy`（或 `pnpm exec wrangler deploy`）
- **部署后验证清单**：
  ```powershell
  curl.exe -I https://cbct.cyrusdoyle.me/
  curl.exe -I https://cbct.cyrusdoyle.me/data/volume_u8.bin
  curl.exe -I https://cbct.cyrusdoyle.me/data/volume.json
  curl.exe -I https://cbct.cyrusdoyle.me/viewer        # 期望 index.html（SPA 回退）
  pnpm exec wrangler deployments list
  ```
  再打开浏览器确认体积加载、MPR/3D 视图正常（对照 `docs/preview.png`）。
- **回滚**：`pnpm exec wrangler versions list` 看版本；`pnpm exec wrangler rollback [version-id]`；
  或 Dashboard → `cbct` → Deployments → Rollback。彻底删除：`pnpm exec wrangler delete cbct`。
- **自定义域失败时**：按 4.4 的 Dashboard 手动挂载兜底，不要改其他代码。
- **完成后**：更新本文件第 1 节状态（改为"已部署 + 验证结果"），并同步 `tools/deploy-cloudflare.md` 的实测段。

## 6. 安全与隐私

- DICOM 原始序列**只在本机浏览器处理**，无后端、无上传；部署只上传构建产物（`dist/`）。
- ⚠️ `dist/data/volume.json` 含**患者可识别信息**：`patient.id / name / latinName / sex / age / birthDate`
  当前均非空（由 `scripts/prepare-volume.mjs` 从 DICOM 提取）。**公开部署演示前必须先脱敏**
  （清空/替换 patient 字段或用脱敏数据重新生成），否则存在隐私泄露风险；示例患者数据不要公开演示。
- 凭据安全：不要提交 `CLOUDFLARE_API_TOKEN`/OAuth token，不要写进仓库、日志、聊天记录或本文件。

## 7. 相关产物

- `wrangler.jsonc` — Cloudflare Workers Static Assets + 自定义域配置（可直接用）。
- `tools/deploy-cloudflare.md` — 完整部署手册（含认证、Dashboard 兜底、回滚、排障）。
- `docs/preview.png` — 浏览器端预览截图（部署后视觉对照）。
- 数据资产：`dist/data/volume_u8.bin`、`dist/data/volume.json`、`dist/data/dental.json`、`dist/data/thumbnail.png`。
