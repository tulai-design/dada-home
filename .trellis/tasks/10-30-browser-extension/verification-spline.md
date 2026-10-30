# Spline 与生成应用沙盒验证

日期：2026-10-30。使用独立临时 Chromium 配置目录加载真实 Manifest V3 扩展，不读取用户资料或调用用户服务。

## 已交付边界

- App/Applet 共用 `sandboxFrameProps`。Web 保留原 srcdoc；扩展由包内 bootstrap 接受直接父窗口一次初始化。原 source/session、存储回执、设置和主题更新合同继续使用。
- Spline 使用独立 `spline.html`，包内 runtime 构建为 IIFE 以避开 opaque-origin 模块加载限制。官方场景地址继续使用已有校验；宿主仅发送加载请求、接收加载/失败消息。失败进入原特效错误边界，iframe 卸载释放运行页。
- `sandbox.pages` 只包含生成应用和 Spline 两个隔离页，不启用 allow-same-origin。普通扩展页没有 unsafe-eval；Spline 所需 eval/Blob Worker 权限仅位于沙盒策略。生成应用 bootstrap 通过 meta CSP 收紧网络/子框架，再执行原应用文档。

## 实际验证

- `test-app-runtime.mjs`：7/7，含应用自身域名授权、浏览器授权，以及授权等待不计入 15 秒业务超时。
- `test-applet-runtime.mjs`：10/10，原运行会话、事件与持久化合同。
- `test-extension-sandbox.mjs`：Web 路径、父来源、会话输入、单次初始化通过。
- `test-extension-sandbox-browser.mjs`：真实 MV3 中 App 存取/按钮/主题、Applet 事件/保存/恢复、CDN ESM 合成响应通过，未暴露 chrome.runtime。
- `test-extension-spline-browser.mjs`：加载目录已有公开示例 `https://prod.spline.design/6Wq1Q7YGyM-iab9i/scene.splinecode`，收到 loaded；640×480 画布截图量化颜色 57 种、深色像素 307018；缩为 360×280 后颜色 64 种、深色像素 100649。截图人工核对为真实圆角立方体及坐标轴，非空白；无控制台错误/CSP 拒绝，沙盒没有 chrome.runtime。
- Spline 桌面与窄尺寸截图：`/tmp/dada-extension-spline-desktop.png`、`/tmp/dada-extension-spline-mobile.png`。窄尺寸验证隔离画布自适应，不改变产品既有窄屏特效预算降级。
- 该轮 Spline 源码的 TypeScript 与扩展构建已通过；完整最终构建与全量回归由主会话记录。

## 验证限制

真实场景测试覆盖已有简单公开示例与画布 resize，未遍历供应商全部场景。物理、Draco、Gaussian 等高级资源/Worker 未逐一实测；runtime 的 wasm/CDN 路径保持与 Web 默认行为一致，没有声明离线场景能力。网络不可达仍可能使远程场景失败，沿用特效降级。生成应用 CDN ESM 使用合成响应验证执行链，不代表所有第三方 CDN 的实时 CORS 与可达性。未进行商店审核。
