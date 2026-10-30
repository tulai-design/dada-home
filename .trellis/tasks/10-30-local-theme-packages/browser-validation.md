# 本地主题包浏览器验收

基线：`7fa143a`。本文件记录实际运行，未运行的部分不算通过。使用全新 Chromium context/profile、隔离 IndexedDB 与合成业务数据；不读取真实用户数据、不请求真实模型或上传文件。

## 命令与资源

Node 与 pnpm 使用本机 `/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/`；Playwright 使用已有 `/Users/xiaomengdao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`。

开发服务：本机 Node 启动 Vite `--host 127.0.0.1 --port 5201 --strictPort`，用于开发生命周期回归。正式构建通过静态 `vite preview --host 127.0.0.1 --port 5204 --strictPort` 服务。两服务验后均由本 worker 关闭，未触碰用户5173。

真实字体 fixture 从已有 `node_modules/.pnpm/katex@0.16.47/node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2` 运行时读取（26,272 bytes，`wOF2`）；同名字体另一份字节用 `KaTeX_SansSerif-Regular.woff2`。不把 TTF 改后缀伪造 WOFF2，不提交字体，不新增依赖。坏字体保留真实 WOFF2 头与声明长度、破坏压缩表数据，并重新计算 manifest/resource 摘要，检验实际 FontFace 解码拒绝。

```sh
DADA_PLAYWRIGHT_PATH=/Users/xiaomengdao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright /Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/node scripts/test-theme-packages-browser.mjs
DADA_PLAYWRIGHT_PATH=/Users/xiaomengdao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright /Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/node scripts/test-theme-packages-lifecycle-browser.mjs
/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/node scripts/test-theme-package-preview.mjs
```

## 红绿与已完成证据

- 独立二进制资源协议先红：新增真实 validator/reader 行为测试运行失败于 `isThemePreviewResourceRequest is not a function`；实现及审查补强后 **12/12** 通过。覆盖精确依赖、未知/路径字段、预算、bytes/error互斥，以及实际 reader 对坏 source/origin/channel/revision/generation/ref 拒绝、正确响应解锁、abort清等待/监听、即时store patch但React effect未flush时旧资源不转发、transfer只交出副本、旧pending requestId不能拼接新draft/revision/generation。沿用字体 worker 的严格 ref validator 与 PACKAGE_LIMITS，不维护第二套格式。
- 原主题预览协议/桥 **17/17** 通过。
- 首轮真实 Web 流程 **14/14** 通过；追加同 family 不同字节与坏 WOFF2 后 **16/16**。日志 `/tmp/dada-theme-packages-web-first.log`、`/tmp/dada-theme-packages-web-second.log`。
- 原作者 UI 定向回归 **19/19** 通过，含 iframe reload、旧消息、字体失败/恢复、移动几何与焦点。日志 `/tmp/dada-theme-packages-authoring-regression.log`。
- Win98 包跨壳生命周期最终 fresh **8/8** 通过，日志 `/tmp/dada-theme-packages-lifecycle-final.log`。真实 API 是浏览器已加载的同一模块 URL（从 resource performance entries 取得，避免开发 HMR 双实例），不新增生产测试桥。
- 开发首轮有两个fixture问题已修并在静态产物验证：等待上一revision仍存在的“资源检查完成”文字不足，改等iframe实际新主色；MV3第二个fresh profile启动天气权限请求自然过期时按钮会detach，点击失败只在按钮仍可见时视为错误。另一次开发末段受core文件HMR整页reload打断，最终验证改静态产物，不放宽产品断言。

生命周期保留项是同一待办输入节点与未提交值、同一应用 canonical iframe、应用持久计数 `初始化 1`、应用未提交输入、助手草稿、同一待决审批节点及模型请求数1。经历：启用包不切选择 → 激活 Win98 包跨壳 → 停用回到 paper/standard/系统字体 → 再启用恢复原完整 Win98 设计；停用后还检查旧预览readiness立即失效、inspect资源false、旧apply拒绝；最后真实「停止」取消待决删除，页面仍存在。

## 正式生产矩阵与最后增量

**正式 PWA 离线完整流程22/22、真实MV3完整流程21/21均通过**。日志 `/tmp/dada-theme-packages-pwa-final.log`、`/tmp/dada-theme-packages-extension-final.log`，结构化结果各在 `/tmp/dada-theme-packages-pwa/results.json`、`/tmp/dada-theme-packages-extension/results.json`。最后仅对原始pending请求身份增加更严格核对；该增量由资源协议12/12及最后构建的preview-only实际Web/MV3再验，下文另记，未重复无关全矩阵。

```sh
DADA_QA_MODE=pwa DADA_QA_URL=http://127.0.0.1:5204 DADA_PLAYWRIGHT_PATH=/Users/xiaomengdao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright /Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/node scripts/test-theme-packages-browser.mjs
DADA_QA_MODE=extension DADA_PLAYWRIGHT_PATH=/Users/xiaomengdao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright /Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/node scripts/test-theme-packages-browser.mjs
```

