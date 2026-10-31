# Cloudflare 部署指南（CBCT Volume Viewer）

目标：把 Vite 构建出的纯静态 SPA 部署到 **Cloudflare Workers + Workers Static Assets**，
并通过自定义域 **https://cbct.cyrusdoyle.me** 访问。

- 配置文件：[`wrangler.jsonc`](../wrangler.jsonc)（仓库根目录）
- Worker 名称：`cbct`
- 静态资源目录：`./dist`
- SPA 回退：`not_found_handling: "single-page-application"`（未知路径返回 `index.html`）
- 构建产物：`pnpm build` → `dist/`

> 为什么用 Workers Static Assets 而不是 Pages：新项目的静态托管推荐 Workers
> Static Assets，配置即代码、自定义域和回滚都在同一套 `wrangler` 命令里完成；
> 本项目没有 SSR/边缘函数需求，纯静态资源即可。

---

## 1. 先决条件

1. Cloudflare 账号已登录本机（见第 4 节认证）。
2. **`cyrusdoyle.me` 这个 zone 必须在该 Cloudflare 账号下且状态为 Active。**
   - 当前 NS 是 `micah.ns.cloudflare.com` / `sandra.ns.cloudflare.com`（2026-10-31 实测），
     说明域名已托管在 Cloudflare；只要它出现在你要部署的账号的 “Websites” 列表里即可。
   - 如果 zone 在**另一个账号**，`wrangler deploy` 挂自定义域会失败；需要先把 zone
     move 到目标账号，或改用一个属于当前账号的域名。**未登录前无法确认账号归属**。
3. `cbct.cyrusdoyle.me` **没有冲突 DNS 记录**：2026-10-31 用权威 NS
   `micah.ns.cloudflare.com` 查询返回 NXDOMAIN（未解析），可以直接挂自定义域。
   有冲突记录时先删除，否则自定义域会报 “record already exists” 之类错误。
   Wrangler 会自动创建/管理一条代理记录，**不要**手动建 A/CNAME 指到 `*.workers.dev`。
   参考：当前 `www.cyrusdoyle.me` 走 Vercel（CNAME `*.vercel-dns-017.com`），
   apex 也解析到 Vercel 的 anycast IP，与 `cbct` 子域互不冲突。
4. 本机工具链：Node.js ≥ 22（当前 Node 24 可用）、`pnpm`；`wrangler` 已在 devDependencies
   （4.156.0），命令统一写 `pnpm exec wrangler`。

---

## 2. 构建

```powershell
cd D:\Codes\demos\CBCT
pnpm install
pnpm prepare-volume   # 仅当 public/data 下缺少 volume_u8.bin / volume.json / thumbnail.png 时
pnpm build            # tsc -b && vite build → dist/
```

说明：

- `dist/data/*.bin` 是**生成物**，由 `pnpm prepare-volume` 从本地 DICOM 序列生成，**不在 git 中**
  （`.gitignore` 忽略 `public/data/*.bin` 与 `dist`）。CI/新机器部署必须先补这一步，否则页面
  会 404 缺数据。
- 当前 `scripts/prepare-volume.mjs` 只生成 `volume_u8.bin`（约 20.48 MB）、`volume.json`、
  `thumbnail.png`，**不再生成 `volume_i16.bin`**。旧构建目录里可能残留 `dist/data/volume_i16.bin`
  （40.96 MB，超过 Cloudflare 单文件 25 MiB 上限）——重新 `pnpm build` 会清空 `dist` 即可；
  构建后务必按第 3 节检查一遍。
- 不要手工改 `dist/`；所有变更走 `src/` + 重新构建。

---

## 3. 部署前检查：单文件 25 MiB 上限

Workers Static Assets 限制：**每个资源文件 ≤ 25 MiB（26,214,400 字节）**；免费计划 ≤ 20,000
个文件，付费计划 ≤ 100,000 个文件（需 wrangler ≥ 4.34，本项目 4.156 满足）。

```powershell
# 按大小列出 dist 中所有文件
Get-ChildItem dist -Recurse -File |
  Sort-Object Length -Descending |
  Select-Object @{n='MiB';e={[math]::Round($_.Length/1MB,2)}}, FullName |
  Format-Table -AutoSize

# 只列出超限文件；输出为空才可部署
Get-ChildItem dist -Recurse -File |
  Where-Object Length -gt 26214400 |
  Select-Object FullName, Length
```

预期（当前代码）：`volume_u8.bin` 19.53 MiB、`volume_i16.bin` **不应存在**、其余文件都很小。

