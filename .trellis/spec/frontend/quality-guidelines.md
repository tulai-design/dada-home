# 质量检查

## 命令

以 [package.json](../../../package.json) 的真实脚本为准。当前没有 `lint` 脚本，不记录虚构的 lint 通过结果。用户明确要求使用本机 pnpm；即使 packageManager 元数据不同，也不要顺带切换包管理器或重装依赖。

```sh
/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm exec tsc --noEmit
/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm test
PATH="/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin:$PATH" /Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm build
```

`build` 内部调用 `pnpm pack:ext`，因此显式将本机 bin 放到 PATH 首位，避免子进程落到 Codex Runtime 的 pnpm。构建会生成扩展 ZIP 和 dist，检查工作区时区分生成物与源文件。

## 测试选择

仓库主要使用 Node 脚本执行真实 TypeScript 模块/运行时契约。先运行与改动相关的一组；完成行为改动后运行完整测试和类型检查。需要验证打包时再运行 build。

| 行为 | 现有回归入口 |
| --- | --- |
| AI 协议与模型 | [test-ai-protocol.mjs](../../../scripts/test-ai-protocol.mjs)、[test-models.mjs](../../../scripts/test-models.mjs) |
| Agent 取消、审批与失败状态 | [test-agent-execution.mjs](../../../scripts/test-agent-execution.mjs)、`test-ai-protocol.mjs`、`test-assistant-flows.mjs`；真实 App 使用 [test-agent-execution-browser.mjs](../../../scripts/test-agent-execution-browser.mjs)，合成模型响应验证停止、审批身份、下一轮发送和失败记录，不访问真实模型或用户数据 |
| 主题与还原 | [test-theme-tools.mjs](../../../scripts/test-theme-tools.mjs)、[test-appearance.mjs](../../../scripts/test-appearance.mjs) |
| 主机外壳与内容页 | [test-switch-theme-browser.mjs](../../../scripts/test-switch-theme-browser.mjs)、[test-switch-content-browser.mjs](../../../scripts/test-switch-content-browser.mjs)；隔离真实 App，检查亮暗、窄屏、AI 分栏与末项可达，内容夹具不访问外网 |
| Win98 桌面与窗口 | [test-win98-theme-browser.mjs](../../../scripts/test-win98-theme-browser.mjs)；真实开始菜单、桌面入口、窗口操作与输入状态保留，亮暗、窄屏、AI 分栏、内置内容与主题切换清理 |
| 其他内置主题内容页 | [audit-builtin-theme-content-browser.mjs](../../../scripts/audit-builtin-theme-content-browser.mjs)；纸张、iOS、掌机亮暗，末项不被浮动 Dock 遮挡，窄屏日历控件不出界并能实际添加日程；检查失败返回非零 |
| 应用目录与窗口 | [test-applications.mjs](../../../scripts/test-applications.mjs)、[test-application-tools.mjs](../../../scripts/test-application-tools.mjs)、[test-application-window.mjs](../../../scripts/test-application-window.mjs) |
| 运行时与容器 | [test-applet-runtime.mjs](../../../scripts/test-applet-runtime.mjs)、[test-app-runtime.mjs](../../../scripts/test-app-runtime.mjs) |
| Applet趋势图 | [test-applet-charts.mjs](../../../scripts/test-applet-charts.mjs)、[test-applet-chart-render.mjs](../../../scripts/test-applet-chart-render.mjs)；[隔离渲染浏览器脚本](../../../scripts/test-applet-charts-browser.mjs)与[真实应用浏览器脚本](../../../scripts/test-applet-chart-app-browser.mjs) |
| Applet数据管理 | [test-applet-data-table.mjs](../../../scripts/test-applet-data-table.mjs)、[test-applet-data-table-render.mjs](../../../scripts/test-applet-data-table-render.mjs)；[隔离渲染浏览器脚本](../../../scripts/test-applet-data-table-browser.mjs)与[真实应用浏览器脚本](../../../scripts/test-applet-data-table-app-browser.mjs) |
| 撤销与迁移 | [test-workspace-history.mjs](../../../scripts/test-workspace-history.mjs) |
| 可靠保存与备份 | [test-storage-durability.mjs](../../../scripts/test-storage-durability.mjs)、[test-storage-backup.mjs](../../../scripts/test-storage-backup.mjs)、[test-storage-sync-guard.mjs](../../../scripts/test-storage-sync-guard.mjs)；真实 IndexedDB 与故障提示 [test-storage-browser.mjs](../../../scripts/test-storage-browser.mjs) |
| 长期聊天 | [test-chat-history.mjs](../../../scripts/test-chat-history.mjs)、真实发送 [test-assistant-flows.mjs](../../../scripts/test-assistant-flows.mjs)；1000会话/10000轮与真实聊天交互 [test-chat-history-browser.mjs](../../../scripts/test-chat-history-browser.mjs) |
| AI 应用持久化 | [test-application-data.mjs](../../../scripts/test-application-data.mjs)；真实 App/Applet 大数据、生命周期及故障 [test-application-storage-browser.mjs](../../../scripts/test-application-storage-browser.mjs) |
| 快照协议与同步提供方 | [test-sync-protocol.mjs](../../../scripts/test-sync-protocol.mjs)、[test-sync-providers.mjs](../../../scripts/test-sync-providers.mjs)、[test-sync-records.mjs](../../../scripts/test-sync-records.mjs)；两客户端真实 IndexedDB 和设置入口 [test-sync-browser.mjs](../../../scripts/test-sync-browser.mjs) |
| 应用增量同步 | `test-application-sync-codec.mjs`、`test-application-sync-controller.mjs`、`test-application-sync-store.mjs`；真实双origin/HTTP/IndexedDB入口为 `serve-application-sync-qa.mjs` + `tests/application-sync-regressions.html` / `tests/sync-completeness.html`；完整范围使用 `test-incremental-adapters.mjs`、搜索输入使用 `test-search-config.mjs` |
| 特效预算与旧配置 | [test-effect-policy.mjs](../../../scripts/test-effect-policy.mjs)；真实渲染入口 [effect-policy-regressions.html](../../../tests/effect-policy-regressions.html) |
| 特效主题与失败恢复 | [test-effect-theme.mjs](../../../scripts/test-effect-theme.mjs)；真实渲染入口 [effect-theme-regressions.html](../../../tests/effect-theme-regressions.html) |
| 只读页面检查 | [test-page-inspector.mjs](../../../scripts/test-page-inspector.mjs)；真实 DOM 入口 [page-inspector-regressions.html](../../../tests/page-inspector-regressions.html) 与 [浏览器脚本](../../../scripts/test-page-inspector-browser.mjs) |
| 页面分区与容器布局 | [test-page-sections.mjs](../../../scripts/test-page-sections.mjs)、[test-page-section-tools.mjs](../../../scripts/test-page-section-tools.mjs)；真实 PageView 入口 [page-sections-regressions.html](../../../tests/page-sections-regressions.html) 与 [浏览器脚本](../../../scripts/test-page-sections-browser.mjs) |
| 长页与移动Dock可访问性 | [test-page-mobile-scroll-browser.mjs](../../../scripts/test-page-mobile-scroll-browser.mjs)，独立浏览器上下文加载真实App |
| 首页组合与布局草稿 | [test-homepage-draft.mjs](../../../scripts/test-homepage-draft.mjs)、[test-homepage-draft-tools.mjs](../../../scripts/test-homepage-draft-tools.mjs)；隔离预览入口 [homepage-draft-regressions.html](../../../tests/homepage-draft-regressions.html) 与 [浏览器脚本](../../../scripts/test-homepage-draft-browser.mjs) |
| 取数代理 | [proxy.test.mjs](../../../server/proxy.test.mjs) |
| 完整浏览器扩展 | `test-extension-platform.mjs`、`test-extension-background.mjs`、`test-extension-workspace.mjs`、`test-extension-close-guard.mjs`、`test-extension-sandbox.mjs`；真实 MV3 与 Web 回归为 `test-extension-browser.mjs`，隔离应用与 3D 分别为 `test-extension-sandbox-browser.mjs`、`test-extension-spline-browser.mjs`；重定向和通知为 `test-extension-network-browser.mjs`、`test-extension-notification-browser.mjs` |

