# 部署搭搭

搭搭的页面、应用、聊天和设置保存在使用者的浏览器。部署站点不需要业务数据库或账号系统；AI 接口、联网搜索及同步服务由使用者自行配置。

[返回 README](../../README.md) · [使用指南](usage.md) · [开发指南](development.md)

## Vercel 一键部署

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ftulai-design%2Fdada-home&project-name=dada-home)

1. 点击按钮，用 GitHub 账号登录 Vercel，将仓库复制到自己的账号。
2. 保留仓库中的 Vite、Node.js 24 和构建设置，创建项目并等待构建。
3. 打开生成的 HTTPS 地址。进入「设置 → 搭搭 AI」，按需填写自己的模型地址、模型和 API Key；也可以先使用本地小工具。
4. 需要自己的域名时，在 Vercel 项目的 Domains 中绑定。站点换域名后，浏览器会视为新的数据来源；迁移前先导出备份。

部署入口不要求提供模型密钥。API Key 在应用界面由使用者填写并保存在当前浏览器，不能把自己的密钥直接写入公开仓库或打进前端配置。

### 仓库预设

| 项目 | 配置 |
| --- | --- |
| Framework Preset | Vite |
| Node.js | `24.x`，由 `package.json` 的 engines 声明 |
| Install Command | `corepack pnpm install --frozen-lockfile` |
| Build Command | `corepack pnpm build` |
| Output Directory | `dist` |
| 默认取数代理 | `/__proxy?url={url}` → Node Function |
| 健康检查 | `/healthz` → Node Function |

完整配置在 [vercel.json](../../vercel.json)。构建同时生成主页、完整新标签页扩展 ZIP 和独立书签桥 ZIP，不依赖系统 `zip` 命令。普通页面路径回退到应用入口；不存在的 API、静态资源和下载文件返回 404，不以首页 HTML 冒充成功响应。

### Vercel 取数代理

RSS、热榜和公开服务监控可以沿用默认代理。`api/proxy.mjs` 复用与 Docker 相同的受控 Node 取数实现：仅公共 HTTP(S) 标准端口的 GET；逐次验证真实 DNS 与重定向目标；拒绝本机、私有网络和云元数据地址；不透传 Cookie；跨来源重定向移除显式 Authorization。错误为 JSON，响应不缓存，代理 HTML 不能作为站点页面执行。

在 Vercel 项目的 Environment Variables 中可设置：

| 变量 | 用途 | 必填 |
| --- | --- | --- |
| `PROXY_ALLOWED_HOSTS` | 逗号分隔的取数来源域名，含其子域名；如 `hnrss.org,www.ruanyifeng.com` | 否 |
| `VITE_UMAMI_WEBSITE_ID` | 可选 Umami 网站 ID；不设置时不加载统计 | 否 |
| `VITE_UMAMI_SRC` | 可选 Umami 脚本地址 | 否 |
| `VITE_UMAMI_DOMAINS` | 可选统计域名列表 | 否 |

更改环境变量后重新部署。限制允许域名可以减少公开代理的可访问范围；留空仍保留私网、端口、重定向和体积校验。

Vercel Function 不是长期运行的服务器。代理总超时为 15 秒，函数最大时长配置为 30 秒；响应正文上限为 **4 MiB**，为平台响应限制预留空间。过大内容、平台流量/执行额度、网络区域可达性仍可能导致取数失败。代理并发限制只作用于单个实例，不是跨所有云函数实例的全局限流。需要更大的读取预算或持续高流量时，可选择 Docker 或自己的代理。

**Vercel 一键部署只包含主页与取数函数，不部署独立的 SQLite 增量同步服务。** 跨设备使用时可连接已有 WebDAV/Gist/HTTP 或单独部署的同步服务。取数代理仅支持 GET，不能用于 WebDAV/HTTP 同步写入。

本仓提供构建配置与本地适配器回归；发布到你自己的 Vercel 项目后，仍需在平台检查构建日志、`/healthz` 和所用订阅来源。这不代表已经代你创建或部署线上项目。

## Docker

需要 Docker 和 Docker Compose。仓库默认使用 `ghcr.io/tulai-design/dada-home:latest`，映射本机 8080 端口：

```sh
docker compose up -d
```

自行构建：

```sh
docker build -t dada-home .
docker run -d --name dada-home -p 8080:80 dada-home
```

