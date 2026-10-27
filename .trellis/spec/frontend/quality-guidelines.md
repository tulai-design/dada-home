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
| 主题与还原 | [test-theme-tools.mjs](../../../scripts/test-theme-tools.mjs)、[test-appearance.mjs](../../../scripts/test-appearance.mjs) |
| 应用目录与窗口 | [test-applications.mjs](../../../scripts/test-applications.mjs)、[test-application-tools.mjs](../../../scripts/test-application-tools.mjs)、[test-application-window.mjs](../../../scripts/test-application-window.mjs) |
| 运行时与容器 | [test-applet-runtime.mjs](../../../scripts/test-applet-runtime.mjs)、[test-app-runtime.mjs](../../../scripts/test-app-runtime.mjs) |
| 撤销与迁移 | [test-workspace-history.mjs](../../../scripts/test-workspace-history.mjs) |
| 取数代理 | [proxy.test.mjs](../../../server/proxy.test.mjs) |

新增测试优先观察公开工具/操作结果和运行时消息合同，不把提示词全文快照或实现字符串复述当作行为验证。纯文档或低影响措辞调整使用链接/一致性检查，不为它们制造脆弱测试。

## 浏览器验证

布局、主题、交互改动应实际检查相关形态：手机窄屏、桌面、半宽组件/分栏，以及明暗模式；动画改动增加减少动画和失败降级。使用 [tests/](../../../tests/) 中现有回归页面作为入口时，明确检查了哪些页面、尺寸和模式。

当前应用内 AI 没有截图或 DOM 测量反馈。配置正确、打开应用、脚本通过，都不能等同于视觉验收。未执行的检查如实写为未执行。