`test-theme-packages-browser.mjs` 同一公开 UI 流程用于 Web 与真实 MV3：文件选择、摘要确认、disabled安装、enable/贡献选择、FontFace loaded/check和内部alias、父/iframe独立本地字体、草稿修改/应用、原包下载、变体完整资源闭包下载与全新存储重新安装、停用回落/恢复、引用保护/解除引用后卸载、刷新、幂等、损坏/不支持设计、390/320真实filechooser与几何/焦点、同名字体字形不变、坏字体解码失败不启用。

`DADA_QA_MODE=pwa` 在 service worker 已激活并控制页面后设 offline，再以新页面启动并运行同一 UI 与资源流程；不会将仍在线旧页称离线通过。`DADA_QA_MODE=extension` 使用最终 dist-extension 和全新临时 profile，实际 chrome-extension URL、文件选择、下载及独立 iframe，不依赖开发工具桥。

零外网字体断言覆盖本地包/本地变体/准备/停用回落/预览全流程；收尾用户明确选择内置 iOS 后允许该内置方案的受控 Google 字体，不把它误记成本地资源回退。预览不导入业务 App/store/sync/AI，不创建资源对象 URL；导出下载 Blob URL在1秒后回收。Chrome CSP 错误与未处理脚本错误单独记录。模板/同步/备份与额度/竞态采用领域/资源 worker 的测试，本文件不将其冒称为全部浏览器覆盖。


## 截图实际审阅

已用图像工具实际查看正式MV3与PWA截图，不只依赖DOM几何：

- `/tmp/dada-theme-packages-extension/packages-desktop-dark.png`：桌面深色，既有主题库与包卡清晰分组，启停/导出/使用入口可见。
- `/tmp/dada-theme-packages-extension/packages-390.png`：390px深色，包卡不横向溢出，操作可点且不被Dock遮住。
- `/tmp/dada-theme-packages-extension/packages-320.png`：320px浅色，包按钮自然换行，摘要与主题名称换行而不覆盖；底部Dock继续可用。上方个人主题行因原Row固定控件占宽，说明文字较窄，但没有重叠或控件越界。
- `/tmp/dada-theme-packages-lifecycle/win98-package-lifecycle.png`：Win98桌面与助手审批/草稿并存。截图里的默认Noto字体失败toast来自夹具初始内置iOS远端字体，不是本地包字体失败；本地FontFace检查及零外网边界另外断言。

安装摘要只宣称已校验结构/header/hash并保存停用；真正字体浏览器解码在启用前进行，不把安装成功当资源已可用。停用方案改名保存失败会留在原Modal、保留输入并显示错误；不可用外框开关禁用；不可取消的IDB安装/停用/卸载和导出不显示“停止”。

## 最后两处会话身份加严后的产物定向

最后构建后实际 **PWA preview-only 6/6、MV3 preview-only 5/5** 通过。覆盖当前真实文件导入/启用准备/选中贡献/父FontFace loaded+alias/iframe独立二进制读取/草稿修改到新颜色/正式应用/无CSP及未处理错误；PWA额外包含受控SW后的离线新页启动。合法当前会话在新增原始request身份核对后仍可完成实际字体传输与应用。

```sh
DADA_QA_PREVIEW_ONLY=1 DADA_QA_MODE=pwa DADA_QA_URL=http://127.0.0.1:5204 DADA_QA_OUTPUT=/tmp/dada-theme-packages-pwa-preview-final DADA_PLAYWRIGHT_PATH=/Users/xiaomengdao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright /Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/node scripts/test-theme-packages-browser.mjs
DADA_QA_PREVIEW_ONLY=1 DADA_QA_MODE=extension DADA_QA_OUTPUT=/tmp/dada-theme-packages-extension-preview-final DADA_PLAYWRIGHT_PATH=/Users/xiaomengdao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright /Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/node scripts/test-theme-packages-browser.mjs
```

日志 `/tmp/dada-theme-packages-pwa-preview-final.log`、`/tmp/dada-theme-packages-extension-preview-final.log`；结果JSON在相应output目录。错误组合（旧pending id+新revision/draft/generation）由真实生产gate `sameThemePreviewSession` 的回归断言拒绝；延迟读取中立即patch但effect未flush不发送字节由生产 `readThemePreviewResource` 的deferred回归断言验证，合计资源协议 **12/12**。没有靠改DOM或删验收断言伪造通过。

最后检查的作者表单截图滚动到了主色字段，预览已滚出截图视口，不能作为预览同时可见的证据。独立预览字体、颜色、就绪和正式应用前隔离由真实行为断言验证；包管理桌面/390/320截图另已实际检查。

本轮专用开发5201与预览5204服务已停止，确认无监听；未改动用户5173服务。
