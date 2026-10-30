# 浏览器扩展平台与商店政策核查

日期：2026-10-30。状态：调研结论，非已实现功能、非商店审核承诺。资料来源为 Chrome、Mozilla、Microsoft、Apple 官方文档；Context7 用于定位，关键政策另读官方原文。

## 核心判断

搭搭可作为 Manifest V3 新标签页扩展，现有 React 页面不是障碍。真正需要先验证的是生成应用的执行边界、跨源请求、跨实例存储和新标签页启动成本。首选 Chrome/Edge；侧边栏应作为独立紧凑入口，不能把完整桌面缩窄后视作完成。

**技术可运行、隔离安全与商店允许，是三项不同条件。** “MV3 完全禁止 AI 生成应用”不准确；“套一个 sandbox 就保证能上架”同样不准确。

## 平台能力与约束

| 主题 | 官方事实 | 对搭搭的含义 |
| --- | --- | --- |
| 新标签页 | `chrome_url_overrides.newtab` 指向包内 HTML；替换的是浏览器新标签页。Chrome 隐身窗口不能覆盖新标签页。[1] | 单独构建包内入口，例如 `newtab.html`，可复用页面主体；不能把字段直接填成线上站点 URL。远程跳转/嵌入是另一种产品形态，需要单独评估体验与商店政策。 |
| 侧边栏 | Chrome `sidePanel` 自 114 起可用，默认路径为包内页面；`sidePanel.open()` 自 116 起可用，必须响应用户操作。[2] | 可做阅读摘要、收藏、AI 助手；需增加权限、独立窄屏 UI、用户动作与网页内容授权流程。 |
| 普通扩展页 CSP | `extension_pages` 有不能放宽的最低安全约束；不能加入 `unsafe-eval`，默认禁止内联脚本及字符串当作代码执行。迁移文档限定 `script-src`、`object-src`、`worker-src` 的可用来源。[3] | 不可在宿主页随意运行 `eval`、`new Function`、CDN 脚本；`blob:` Worker 也不能当作绕过 MV3 约束的方案。字体、图片、CSS 是数据资源，并不自动等于远程代码，但仍受对应 CSP/网络可用性约束。 |
| 扩展沙盒页 | `sandbox.pages` 在 manifest 显式声明包内页面，运行于独立 origin；无扩展 API，不能直接访问非沙盒页，可 `postMessage`。沙盒有独立 CSP，可允许 inline/eval，禁止 `allow-same-origin`。[4] | 建议包内 sandbox bootstrap + 消息传入应用内容/逻辑，并保留当前受控宿主桥。它是一条可行技术路线，但需真实 Chromium 加载验证。 |
| 跨域 | 扩展页和扩展 SW 可在所授予的 `host_permissions` 范围请求跨域资源；content script 的请求仍属于网页 origin、受同源/CORS 约束。[5] | 不能笼统说“装扩展后不需要任何取数代理”。应由可信扩展上下文按授权取数；鉴权、服务端拒绝、限流、网络、来源检查仍可能失败。严禁向任意网页/应用暴露无限 URL 代理。 |
| 后台生命周期 | Chrome 通常在 SW 空闲 30 秒、单项任务超过 5 分钟、`fetch` 响应超过 30 秒未到达时终止；特定 API 有版本相关例外。全局变量会随终止丢失。[6] | 不可把后台视作永久 Node 服务；AI 流式会话优先保留在可见新标签页/侧边栏，或设计可恢复任务。收到流不等于可以承诺无限后台运行。 |
| 前台寿命 | 新标签页、弹窗、侧边栏各自有 UI 生命周期；关闭页面会销毁它的 JS。侧边栏也可以被用户关闭。[2][6] | 需要明确关页时会话的中止/恢复语义；不能承诺关掉全部页面仍保持正在运行的 Agent 或 App。 |
| 存储 | 扩展页可用 IndexedDB；SW 可用 IndexedDB/Cache Storage，不能用 localStorage。扩展 origin 内的新标签页、弹窗、侧边栏、SW 共享 origin 存储，content script 的 Web Storage 则属于宿主网站。[7] | 可复用数据模型/IndexedDB，但要适配访问入口和多实例写入。网站 origin 和 `chrome-extension://ID` 不共享现有数据，导入/同步必须显式设计，不能暗示自动沿用网页数据。 |
| 扩展存储容量 | `chrome.storage.local` 默认 10 MiB，可用 `unlimitedStorage` 放宽；`chrome.storage.sync` 总量 102400 bytes、单条 8192 bytes、最多 512 条，并有写入频率限制。[8] | sync 适合少量设置，不适合整套应用源码、长聊天、附件或完整工作空间。IndexedDB 与现有同步系统继续承担大数据。不要把 local 的 10 MiB 当作 IndexedDB 全库上限。 |
| 容量/卸载 | `unlimitedStorage` 作用于扩展及 Web 存储的配额和驱逐保护；也可考虑 `navigator.storage.persist()`。`storage.local` 在扩展卸载时清除。[7][8] | 存储权限不能替代备份；稳定扩展身份、更新、卸载与重装的数据行为应列为验收。 |
| 多新标签页 | 同一个扩展 origin 会被多页共享。[7] | “共享数据库”不等于“共享 React 内存状态”；需验证多页订阅、编辑冲突、同步重复触发和单写入者/事务语义。此条为基于平台模型的工程推论。 |
| PWA | 扩展后台 SW 由 manifest 的 `background.service_worker` 配置，事件、环境和寿命遵守扩展模型。[6][9] | 扩展构建应关闭现有 PWA 注册、安装提示和网页更新逻辑，使用扩展商店/扩展更新机制；不能机械保留 Workbox 注册。包内静态资源可离线，不代表天气、AI、同步等网络服务可离线。 |