镜像内 Nginx 托管静态页面，Node 提供同源 `/__proxy`；`/healthz` 同时确认代理进程可用。任一进程退出都会结束容器，由部署平台重启。

Docker 取数单次正文预算为 5 MiB，其他目标校验与 Vercel 共用。需要限制来源时，为容器传入 `PROXY_ALLOWED_HOSTS`。Umami 的容器运行时配置为 `UMAMI_WEBSITE_ID`、`UMAMI_SRC`、`UMAMI_DOMAINS`；未填写网站 ID 时不加载统计脚本，用户也可在设置中关闭统计。

## Coolify 与可选同步服务

使用 [docker-compose.coolify.yml](../../docker-compose.coolify.yml)。其中包含：

- `web`：搭搭主页，内部端口 80；为它绑定域名并开启 HTTPS。
- `sync`：独立的自建增量同步服务，内部端口 8787；为它单独绑定域名，SQLite 数据保存在 `sync-data` 持久卷。只运行一个实例。

`sync` 需要 `TULAI_SYNC_ADMIN_TOKEN` 和允许的 `DADA_ORIGIN`。部署后打开同步服务管理页，用管理员令牌登录，为应用生成同步密钥，各设备在「设置 → 同步 → 自建同步服务」填写同一把。管理令牌只交给管理页，不填进前端构建变量。

不用增量同步时，可以移除 Compose 中的 `sync` 服务和对应卷声明；搭搭仍可完整本地使用。同步服务的数据备份、恢复及升级需按其自身文档操作，不把前端备份文件当作服务器数据库备份。

GitHub Actions 提供检查、构建、容器冒烟与 GHCR 多架构镜像发布工作流。使用现有镜像与自行构建是两种部署方式，修改源码后需构建自己的镜像或等待包含该修改的镜像发布。

## 纯静态托管

```sh
pnpm build
# 将 dist/ 上传到静态托管服务
```

应用本身不依赖业务后端。仅上传 `dist/` 不会包含 Node Function 或 Node 代理；`pnpm preview` 也不提供 `/__proxy`。部署静态站点时，为 RSS 等跨域取数配置可用的独立代理，或使用支持 CORS 的源站直连。不要让 `/__proxy` 落入 SPA 首页回退。

仓库提供独立的 [Cloudflare Worker](../../worker/proxy.ts)：

```sh
npx wrangler deploy worker/proxy.ts --name tada-proxy
```

部署后在「设置 → 网络 → 自定义 → 代理模板」填写：

```text
https://tada-proxy.<你的账号>.workers.dev/?url={url}
```

按需调整 Worker 的 `ALLOW_HOSTS` 限制来源。该代理与同步写入代理是不同用途；遇到错误先核对实际响应 Content-Type，RSS 返回 HTML 通常意味着路由落入了首页或代理地址错误。

## PWA 与浏览器扩展

HTTPS 生产站点支持浏览器安装到桌面/主屏幕。应用缓存入口、必要脚本与使用过的资源，AI、RSS、搜索、监控和同步仍需网络；PWA 不等于离线模型。新版本就绪后会提示刷新。

Web 部署构建会包含 `dada-extension.zip`，在「设置 → 浏览器扩展」可下载。解压后在 Chrome/Edge 的扩展管理页开启开发者模式，加载含 manifest.json 的目录。网页与扩展的数据分别保存，先导出再导入可转移数据；扩展支持一个完整运行实例，其他标签页可回到运行页，详见[扩展契约](../specs/browser-extension.md)。

## 部署后检查

- 首页和设置可打开，`/healthz` 返回 `ok`。
- `/__proxy` 不带 URL 应返回 JSON 400，而不是 HTML 首页；所需订阅可正常取回。
- 「设置 → 浏览器扩展」下载的是 ZIP 文件，可正常解压。
- 新域名下配置模型与服务；需要迁移原站点数据时，使用显式备份/同步。
- 自定义域名已启用 HTTPS，PWA 更新与站点缓存正常。

Vercel 参考：[部署按钮](https://vercel.com/docs/deploy-button/source)、[Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js)、[项目配置](https://vercel.com/docs/project-configuration/vercel-json)、[函数限制](https://vercel.com/docs/functions/limitations)。配置核对日期：2026-10-30。