**2026-10-31 实测**（`pnpm build` 后）：`dist` 共 7 个文件、合计 20.75 MiB；最大文件
`data/volume_u8.bin` = 20,480,000 字节（19.53 MiB），**无文件超过 25 MiB**；
旧 `dist/data/volume_i16.bin` 已被干净构建清除。文件数也远低于 20,000 上限。

Wrangler 也会在打包阶段自行校验；超限会直接报错（类似
`The asset ... is larger than the 25MiB limit`）。可用 dry-run 提前发现：

```powershell
pnpm exec wrangler deploy --dry-run
```

dry-run 不需要上传，只做配置解析 + 资产清单 + 大小汇总，**无需认证**即可完成；
但自定义域是否可挂载要等真正 deploy 时由服务端校验（dry-run 不校验）。

**2026-10-31 实测**：`pnpm exec wrangler deploy --dry-run` 退出码 0；wrangler 正确识别
`wrangler.jsonc`（JSONC），从 `dist` 读到 9 个条目（7 个文件 + `assets/`、`data/` 两个目录），
输出 `--dry-run: exiting now.`。

---

## 4. 认证

### 方式 A：交互式 OAuth 登录（推荐本机使用）

```powershell
pnpm exec wrangler login
```

会打开浏览器完成 Cloudflare OAuth 授权，凭据保存在本机
`%APPDATA%\xdg.config\.wrangler\config\default.toml`（不要提交/外发该文件）。
无法回调 `localhost:8976` 的环境（容器、远程 SSH、网络受限）可用设备码流程：

```powershell
pnpm exec wrangler login --device
```

登录状态检查：

```powershell
pnpm exec wrangler whoami
```

正常会输出账号（Account Name / ID）和 token 权限范围。

### 方式 B：API Token（CI / 无浏览器环境）

在 Cloudflare Dashboard → My Profile → API Tokens → Create Token，使用
**“Edit Cloudflare Workers”** 模板（或等价权限）：

- Account → Workers Scripts → Edit
- Account → Account Settings → Read（可选，用于解析账号）
- Zone → Workers Routes → Edit
- Zone → Zone → Read
- 若自定义域挂载报权限错误，再追加 Zone → DNS → Edit（自定义域记录的创建）

然后按作用域设置环境变量（**不要**把 token 写进仓库）：

```powershell
$env:CLOUDFLARE_API_TOKEN = "<token>"
$env:CLOUDFLARE_ACCOUNT_ID = "<account-id>"   # 可选，token 只属于一个账号时可省略
pnpm exec wrangler whoami                     # 验证
```

> 安全提示：token/凭据不要提交到 git，也不要贴进聊天/日志。CI 里放到 secret 中。
> `.env` 文件会被 wrangler 自动读取（`wrangler` 也支持 `CLOUDFLARE_API_TOKEN` 环境变量）。

### 本机当前认证状态（2026-10-31 实测）

**结论：本机当前没有有效 Cloudflare 凭据，无法自动完成部署；网络本身正常。**

- 本机**没有**可用的 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` 环境变量（用户级、机器级均未设置）。
- `wrangler` 本地 OAuth 凭据存在（`%APPDATA%\xdg.config\.wrangler\config\default.toml`），
  但已于 `2026-09-19` 过期；用其中的 refresh token 请求
  `POST https://dash.cloudflare.com/oauth2/token` 返回
  `400 {"error":"invalid_grant", ...}`（refresh token 已失效/被撤销）
  → **必须重新 `wrangler login`**。
- 这是**认证问题，不是网络问题**：`api.cloudflare.com`（IPv4）可访问，token 端点能正常返回
  JSON 错误体；`wrangler whoami` 的 “auth server could not be reached” 提示具有误导性，
  `WRANGLER_LOG=debug` 显示真实原因是 400。注意本机 IPv6 出网不可用（IPv6 直连 Cloudflare 失败），
  若登录页/请求卡住可确认是否走了 IPv6。
- 新版 `cf` CLI（devDependency `cf@1.0.0-beta.26`）：`pnpm exec cf auth whoami` 返回
  `{"authenticated": false, "error": "Not logged in"}`；`cf whoami` 不是命令，正确子是 `cf auth whoami`。
- 非交互环境执行 `pnpm exec wrangler deploy` 会直接报错：
  `In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN environment variable for wrangler to work.`
- 补上凭据后按第 5 节命令即可部署；部署后按第 6 节验证 `https://cbct.cyrusdoyle.me`。

---

## 5. 部署

