# README 截图

这些 PNG 来自搭搭真实 React 应用，采用独立的临时 Chromium 上下文和合成展示数据，不连接个人浏览器，不读取用户数据或真实服务凭据。截图日期固定为 2026-10-30 09:41；真实 Google Fonts 样式与字体可联网加载，其他外部请求被阻断。

`hero` 为配置后的 iOS 首页；`ai-workspace` 展示分栏和预先写入的演示对话，未调用在线模型或伪造工具执行；`applications` 使用产品共用示例源码运行专注趋势与开销记录 Applet，数据为合成记录。五张 `theme-*` 展示内置主题的真实界面，`mobile` 为 390 像素窄屏。

这些图片说明可配置后的产品形态，不代表首次启动时已包含相同组件、应用或聊天数据。

## 重新截图

先启动开发服务器，再提供自己安装的 Playwright 模块路径；脚本不增加生产依赖，也不连接既有浏览器配置。

```sh
pnpm dev
# 在另一个终端中执行，替换为自己的 Playwright 安装路径
DADA_PLAYWRIGHT_PATH=/absolute/path/to/playwright node scripts/capture-readme.mjs
```

默认地址为 `http://localhost:5173`，可通过 `DADA_QA_URL` 指定另一个开发地址。脚本通过开发环境模块和公开工具配置临时工作空间，因此不能用于 `pnpm preview`。维护者应遵守根目录 AGENTS.md 的本机包管理器约定。

脚本结束会关闭临时浏览器；生成文件覆盖本目录同名 PNG。替换后应逐张检查字体、裁切、提示条和私密信息，并复查 README 的桌面及窄屏排版。
