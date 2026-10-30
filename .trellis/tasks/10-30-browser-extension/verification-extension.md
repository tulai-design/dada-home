# 完整浏览器扩展验收

日期：2026-10-30。检查基点：`b1df537`，包含本轮未提交 diff 与新增文件。使用真实 Chromium MV3，独立临时用户配置、合成应用/凭据和本机 HTTP 模型服务；不读取真实浏览器资料，不调用用户接口。所有临时配置与临时预授权扩展副本在脚本结束后清理。

## 实际结果

`scripts/test-extension-browser.mjs` 最终 **14/14 通过**：

1. ZIP 根目录包含 manifest、主页、后台和沙盒资源，不递归包含 ZIP 或源码目录。
2. 真正打开 `chrome://newtab`，完整应用启动；默认 iOS/浅色与玻璃 Dock，不注册网页 PWA、不注入网页统计。
3. App/Applet 在真实 manifest sandbox 导入合成 CDN ES module，执行交互；真实 IndexedDB 保存后重载读回，沙盒没有 `chrome.runtime`。
4. 两类运行器接收明暗热切换；320×760 浅深色无根级横向溢出。
5. 实际网络授权弹窗 UI 拒绝后，请求失败且本机服务没有收到该请求。
6. 原生书签桥可读取浏览器书签。
7. 两个扩展页只有一个业务实例，等待页无 `.app`；「回到搭搭」实际激活原页面，关闭原页后等待页接续并读到两类应用最新已保存数据。
8. 扩展设置显示已安装、开发者模式安装、数据独立和更新说明。
9. App/Applet 独立窗口接收设置修改，保留计数和 `modal` 形态。
10. 实际 UI 导出完整 JSON，包含两类应用数据和设置。
11. 原样备份经真实网页文件导入 UI 恢复并自动重载；真实 IndexedDB、pages、applications（含源码/设置）和全局 settings 与备份逐项一致。网页设置实际下载的 ZIP 与当前构建下载包字节相同。
12. 独立网页浏览器上下文首次安装 PWA 后关闭原页，离线新开页面可启动完整应用并打开设置；导航来自 Service Worker，网络探针实际失败。检查启动 App/同步依赖的预缓存。
13. 在仅预授予 localhost 的临时扩展副本中，真实宿主 fetch 解包 `/__proxy`，助手 UI 发送本机合成 SSE 请求，显示完整回答；重载后点击历史会话读回回答。模型请求恰好一次、正文 `stream: true`。
14. 最终所有场景 **未捕获 JS 错误为 0、关键 CSP 拒绝为 0**。

## 发现与修复

- 第一轮真实设置入口发现：已定义 extension section，但分类索引遗漏其 ID，用户无法进入。主会话补入「本机」分类，最终真实点击通过。
- PWA 离线新页发现：动态加载的 `virtual_pwa-register` 缺少预缓存，应用虽启动但产生未捕获模块加载错误。主会话补齐该脚本及 Workbox 依赖预缓存，最终错误守卫通过。
- 其他脚本调整属于测试夹具：实际 Dock 属性、设置导航、天气授权模态框隔离、重载后选择历史会话、Web opaque srcdoc 远程模块路由限制，未据此修改产品。

## 证据与命令

结果和截图位于 `/tmp/dada-extension-browser/`：`results.json`、`default-ios-glass.png`、`apps-320-light.png`、`apps-320-dark.png`、`extension-install-guide.png`、`website-extension-download.png`、`website-pwa-offline.png`、`extension-model-stream.png`。合成备份为 `extension-backup.json`，实际下载副本为 `downloaded-extension.zip`。

```sh
DADA_PLAYWRIGHT_PATH=/Users/xiaomengdao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright /Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/node scripts/test-extension-browser.mjs
/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm exec tsc --noEmit
git diff b1df537 --check
```

浏览器脚本语法检查、TypeScript 检查与 diff 空白检查通过。项目没有独立 lint 命令，未运行或声称 lint。最终完整 test/build 由主会话统一执行和记录；此检查代理未自行重复整包构建或全测试。

## Spec 审查与验证边界

对照任务 PRD、design 和 `b1df537` 以来 diff/新增模块审查：共用主应用、原书签桥保留、来源授权、沙盒隔离、单实例启动、稳定扩展 ID、双构建下载和文档契约均有实际代码路径；未发现剩余范围内阻塞问题。

原生 Chrome「允许来源权限」确认气泡不能由本次 headless 自动确认；实际验收覆盖应用 UI 拒绝，以及临时 localhost 预授权后的网络/流式成功。没有把预授权夹具当作原生批准实测。未人工运行 Edge、未逐个遍历全部内置组件或每个真实同步供应商；生成应用/主题/存储与其他功能回归由既有完整测试及专项检查补充。强制关闭/崩溃前未提交写入不保证恢复，单实例接续只对已提交数据验证。

Web opaque srcdoc 的远程合成 ESM 请求无法稳定经过 Playwright route，故备份迁移验证使用原始文件导入后与数据库/配置等价检查，未声称该项同时验证 Web CDN 可达性。真实 MV3 的 App/Applet ESM、交互、持久化和设置已独立通过；Spline 另见 `verification-spline.md`。
