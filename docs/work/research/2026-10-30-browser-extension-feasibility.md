# 搭搭浏览器扩展可行性调研

日期：2026-10-30。状态：调研建议，尚未实施或接受为发布方案。

## 结论

**可以做，且本地新标签页是与搭搭当前定位最吻合的第一种形态。** 现有 React 页面、工作空间模型、主题、内置组件、AI 搭建工具和 IndexedDB 存储都有明确复用价值，无需重写一个产品。但当前网页构建不能直接作为完整的 Manifest V3 商店版扩展交付。

主要适配点不是主页 UI，而是扩展执行环境：AI 生成代码与第三方库的沙盒边界、多个标签页的数据一致性、网络授权、PWA 与扩展的构建分离。能加载已解压的原型与能通过商店审核是两个验收层次；本报告没有实际加载完整扩展或提交商店。

建议保留网站/PWA，增加共享核心的 Chrome/Edge 扩展构建，优先验证新标签页。侧边栏作为后续独立体验；不要把目前的桌面界面整体缩进侧边栏。完整生成应用是否随首版发布，应由专项原型和政策核查结果决定，不能在调研阶段默认为已解决或直接砍掉。

## 1. 仓库已有基础

| 范围 | 当前源码事实 | 对扩展的含义 |
| --- | --- | --- |
| 配套扩展 | [manifest](../../../extension/manifest.json) 为 MV3，含 service worker、popup、书签与按站申请的主机权限 | 已有扩展基础，但没有新标签页覆盖、完整主页或侧边栏入口 |
| 书签操作 | [handlers](../../../extension/handlers.js)、[后台](../../../extension/background.js)、[网页桥](../../../src/lib/browserBookmarks.ts) | 可复用书签业务；当前网页 postMessage/content-script 桥接不等于扩展页原生接入 |
| Web 构建 | [Vite](../../../vite.config.ts)、[入口](../../../src/main.tsx)、[HTML](../../../index.html) | 静态 React 前端适合打包；PWA、运行时 config 与路径需分目标处理 |
| UI 与领域 | [工作空间](../../../src/lib/workspace.ts)、[纯操作](../../../src/lib/ops.ts)、[主题](../../../src/lib/themes.ts)、[组件注册](../../../src/lib/registry.ts) | 页面编辑、主题、常规组件可共用；主题不应分别维护 Web/扩展版本 |
| AI 调用 | [ai](../../../src/lib/ai.ts) 在浏览器通过 provider 发流式请求；工具执行调用宿主 | AI 聊天/搭建本身可复用，不要求把整个 Agent 移到后台 |
| AI 应用 | [App](../../../src/widgets/app.tsx) 与 [Applet runner](../../../src/lib/applet/runner.ts) 动态生成 `srcdoc`，含内联 JS，并允许 CDN ES module | 是 CSP/政策的重点验证对象；Applet 虽然渲染 JSON 积木，逻辑仍是任意 JS，不能称其天然为纯声明式配置 |
| 本地数据 | [工作空间仓](../../../src/lib/workspaceStore.ts)、[设置仓](../../../src/lib/store.ts) 用 localStorage；[数据库](../../../src/lib/db.ts) 和 [组件数据](../../../src/lib/componentData.ts) 用 IDB/内存缓存 | 扩展页面可以继续使用 Web 存储，不必全迁移到 chrome.storage；跨实例一致性需要补齐 |
| 备份与同步 | [备份](../../../src/lib/storage.ts)、[快照同步](../../../src/lib/sync.ts)、[同步服务](../../../src/lib/syncService.ts) | 支持用户主动导入/同步到新环境；网页和扩展不会自动共享同一数据源 |

## 2. 产品形态选择

