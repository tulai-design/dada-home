# 主题作者真实浏览器验证

日期：2026-10-30。实现基线 `7eb8701`，仅独立 Chromium context/临时扩展 profile；无真实用户浏览器、远端模型或真实业务数据。

## 运行入口

开发服务器由本机 Node 启动，独立端口 `http://127.0.0.1:5201`：

```sh
/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5201 --strictPort
```

下列脚本统一设置 `DADA_PLAYWRIGHT_PATH=/Users/xiaomengdao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`，使用本机 `/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/node` 运行。禁止使用用户浏览器 profile。

| 脚本/模式 | 实际结果 | 证据 |
| --- | --- | --- |
| `scripts/test-theme-preview.mjs` | 17/17 | 纯协议/bridge真实模块；全内置schema、64KiB UTF8、未知字段、数组伪装mode/status、正整数rev、有限geometry、资源错误、单连接替换与AbortError |
| `scripts/test-theme-preview-browser.mjs` | 完整56/56 | `/tmp/dada-theme-preview-browser-final.log`；五造型×浅深×1440/390/320/480共40场景，另16项事务/隔离/几何 |
| 同脚本 `DADA_QA_SKIP_MATRIX=1` | 19/19 | `/tmp/dada-theme-preview-browser-targeted-drawer-final.log`；最终小修后新增iframe reload、移动不相交、键盘焦点、无隐式npm字体、真实Lobe Drawer portal；不重复40矩阵 |
| `scripts/test-theme-authoring-lifecycle-browser.mjs` | 5/5 | `/tmp/dada-theme-authoring-lifecycle.log`、`/tmp/dada-theme-authoring-lifecycle/results.json` |
| `scripts/test-theme-render-browser.mjs` | 20/20 | 字体/正式渲染owner执行；`/tmp/dada-theme-render-browser/results.log`，覆盖文档字体lease与404/超时/实际font文件、全部skin浅深recipe、Switch缩放与Win98窗口gap在1440/390/320真实消费 |
| `scripts/test-theme-preview-packaged-browser.mjs` 默认PWA | 7/7 | 最后Web构建后，`/tmp/dada-theme-preview-pwa-final.log`、`/tmp/dada-theme-preview-pwa/results.json` |
| 同产物脚本 `DADA_QA_MODE=extension` | 6/6 | 最后MV3重构与ZIP后，`/tmp/dada-theme-preview-mv3-final.log`、`/tmp/dada-theme-preview-extension/results.json`；包含最终Drawer真实入口/输入/关闭 |

生产Web测试使用统一build产物与 `vite preview --host 127.0.0.1 --port 5204 --strictPort`。PWA先等待service worker激活与控制，再置离线并新开页面；离线从设置真实入口创建草稿、fonts设 `[]`，独立预览入口完成消息/资源/夹具报告、Lobe弹窗/抽屉portal、应用/取消。MV3使用最后`dist-extension`真实加载，预览JS与Web同为`themePreview-D1rkYpRH.js`（含最终Drawer样式），`window.__tada`不存在，全程使用产品UI。启动天气网络权限提示由测试明确点击「暂不连接」，不授予真实外网权限。没有用构建文件存在代替真实加载。

PWA构建从Vite真实静态依赖图收集index/themePreview及App、incrementalClient、syncService的import闭包再加入Workbox预缓存，不猜共享chunk命名，也不因此预缓存全部大体积懒资源。最终真实离线新页面与preview加载通过，构建日志`/tmp/dada-authoring-build-final.log`。

## 覆盖证据

- 正式iOS与预览Switch/Win98可同时不同主色、模式；父root inline变量、skin/mode、字体links、正式workspace均保持。实际Lobe Button/Input recipe圆角、Switch coverScale与Win98 windowGap样本测computedStyle。
- 预览独立document/root与portal；真实Lobe Modal、Drawer及固定通知均归iframe内的`preview-portals`，父body没有新增预览弹层。Drawer真实打开、编辑固定输入并关闭；静态窗口/抽屉卡片无业务动作。预览模块请求图不含App、workspaceStore、main、AI、sync、analytics或ApplicationHost，ConfigProvider关闭隐式npm字体注入。
- 五种造型每种浅深、四种fixture宽度实际测量viewport与横向overflow，并验证主色、减少动画标识。父390/320屏幕额外验证作者panel容器、预览与表单的垂直矩形不重叠、表单可滚动到达并实际点击输入。
- 严格拒绝其他window来源、错误origin/channel/draftId/revision/requestId的回执；伪造回执未完成真实pending请求，正确当前iframe回执随后才完成。
- iframe重载清旧readiness并自动重发当前草稿；收起保持iframe实例且inspect明确unavailable；patch自动展开。Agent改名/说明同步受控表单。设置入口用Enter创建后焦点在名称，连续Tab留在作者控件，收起/取消恢复仍可见触发点。
- 字体404明确显示family/降级原因且apply失败、保留正式主题和草稿；用户明确fonts `[]`后恢复ready，实际点击Apply才提交。取消与刷新不恢复内存草稿。
- 本轮真实iOS同shell草稿create→patch→inspect→apply→一次撤销，页面待办未提交输入DOM和值、生成应用canonical ID/iframe/init=1/未保存输入、助手草稿、待决审批节点均保持；模型请求数不增加，停止仍取消原待决删除。使用合成SSE模型，无真实网络。

## 发现与修正

初轮功能54/54通过后，Lobe控件与目录选项接入导致新测发现Select丢弃`aria-label`及其portal层级低于作者panel：使用显式label/id命名，并将panel置于Lobe标准popup层下，保留真实点击断言。独立审查发现iframe重载旧ready、移动grid隐式行重叠、设置入口焦点仍在背景、Lobe ConfigProvider隐式远程字体、Win98样本默认gap不一致，均完成修复与定向验证。追加Drawer真实portal检查时，其水平弹层忽略height属性，改用库提供的styles.popup/panel限制固定样本高度，保留真实点击关闭和输入验证。

开发过程中有两次全矩阵被其他worker修改`draft.ts`/Vite配置触发整页reload中断。这些运行作废，没有将context-destroyed降断言或算产品通过；代码冻结后fresh context得到完整56/56。生命周期第一次「撤销」命令名不匹配，修为实际公开命令「撤销上一步」后5/5；这仅是fixture修正。

## 视觉证据与限制

成功截图：`/tmp/dada-theme-preview-browser/switch-dark-320.png`、`/tmp/dada-theme-preview-browser/win98-light-480.png`、最终移动布局`/tmp/dada-theme-preview-browser/author-panel-390.png`与`author-panel-320.png`；最后生产桌面截图`/tmp/dada-theme-preview-pwa/packaged-author-desktop.png`与`/tmp/dada-theme-preview-extension/packaged-author-desktop.png`。旧failure截图仅调试证据，不是最终验收。

inspect只报告schema、字体资源与固定夹具有限横向几何；对比度、审美、所有交互及第三方应用内部均为unknown。静态shell展示不启动正式桌面controller的电池/网络监听；可信同源iframe是文档隔离，不是第三方敌对代码沙盒。网络字体的成功/404/超时/迟到lease与正式recipe/shell渲染另由字体/渲染owner的单测和20/20真实浏览器记录覆盖，本文不以模拟空CSS冒充字体实际加载成功。最后准备中patch/discard立即中止并释放字体lease由作者领域16组真实模块回归覆盖，浏览器不重复构造长期悬空外网请求。