新增测试优先观察公开工具/操作结果和运行时消息合同，不把提示词全文快照或实现字符串复述当作行为验证。纯文档或低影响措辞调整使用链接/一致性检查，不为它们制造脆弱测试。

## 浏览器验证

布局、主题、交互改动应实际检查相关形态：手机窄屏、桌面、半宽组件/分栏，以及明暗模式；动画改动增加减少动画和失败降级。使用 [tests/](../../../tests/) 中现有回归页面作为入口时，明确检查了哪些页面、尺寸和模式。

页面长内容与移动Dock改动必须包含真实App的FxLayers/ClickSpark包装，滚到底后核对最后操作项在Dock上方且可命中。单独PageView夹具不能覆盖祖先定高造成的底部留白失效，不能以overflow:auto或存在滚动条替代此检查。

当前应用内 AI 可用 `inspect_page` 获取当前挂载页的有限 DOM 测量，但没有截图反馈。真实几何检查仍不能判断 iframe/Canvas 内部、对比度或审美。配置正确、打开应用、脚本通过，都不能等同于视觉验收。未执行的检查如实写为未执行。

检查器回归需包含真实溢出→定位→修复→复查，以及合法局部滚动不误报、隐藏/未挂载页不可测和私密输入不进入报告。浏览器脚本通过调用方提供的 `DADA_PLAYWRIGHT_PATH` 使用测试工具，不增加生产依赖。

扩展验收使用独立临时配置加载构建包；联网成功可用合成服务与临时预授权副本，但不能把它表述为原生权限弹窗已确认。主入口延后导入 App 时，网页 PWA 预缓存也须覆盖启动所需静态依赖，并通过关闭在线页后新开离线页验证；不以已有页面刷新代替首次离线启动。

判断裁切时，`overflow:auto/scroll` 不是内容可访问的证明；滚动容器本身可能被外层 `hidden/clip` 截断。也不能把祖先容器的整个盒子当作组件范围，否则空白被裁会误归给可见组件。按根到组件的祖先链累计可访问区间，只有实际滚动范围和当前偏移可以扩展可达范围。保留“小组件完全可见不报错、长组件不可达要报告、局部滚动及滚动后不误报”的成对真实 DOM 回归。
