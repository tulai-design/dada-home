# 浏览器扩展运行契约

状态：当前实现，2026-10-30。目标 Chrome/Edge Manifest V3 开发者模式；商店上架和其他浏览器版本不在范围。

## 产品与打包

完整新标签页与 Web/PWA 共用 React 主应用、领域模型、主题与组件。`browser-extension/` 保存完整扩展 manifest、后台与隔离沙盒，原 `extension/` 继续作为网页书签桥独立发布。

`build:extension` 生成 `dist-extension/` 与 `public/dada-extension.zip`；`build` 先生成该包再构建网站，因此「设置 → 浏览器扩展」下载的是当前构建的完整包。ZIP 根目录包含 manifest 和主页，不嵌套下载 ZIP、不包含用户数据。固定 manifest 公钥维持扩展 ID；不保存签名私钥。

扩展构建不注入 PWA manifest/Workbox、不注册网页 Service Worker，不调用网页 analytics 初始化，`config.js` 使用包内空配置。扩展后台 service worker 只处理浏览器入口和原生书签，不是永久运行的 Agent。

## 运行与数据

完整应用初始化前获取 `dada-extension-workspace` 独占 Web Lock。只有持锁文档初始化业务缓存、应用、聊天和自动同步；等待页面只呈现定位已打开主页的入口，不启动第二份业务运行时。锁随浏览器文档关闭释放，下一等待页面持锁后重新读取持久化并启动。无 Web Locks 时显式停止启动，不退化成无保护编辑。

这是单运行实例策略，不是跨页面协作协议。多个页面不能各持旧缓存编辑，等待页面不会定期抢锁或强制关闭正在执行的页面。网页构建原来的多标签页边界不变，不能宣称整个项目已支持任意多写入者。

扩展运行页存在排队/在途业务保存或保存故障时，关闭前触发浏览器离开提示并启动保存屏障；保存完成后不再提示。浏览器不保证等待卸载阶段的异步保存，用户确认强关、崩溃或系统结束仍可能丢失尚未提交的数据。只对已完成保存的数据承诺接续读取，不把离开提示当成提交成功。

网站与扩展 origin 的数据独立，继续使用现有 IndexedDB/localStorage、备份与同步。用户显式导入备份或连接同步服务，不自动访问现有站点数据，不自动清空任何来源。更新应保留原扩展，卸载可能清除数据。

## 网络与权限

可信扩展主页安装统一 fetch 适配，HTTP(S) 请求先核对 `chrome.permissions`，缺少来源权限时进入 UI 等待队列。只有用户点击允许才同步发起浏览器权限请求；拒绝、撤销和 AbortSignal 取消不继续发送该请求。按协议/主机合并，浏览器来源授权不区分端口，提示显示实际授权范围。

扩展中的同源 `/__proxy?url=` 解包为 HTTP(S) 目标；自定义远端代理不自动替换。RSS、应用取数、快照同步和增量同步在启动网络/SDK计时前预授权；纯本地绑定和冲突查看不申请网络权限。请求方法、正文、Authorization、响应头、正文流与请求取消沿用 Fetch；并非将 API Key 交给任意沙盒代理。

App/Applet 的原有应用域名授权仍在宿主校验，浏览器主机权限是额外条件。书签通过同扩展可信消息调用既有 handlers；通知权限保留专注完成的系统提醒，不增加读取网页内容、历史或广泛标签页权限。

HTTP(S) 默认请求不自动跟随重定向，避免跳转目标绕过来源授权。Fetch 不向脚本公开跨来源跳转的 Location，因此收到重定向时明确提示填写最终服务/订阅地址，不尝试猜测下一跳；显式 `redirect: 'manual'` 或 `'error'` 沿用 Fetch 语义。包内资源不受此规则影响。

## 生成应用

Web 继续采用原 srcdoc。扩展使用 manifest `sandbox.pages` 中的包内 bootstrap，只接受直接父窗口的一次初始化，再运行同一份 App/Applet 文档。应用代码不能访问扩展 API，取数、存储、复制和 AI 等请求继续由宿主验证消息 source、session、参数与权限。

生成文档或运行会话变化时新建 iframe；普通主题、设置和尺寸变化继续通过既有协议热更新。SDK 保存回执仍在宿主完成提交后发送，不因扩展引导提前确认；App/Applet 存储边界和生命周期不变。

原有支持的 CDN ES module 路径保留在隔离沙盒 CSP 中，仍受实际网络和目标站 CORS 限制。运行页关闭后应用与 AI 随文档终止；不宣传后台常驻或离线模型。开发者模式技术可运行与商店政策审核是不同事项。

Spline 使用单独的 `spline.html` 隔离页运行包内 runtime，以支持其动态编译和 Blob Worker；宿主只传递既有官方域场景地址，接收会话匹配的加载/失败状态，不提供扩展 API 或宿主取数桥。普通扩展页的 CSP 不放开 `unsafe-eval`，App/Applet 页另有更严格的 meta CSP。场景错误继续进入既有特效降级，容器变化调整画布，离屏、减少动画和预算策略仍由原特效宿主管理。远程资源与高级场景依赖仍受网络及供应商资源限制。

## 验证入口

- 平台和权限：`scripts/test-extension-platform.mjs`
- 引导来源与 Web 路径：`scripts/test-extension-sandbox.mjs`
- 真实隔离 SDK/逻辑沙盒：`scripts/test-extension-sandbox-browser.mjs`
- 真实 Spline 隔离页、桌面/窄尺寸画布像素：`scripts/test-extension-spline-browser.mjs`
- 完整 MV3 安装与应用：`scripts/test-extension-browser.mjs`

运行证据以对应 Trellis 任务 verification 为准，不能从脚本存在推断测试已通过。原可行性分析见[调研](../work/research/2026-10-30-browser-extension-feasibility.md)。