| 形态 | 用户体验 | 适配成本与边界 | 建议 |
| --- | --- | --- | --- |
| 网站入口/配套桥 | 点击扩展打开网站，继续授权书签桥；数据仍在站点 | 改动最少，依赖站点可达；不等于本地新标签页产品 | 可作试水或继续保留，不是完整扩展目标 |
| 本地新标签页 | 打开新标签页即进入搭搭，主页、主题、书签、工具在本地包内 | 中等规模的平台适配；动态代码、多个页面实例、启动性能是主要成本 | **优先方向** |
| 浏览器侧边栏 | 阅读网页时与搭搭对话，处理选中文字或保存链接 | 界面需要重新编排；读取网页需要内容脚本/授权；执行会话不能只依赖桌面 App 组件 | 第二阶段 |
| 全页面浏览器助手 | 理解当前网页、管理标签页、代用户执行操作 | 属于新增产品能力；需能力白名单、站点授权、内容隔离与审批，不由换成扩展自动获得 | 另行设计，避免纳入首版 |

新标签页使用清晰单一用途：**用 AI 搭建自己的浏览器起始空间。** 可选书签功能与这个用途相符。首版不需为了新标签页就申请浏览历史、所有标签页内容或所有网站的长期读取权限。Chrome 隐身窗口不支持这类新标签页覆盖，不能承诺相同行为。

## 3. 首要技术边界

### 3.1 AI 聊天与执行生成代码必须分开判断

调用模型拿到文本、布局数据、工具参数，与在扩展里执行生成的 JavaScript，属于不同问题。调整页面、主题与内置组件的 AI 工具可沿用；自由生成 App/Applet 必须单独验证。

普通 MV3 扩展页的最低 CSP 不允许随意开启内联脚本、`eval`/`new Function` 或远程脚本。当前 App/Applet 使用 `sandbox="allow-scripts"` 的 `srcdoc`，内部 meta CSP 不能被假定可以放宽父环境的限制。现有网页沙盒不是扩展 manifest 声明的 `sandbox.pages`，需要通过真实扩展原型验证与调整。

可研究的运行器方向：将沙盒引导页面和 SDK 打包到扩展，通过 manifest 声明隔离的 sandbox 页面，以消息传递接收应用内容并返回受限结果。隔离页不能直接拿到扩展 API。宿主继续验证来源、session、应用身份、操作与参数，生成代码不能直接获得书签/网络/页面读取能力。

商店政策明确允许与扩展 API 隔离的 iframe/sandbox 页面享有远程代码限制的例外，但仍要求完整功能可确定并满足用户数据政策。因此 **sandbox 是可研究的技术路线，不是保证审核通过的凭证**。当前允许 `https://esm.sh`、jsDelivr、unpkg 的任意 ES module 导入，不能原样作为已验证的商店路线。应优先研究打包固定依赖、明确可审查的功能集合；如选择声明式应用协议，必须设计受限行为表达与解释器，不能仅把 JS 字符串塞进 JSON 就称为配置。AI 生成代码、用户提供代码与远程库各自适用的政策边界，需要依据实际执行路径判断。

不建议把远程网站 iframe、CDN 或 `userScripts` 当作未经验证的通用绕过路径。网站入口方案也不应被宣传为完整本地扩展，是否允许特定远程嵌入应单独核查官方政策与功能边界。

### 3.2 多标签页一致性比迁移存储 API 更重要

当前 `workspaceStore.current`、`store.memory`、`componentData.cache` 和资源缓存都属于各页面自己的内存。`commit(next)` 把整份工作空间写回 localStorage；所读路径未见跨标签页变更订阅和工作空间版本提交检查。数据库事务能保证单次写入的原子性，不能使多个 React 实例的内存自动一致。

静态推导的风险场景：A、B 同时打开同一工作空间；A 改主题，B 从旧缓存新增组件并提交整份快照，A 的主题可能被覆盖。当前 UI 的单次发送锁也只约束本页面，不是跨页面 Agent 锁。此轮没有运行该场景，须作为原型验收项。

建议明确工作空间写入所有者与提交版本，变更通过 BroadcastChannel 或扩展消息通知其他实例失效/重读；并以事务版本比较或等效串行提交避免基于旧快照写回。**只加广播或只加一把锁都不够**，锁内仍需检查基线或重放领域操作。组件业务数据、应用数据、聊天与撤销历史要分别定义更新语义。