## 生成应用：技术与商店政策边界

Chrome Web Store MV3 附加要求原文指出：完整功能须可从提交代码中清楚确定，外部资源通常不能携带运行逻辑；把远程复杂命令包装成 JSON、再写解释器运行，也可能违规。[10]

但同一政策明确写出：**与扩展 API 隔离的 iframe 和 sandbox 页面，豁免远程代码加载限制**。仍须能确定完整扩展功能，并符合用户数据政策、Limited Use 与隐私声明。[10] 官方 Blue Argon 排查指南也明确列出 sandbox iframe 作为字符串求值的技术路径。[11]

因此：

- AI 根据对话调用已随包发布的工具，修改布局/主题/固定 schema，通常更容易清楚呈现功能。联网返回数据、纯配置本身不必然是远程代码；不要借“配置”隐藏任意执行逻辑。
- AI 生成任意 JS、从 CDN 加载模块、远端 HTML App：技术上可能在隔离环境实现；上架须说明生成/执行/取数/持久化完整边界，并进行专项 PoC 和审核风险评估。官方没有承诺“AI 生成代码”统一允许或统一禁止。
- `chrome.userScripts`/`debugger` 的例外有明确用途限制，不能用来规避本应用沙盒设计；不建议为此申请高权限。用户点了“生成”也不能自动推出所有结果都属于政策认可的用户脚本。
- 当前源码中 `src/lib/applet/runner.ts` 和 `src/widgets/app.tsx` 已使用 `iframe sandbox="allow-scripts"` 与 `srcdoc`，并允许部分 CDN 模块；**它们不是 Worker，也不能直接据此推导 MV3 已兼容**。应验证父页 CSP 与 srcdoc 的组合，优先验证 manifest 声明沙盒页方案。宿主与沙盒消息须校验 source、会话身份、调用 schema、应用身份和能力授权，不能提供任意扩展 API 转发。
- 本调研未安装完整扩展、未发起 CWS 提交；技术和审核结论都不能标成“已通过”。

## 多浏览器取舍

1. **Chrome/Edge 优先。** Microsoft 表示受支持的 Chrome API 和 manifest 字段通常可低改动迁移，但仍须按 Edge API 支持清单逐项核查，并做 Edge 侧载验证。[12] 不能把 Chrome 审核结果等同于 Edge 审核结果。
2. **Firefox 需要独立适配。** MDN 当前文档表示 Firefox 不支持 `background.service_worker`，使用非持久 background scripts；Firefox `sidebarAction` 与 Chrome `sidePanel` 不兼容。[13][14] 新标签页形态可复用，但 manifest、后台、权限与侧栏不能假定一个包通吃。
3. **Safari 另设分发工作。** Safari Web Extension 可复用 HTML/CSS/JS，但属于 Apple app extension 及对应分发模型；官方列出 Xcode 打包、现有扩展转换以及通过 App Store Connect 的打包分发路线。[15] 不宜把 Safari 说成与 Chrome 同一 zip 直接上架，也不宜绝对声称所有路线都必须在本机安装 Xcode。

## 建议实施前的最小验证

- 包内新标签页冷启动和多页同时打开，确认不重复初始化/反复触发同步。
- manifest sandbox 页执行一个纯逻辑 Applet 和一个自定义 HTML App；分别试内联脚本、允许/禁止的模块、消息与权限拒绝、沙盒销毁。
- 可选主机权限：用户点击后授权单一服务来源；取数失败、权限撤销、重定向与任意 URL 代理攻击。
- iOS/玻璃 Dock 静态主体先渲染，聊天、Spline、复杂特效/应用按需加载；不以网络远程整站作为冷启动依赖。
- 网页备份导入扩展、扩展多页编辑、关页中断 AI、后台终止再唤醒、升级与卸载重装的数据说明。

## 官方来源

1. [Override Chrome pages](https://developer.chrome.com/docs/extensions/develop/ui/override-chrome-pages)
2. [chrome.sidePanel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
3. [Manifest CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)；[Improve extension security](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security)
4. [Manifest sandbox](https://developer.chrome.com/docs/extensions/reference/manifest/sandbox)
5. [Cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
6. [Extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
7. [Storage and cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)
8. [chrome.storage](https://developer.chrome.com/docs/extensions/reference/api/storage)
9. [Extension service worker basics](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/basics)
10. [Chrome Web Store: Additional Requirements for Manifest V3](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)
11. [Deal with remote hosted code violations](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code)
12. [Microsoft: Port a Chrome extension to Microsoft Edge](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/developer-guide/port-chrome-extension)
13. [MDN: background manifest key](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background)
14. [MDN: sidebarAction](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/sidebarAction)
15. [Apple: Safari web extensions](https://developer.apple.com/documentation/safariservices/safari-web-extensions)
