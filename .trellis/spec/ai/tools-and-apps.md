# 工具与生成应用

## 工具操作链

[tools.ts](../../../src/lib/tools.ts) 使用 agent-core 的工具工厂描述参数与能力。新增工具同时考虑 schema、解析、`effect`、风险分类、执行结果与错误反馈；不能只加自然语言说明而不提供能力。

工作空间结构操作遵循 `tool schema/parse → ops（或对应应用/主题领域函数）→ commit/history`。业务数据工具使用各自领域存储，不强行塞进工作空间。`WorkspaceError` 可转为给模型的可解释失败，未知异常不能伪装成成功。

工具说明、[ai.ts](../../../src/lib/ai.ts) 主提示词、[skills.ts](../../../src/lib/skills.ts) 技能以及组件目录需要保持一致：不得推荐与设计规范相反的默认写法，不把配置检查说成视觉验证。涉及默认外观时读取 `get_appearance` 的统一资料，避免复制一套默认值。

## Applet 与 App

普通交互工具优先 Applet。其 UI 是 [catalog.ts](../../../src/lib/applet/catalog.ts) 里的积木树，经 [render.tsx](../../../src/lib/applet/render.tsx) 渲染为宿主控件；新增积木必须接通目录、渲染和可验证的属性行为。安装 npm 包不等于 AI 能使用对应 React 组件。

Applet 计算逻辑可按现有沙盒策略导入远程 ESM 库，见 [runner.ts](../../../src/lib/applet/runner.ts)；这不授予任意 React/DOM UI 能力。UI 保持目录白名单，业务网络访问经过宿主授权。

HTML App 用于游戏、Canvas/WebGL 或确需完全自定义视觉的场景。其主题、消息、存储桥与隔离规则由 [widgets/app.tsx](../../../src/widgets/app.tsx) 及运行时支持，不得通过增加宿主权限绕开沙盒。

共享要求：实际容器宽度布局，分别处理 `widget/modal/drawer/page/status`；设置字段与业务状态分离；保留应用 ID 和数据命名空间；状态栏紧凑视图需显式实现；关闭/切换不能虚构后台常驻。生命周期细节见 [Hooks 规范](../frontend/hook-guidelines.md) 和设计规范。

## 协议边界

本仓负责 [aiProtocol.ts](../../../src/lib/aiProtocol.ts)、模型/设置 UI、请求参数和产品工具编排。通用传输、流式解码和工具基础合同消费 `@tulai-design/agent-core` / `agent-providers`；源码在独立 ai-platform 仓库。

遇到供应商兼容问题先确定协议和请求/响应边界。需要修改核心包时按跨仓任务处理、验证发布产物后再升级本仓依赖，不能在搭搭复制另一套通用解析器或直接改 node_modules。
