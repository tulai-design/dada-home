# 第一页

一个只给一个人看的起始页。纯前端，数据全在浏览器里；订阅、书签、待办、便签、天气、热榜、服务监控和 AI 助手都在同一屏。

界面参考 [anyway.fm](https://anyway.fm/) 的编辑部式排布：左侧图标轨、中间内容流、右侧彩色标签块。浅色与深色两套。

## 开发

```bash
pnpm install
pnpm dev      # http://localhost:5173
pnpm build    # 类型检查 + 产出 dist/
```

`pnpm dev` 会带一个开发用的转发中间件 `/__proxy?url=…`，用来绕过浏览器跨域。**生产环境没有这个中间件**，部署后请按下文配置自己的转发。

## 数据存在哪

全部在 `localStorage`（键前缀 `fp.`）：书签、订阅源、待办、便签、已读记录、AI 密钥、监控配置。没有后端，也不会上传。设置里有「导出备份」，导出的是这些键的原始 JSON。

AI 密钥存在浏览器里意味着：任何能在这个页面执行脚本的东西都能读到它。公用电脑上别填。

## 部署后必须做的一件事：取数代理

浏览器直接 GET 一个 RSS 地址会被跨域策略挡住。项目提供了一份可部署的转发脚本：`worker/proxy.ts`（Cloudflare Worker）。

```bash
npx wrangler deploy worker/proxy.ts --name first-page-proxy
```

部署后得到 `https://first-page-proxy.<账号>.workers.dev`，在「设置 → 订阅与取数 → 取数代理」里填：

```
https://first-page-proxy.<账号>.workers.dev/?url={url}
```

`{url}` 会被替换成经过 URL 编码的目标地址。脚本默认丢掉浏览器 cookie、只透传 `authorization`，建议在 `ALLOW_HOSTS` 里写死允许访问的域名，避免变成任人使用的开放代理。

## 接入服务监控

点左侧「监控」打开数据面板，右上角「管理」里添加。支持两类：

### Beszel

填服务地址、账号（邮箱）、密码。面板直接读 PocketBase 的公开接口：

- `POST /api/collections/users/auth-with-password` 换 token
- `GET /api/collections/systems/records` 主机列表与瞬时指标
- `GET /api/collections/system_stats/records` 按时间窗取历史点（`type` 为 `1m` / `10m` / `20m` / `120m`）

所以能看到 **CPU、内存、磁盘、流量、负载** 四个可切换的折线图，以及每台机器的服务数、运行时长、电池。时间范围支持 1 小时 / 12 小时 / 24 小时 / 一周。

Beszel 默认会拦跨域，记得把面板地址也走上面的转发，或者在 Beszel 前面加一层允许跨域的代理。浏览器端无法加密存储密码，建议给面板建一个只读账号。

### Coolify

填实例地址与 API Token（Coolify 里「Keys & Tokens → API tokens」新建，勾选 `read`）。读的是公开 API：

- `GET /api/v1/servers` 服务器与在线状态
- `GET /api/v1/applications` 应用清单与运行状态
- `GET /api/v1/deployments` 最近部署记录

Coolify 的开放 API **不提供 CPU / 内存时间序列**（那些数据在它内部的 sentinel 实时通道里），所以这里展示的是服务器在线情况、应用运行状态和部署历史。要曲线就用 Beszel 接同一批机器。

### 网址探测

只填一个 URL，显示响应时间与状态码，并在本次会话里积累一张响应时间曲线。

## AI 助手

「设置 → AI · BYOK」填任意 OpenAI 兼容服务：

- 接口地址：`https://api.openai.com/v1`、`https://openrouter.ai/api/v1`、本地 `http://localhost:11434/v1` 都可以
- 模型名原样填
- 消息以流式 `chat/completions` 发送，回复按 Markdown 渲染（标题、列表、代码块、表格、引用）

首页卡片和抽屉共用同一段对话；阅读器里的「AI 摘要」用同一份配置。

## 快捷键

| 键 | 作用 |
| --- | --- |
| `⌘K` / `Ctrl K` | 命令面板：找书签、切主题、搜网页 |
| `⌘J` / `Ctrl J` | 打开助手 |
| `⌘,` | 设置 |
| `/` | 聚焦搜索框 |
| `Esc` | 关闭最上层抽屉 |

## 目录

```
src/
  App.tsx              页面组装、数据流、快捷键
  styles.css           全部样式（anyway.fm 色板、浅/深两套变量）
  lib/
    rss.ts             RSS/Atom 解析、HTML 清洗、CORS 转发
    monitor.ts         Beszel / Coolify / HTTP 探测
    ai.ts              OpenAI 兼容的流式请求
    markdown.ts        marked + 清洗
    store.ts           localStorage + 订阅
    defaults.ts        默认书签、订阅、设置
  components/
    Rail.tsx  TopBar.tsx  Cards.tsx  Monitor.tsx
    Reader.tsx  Assistant.tsx  CommandPalette.tsx  Settings.tsx
worker/proxy.ts       生产用的转发脚本
```
