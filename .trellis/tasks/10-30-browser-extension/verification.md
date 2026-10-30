# 完整扩展交付验收

日期：2026-10-30，基线 b1df537，main 本地开发。用户已批准开发者模式自用完整扩展与下载入口，要求保留现有功能；未推送、部署或商店发布。

## 结果

- 完整 Chrome MV3 新标签页包已生成：dist-extension/，public/dada-extension.zip（约8.5MiB），Web dist 包含同一下载文件。ZIP 根目录有 manifest、主页、应用沙盒与 Spline runtime，无嵌套 ZIP 或用户业务数据。
- 网页「设置 → 浏览器扩展」提供实际下载、开发者模式安装、更新和备份说明。扩展内显示已安装及更新指引。
- 共享现有主应用、主题、Dock、内置组件、AI、App/Applet、书签与存储同步；新增平台适配，不复制领域实现。默认 iOS/玻璃 Dock。
- Web Locks 保证仅一个完整运行实例，等待新标签页定位现有页面或在其关闭后接续；pending 保存/故障有关闭提醒，不声称强关可等待异步事务。
- 来源权限等待 UI、预授权计时、原生书签、专注通知、App/Applet 隔离及 Spline 独立 runtime 已适配。跨来源重定向不会绕过授权，需用户填写最终地址。

## 已执行检查

- 本机 pnpm exec tsc --noEmit：通过；最终 pnpm build 再次执行类型检查。
- 本机 pnpm test：最终全部通过，含新增平台6/6、workspace3/3、closeguard4/4、background4/4与沙盒契约；同步授权时机11/11。
- 本机 pnpm build：通过，完整扩展与 Web 一次生成；PWA预缓存50项，覆盖动态 App、同步静态依赖、更新注册与Workbox脚本。日志 /tmp/dada-extension-build-final.log。
- 真实隔离 Chromium 完整 MV3 + Web：14/14，通过 App/Applet ESM、交互/持久化/主题/设置，320px浅深色，权限拒绝，书签，真实回到运行页，关闭接续，备份UI导出与Web导入记录等价，网站下载ZIP字节一致，PWA关闭旧页后新页离线启动，模型SSE和历史持久化，以及零关键CSP/未捕获JS错误。结果 /tmp/dada-extension-browser/results.json。
- Spline：真实公开场景渲染、桌面/窄画布像素、resize和API隔离通过，见 verification-spline.md。
- 真实通知：granted、创建与show事件通过，见 verification-notifications.md。
- 真实重定向：127.0.0.1获准，localhost未获准，默认请求显式报错，目标收到0请求；直连、manual/error均通过。test-extension-network-browser.mjs。
- Standards/Spec双轴审查：无未解决阻塞项；发现通知权限、重定向与离线更新注册chunk遗漏均已修复并验证。
- git diff --check、Trellis上下文校验通过；无独立lint命令，未声称运行lint。
- 用户报告的开发504已实测复现；重启开发server并--force重建预构建后，隔离浏览器首页正常、无失败请求。未清除应用数据，README补排查说明。

## 限制与安装

仅真实执行 Chromium，Edge为同类MV3目标但未单独运行。原生可选来源批准弹窗未自动点击，拒绝用实际UI，成功模型链路用仅预授予本机来源的临时副本。Web导入验证原始备份、源码、设置和IDB等价；opaque srcdoc无法稳定拦截合成CDN，因此没有宣称该Web夹具远程ESM执行通过。Spline高级物理/Draco/Gaussian未逐项实测，系统通知横幅受系统设置影响。未遍历所有真实服务，AI和在线组件仍需连接配置。

下载ZIP后解压，在chrome://extensions或edge://extensions启用开发者模式并加载含manifest.json的目录。网页和扩展数据独立，使用备份导入或同步。更新保留原扩展与目录，重新加载，不卸载以免清除本地数据。