```powershell
cd D:\Codes\demos\CBCT
pnpm build
pnpm exec wrangler deploy --dry-run   # 可选：先验证配置/资产
pnpm exec wrangler deploy             # 真正部署
```

成功后会部署到自定义域：

- `https://cbct.cyrusdoyle.me`（Wrangler 自动创建 DNS 记录并等待 SSL 生效）

> 注意：`wrangler.jsonc` 里配置了 `routes`，此时 Wrangler 的 **`workers_dev` 默认为 `false`**，
> 即只发布到自定义域、**不会**生成 `*.workers.dev` 地址。
> - 想同时保留 `https://cbct.<account-subdomain>.workers.dev` 方便上线前验证：在
>   `wrangler.jsonc` 顶层加 `"workers_dev": true`。
> - 暂时不挂自定义域、只发 `workers.dev`：注释掉 `routes` 块再 deploy。
> - 首次上线若担心域名挂载失败，可先用 `"workers_dev": true` 跑通，再启用 `routes`。

### 如果 Wrangler 挂自定义域失败

常见原因：zone 不在当前账号、`cbct` 已有冲突 DNS 记录、token 缺 Zone 权限。
可在 Dashboard 手动挂载：

1. Workers & Pages → `cbct` → Settings → Domains & Routes → **Add** → **Custom domain**
2. 输入 `cbct.cyrusdoyle.me` → Add domain
3. 等待证书状态变成 Active（通常 1–2 分钟；DNS 记录由 Cloudflare 自动创建）

---

## 6. 部署后验证

```powershell
# 首页（应为 200，返回 SPA index.html）
curl.exe -I https://cbct.cyrusdoyle.me/

# 体积资源（200，content-length 约 20480000 字节；可配合 Range 测分块）
curl.exe -I https://cbct.cyrusdoyle.me/data/volume_u8.bin
curl.exe -I https://cbct.cyrusdoyle.me/data/volume.json

# SPA 回退：任意前端路由应返回 index.html 而不是 404
curl.exe -I https://cbct.cyrusdoyle.me/viewer

# 部署记录 / 版本
pnpm exec wrangler deployments list
pnpm exec wrangler versions list
```

浏览器验证：打开 https://cbct.cyrusdoyle.me ，确认体积数据加载、MPR/3D 视图正常；
若刚更新过同名 `data/*.bin`，先强刷（Ctrl+F5）或清 Cloudflare 缓存。

---

## 7. 回滚

```powershell
# 查看历史部署/版本
pnpm exec wrangler deployments list
pnpm exec wrangler versions list

# 回滚到上一个版本
pnpm exec wrangler rollback

# 或指定 version id
pnpm exec wrangler rollback <version-id>
```

也可以在 Dashboard：Workers & Pages → `cbct` → Deployments → 选择历史版本 → Rollback。
回滚只切换 Worker 版本，不影响自定义域绑定。

彻底删除（含自定义域绑定）：

```powershell
pnpm exec wrangler delete cbct
```

---

## 8. 常见问题

| 现象 | 处理 |
| --- | --- |
| `Not logged in. Your auth token has expired ...` / `invalid_grant` | 重新 `pnpm exec wrangler login`，或设置 `CLOUDFLARE_API_TOKEN`；这不是网络问题 |
| token 端点不可达 / 超时（`ErrorAuthServerUnreachable`） | 检查代理/IPv6；`wrangler login --device`；`WRANGLER_LOG=debug` 看底层错误 |
| `The directory specified by the "assets.directory" field ... does not exist` | 先 `pnpm build`，确认 `dist/` 存在 |
| 单个 asset 超 25 MiB | 移除/拆小该文件（如体积数据改用 R2/分块），重新构建后再部署 |
| 自定义域 522/1016/证书 pending | 等 1–2 分钟；确认 zone Active、DNS 无冲突记录；看 SSL/TLS → Edge Certificates |
| 页面白屏但首页 200 | `vite.config.ts` 的 `base` 需为默认 `/`；检查 `dist/index.html` 的 `/assets/...` 路径 |
| 数据 404 | `dist/data` 是否随构建生成（`pnpm prepare-volume`）；确认 worker 里资源路径是 `/data/...` |
| 旧内容未更新 | 强刷 / 清缓存；文件名带 hash 的资源不受影响，`index.html` 与 `data/*.bin` 可能被缓存 |

调试：`$env:WRANGLER_LOG='debug'` 后再执行命令；日志在
`%APPDATA%\xdg.config\.wrangler\logs\`。