现有 `dada-storage-restore` Web Lock 保护恢复流程，不代表日常编辑、自动同步和 Agent 执行已有跨实例协调。自动同步目前由每个页面启动定时器，扩展版要定义一个协调策略，避免每个新标签页重复发起相同工作。

### 3.3 网络权限是浏览器层的第二道授权

Web 版 [RSS](../../../src/lib/rss.ts)、[App bridgeFetch](../../../src/widgets/app.tsx)、[搜索](../../../src/lib/webSearch.ts)、[同步 providers](../../../src/lib/syncProviders.ts) 和 AI provider 目前分散调用 fetch。开发期 Vite 中间件和 Docker 的 `/__proxy` 不能随静态包在扩展里运行。

有目标站 host permission 的扩展页面或 service worker 可按扩展规则跨域请求；内容脚本仍受其所在网页的跨域规则限制。因此不必保留所有纯 CORS 中转，但服务器鉴权、目标站限制、局域网可达性等问题仍在，不能承诺任何 API 都直连成功。

建议提供共享网络边界：Web 实现继续支持代理；扩展实现按需申请 API/RSS/同步目标来源的权限，在受信任上下文取数。应用内的 `networkGrants` 是搭搭自己的授权，不等于 `chrome.permissions`，两层授权都要满足。模型工具不能自行触发无用户手势的权限弹窗；缺权限时先让用户在明确交互中连接站点，再继续执行。

网络消息不可接受任意页面发来的 URL 后附带用户凭据。需区分 AI API 凭据、数据源取数与生成应用请求，限制协议、目标和响应，防止把书签桥扩成任意受权网络代理。

### 3.4 不把 service worker 当作永久运行的服务器

现有 AI 执行由 [App](../../../src/App.tsx) 持有 AbortController、审批、流式状态和宿主。新标签页内执行可以先保留这一生命周期，但必须明确：关闭页面不保证任务继续。

MV3 service worker 会休眠，没有 window/DOM，也不能使用 localStorage。后台若需要配置，应通过异步存储适配接入。不能直接搬入当前依赖 React/window/localStorage 的完整运行时。

只有明确要求跨页面继续任务、后台提醒或后台同步时，再设计可恢复的执行记录与消息协议，依据平台限制使用事件、alarms 或适合的上下文。流式活动可能影响存活条件，但不是无限保活承诺。专注计时可保存绝对截止时间，恢复时计算剩余量；需要准时提醒时再讨论 alarms/notifications，不靠某个页面的 setInterval 常驻。

### 3.5 单独构建扩展目标

- Web 保持 PWA；扩展本地页面由扩展更新机制分发，不沿用 `main.tsx` 的 PWA 注册与刷新提醒。MV3 后台 worker 与 Workbox worker 是不同职责。
- 增加扩展入口/manifest 生成与打包目标，核对入口 HTML、config、静态资源、动态分块和扩展页面路径。当前 `pack:ext` 只压缩 `extension/` 书签桥，不会把 Vite 主应用自动装进扩展。
- `config.js` 在扩展中应使用打包配置或受限数据配置，不依赖 Docker 启动时生成脚本。当前 [analytics](../../../src/lib/analytics.ts) 会按配置插入远程 Umami JS，扩展目标应禁用或改为政策允许的本地实现；默认无配置时不会加载，不代表已经具备扩展分流。
- Google Fonts、图片、音频与 API 数据不是远程 JavaScript 的同一种限制，但仍需分别设置资源 CSP、隐私披露与离线降级。Spline 等重型依赖及其运行时下载内容需要检查实际构建和网络行为，不能仅凭依赖名称判定合规。
- 每次新标签页都会新建页面实例。当前入口等待存储初始化，组件数据会全量读入内存，资源缓存仅在单页面共享。需测真实启动、内存、网络放大后再决定缓存或懒加载；此轮未测性能，不下“已经卡顿”的结论。

## 4. 数据与发布

`https://站点` 和 `chrome-extension://扩展ID` 属于不同 origin。新标签页与扩展自身侧边栏可共享该扩展的持久化来源，但仍各有内存缓存；网页数据不会自动出现。推荐先复用显式 JSON 备份导入或用户选择的同步连接，不要求自动清空网页数据或新增历史兼容层。

IndexedDB 适合继续承载业务数据。chrome.storage 可用于后台需要的配置和消息通知；chrome.storage.sync 配额较小，不适合整套工作空间、长聊天和应用数据。站点清理、扩展卸载与浏览器配置文件的存储生命周期不同，备份入口仍应保留；开发加载时也应保持扩展身份可重复。

Chrome/Edge MV3 作为第一目标更集中，但商店审核、权限表现和兼容性仍需分别验证。Firefox 支持新标签页覆盖，其侧栏与后台模型不能照搬 Chrome；Safari 还有独立打包与分发流程，不承诺一份 manifest 覆盖全部浏览器。

当前 [商店材料](../../extension-store-listing.md) 面向“不联网、不含统计、不读取网页内容”的书签桥。若扩成完整搭搭，涉及 AI 请求、数据源和可选同步，说明、权限理由和隐私政策必须按实际版本重写，不能继续沿用原声明。

## 5. 推荐推进顺序与验证门槛

| 阶段 | 可审查交付 | 通过条件 |
| --- | --- | --- |
| 1. 本地技术原型 | 不上架的 MV3 新标签页构建；真实样例覆盖主页、AI 工具、App 与 Applet | 冷启动可用、无关键 CSP 报错、固定依赖路径明确、沙盒拿不到扩展 API；失败路径有用户可见提示 |
| 2. 共享平台适配 | Web/扩展网络与书签适配、存储协调、入口分流 | 两页面同时编辑不静默覆盖，旧页面恢复不会反向覆盖；权限拒绝/撤销、备份导入、离线打开通过 |
| 3. 首个扩展发布范围 | 明确包含的 AI 应用能力及政策依据、独立商店包与披露 | 构建产物和依赖审计、平台真实回归通过；是否上架和实际审核结果单独确认 |
| 4. 侧边栏 | 为窄屏组织的聊天/保存链接/选中文字上下文 | 只读用户授权页面，来源与网页指令隔离；关闭、切换标签页和任务取消行为清晰 |

首轮原型至少覆盖：①默认 iOS/玻璃 Dock；②主页 AI 搭建；③无外部库的 Applet；④含固定依赖的 App；⑤新增 API 域名与拒绝授权；⑥两新标签页并发编辑；⑦关闭聊天页面/后台 worker 重启；⑧备份导入与重新打开。只有这些证据出现后，再估发布工期和决定完整应用兼容承诺。

## 官方依据与验证限制

平台文档与政策原文见下列官方链接；专项核查原文摘录保存在本次 Trellis 调研任务。源码判断基于当前 `main`，不是完整浏览器扩展运行结果。

- [Chrome：覆盖新标签页](https://developer.chrome.com/docs/extensions/develop/ui/override-chrome-pages)
- [Chrome：扩展 CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
- [Chrome：manifest sandbox](https://developer.chrome.com/docs/extensions/reference/manifest/sandbox)
- [Chrome：远程托管代码排查](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code)
- [Chrome Web Store：Additional Requirements for Manifest V3](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)
- [Chrome：跨域网络请求](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- [Chrome：可选权限](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [Chrome：service worker 生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome：存储 API](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Chrome：存储与 Cookie](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)
- [Chrome：sidePanel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [MDN：chrome_url_overrides](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/chrome_url_overrides)
- [MDN：sidebar_action](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/sidebar_action)
- [Apple：Safari Web Extensions](https://developer.apple.com/documentation/safariservices/safari-web-extensions)

本轮仅源码与官方资料调研、文档校验；未更改运行时代码，未加载完整扩展，未请求模型/用户服务，未运行类型检查、测试或构建，未提交商店审核。
