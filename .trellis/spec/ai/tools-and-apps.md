# 工具与生成应用

## 工具操作链

[tools.ts](../../../src/lib/tools.ts) 使用 agent-core 的工具工厂描述参数与能力。新增工具同时考虑 schema、解析、`effect`、风险分类、执行结果与错误反馈；不能只加自然语言说明而不提供能力。

工作空间结构操作遵循 `tool schema/parse → ops（或对应应用/主题领域函数）→ commit/history`。业务数据工具使用各自领域存储，不强行塞进工作空间。`WorkspaceError` 可转为给模型的可解释失败，未知异常不能伪装成成功。

工具说明、[ai.ts](../../../src/lib/ai.ts) 主提示词、[skills.ts](../../../src/lib/skills.ts) 技能以及组件目录需要保持一致：不得推荐与设计规范相反的默认写法，不把配置检查说成视觉验证。涉及默认外观时读取 `get_appearance` 的统一资料，避免复制一套默认值。

## 页面分区工具

`list_page_layouts` 读取 [pageSections.ts](../../../src/lib/pageSections.ts) 的共享目录；`set_page_sections` 经严格参数校验与 `ops.setPageSections` 后一次提交。`sections` 必须显式提供，`null`/`[]` 才表示清除；缺字段、错误引用、重复组件或超额结构不能产生部分提交。`get_workspace` 披露分区、实际阅读顺序与未分组组件，新增/移动工具须说明索引与槽位关系。

分区是页面布局，不能伪装成组件类型，也不能复制组件或重建应用。模型应先读目录与当前 ID，保留已有内容；写入成功后可用 `inspect_page` 复查当前容器，不能据此声称所有尺寸或审美已通过。数据及渲染约束见[页面布局规范](../frontend/page-layouts.md)。

## 只读页面检查

首页改版的布局草稿使用独立 `homepageDraftTools.ts` 目录/生命周期工具，不能悄悄把所有正式写操作重定向到草稿。`apply_homepage_draft` 标为 highRisk，复用现有审批；用户点击预览中的应用是另一条显式入口。其他草稿写操作只改内存状态；严格校验draftId/expectedRevision和互斥参数，错误通过工具失败路径反馈。

`inspect_homepage_draft` 单独转发 `ToolHost.inspectHomepageDraft`，复用原检查等待和几何算法；报告携带草稿target/revision与layout-only未知项。AI必须确认自己测的是哪份草稿、哪个实际容器和主题，不能把静态占位的外框当成真实业务内容验收。主提示、前端技能、模板工具说明须区分首页草稿与整体模板覆盖。具体生命周期见[首页草稿规范](../frontend/homepage-drafts.md)。

`inspect_page` 通过 `ToolHost.inspectPage` 获取 App 显式注册的当前页面根节点；[pageInspectionHost.ts](../../../src/lib/pageInspectionHost.ts) 等待有界的两帧布局，再由 [pageInspector.ts](../../../src/lib/pageInspector.ts) 采样。`dispatchTool` 逐字段构造上下文，新增宿主能力必须显式转发，不能只扩展类型。工具返回 `JSON.stringify(report)`，避免对象被通用结果转换为 `[object Object]`。

报告带 `schemaVersion`、页面与实际容器尺寸、主题、减少动画、revision、时间与 settled 状态；问题有稳定 id、组件 data-id/type、限定 selector、测量数值与修正方向。检查不导航，不写 workspace/commit/history。已知但未挂载页面返回 `not-mounted`，不存在页面返回 `unknown-page`；工作空间对象与已提交 DOM 不一致时返回 `stale-render`，不能用配置推测渲染结果。取消必须释放 rAF、定时器和监听，等待超时不得无限阻塞工具。

只读取允许的几何与宿主运行标记，不读取 text/value/HTML、任意属性、iframe 文档、Canvas 像素或聊天区域。iframe/Canvas 内部、对比度和审美都明确列为 unknown。无宿主或未测量环境不编造明暗与减少动画值。组件内滚动、表格横滚、隐藏 applet runner 不报错；`ok` 代表采样完成，不能解释成全部视觉通过。背景 portal 不在本轮页面根节点采样范围，effects 只说明已采到的宿主标记。

## Applet 与 App

普通交互工具优先 Applet。其 UI 是 [catalog.ts](../../../src/lib/applet/catalog.ts) 里的积木树，经 [render.tsx](../../../src/lib/applet/render.tsx) 渲染为宿主控件；新增积木必须接通目录、渲染和可验证的属性行为。安装 npm 包不等于 AI 能使用对应 React 组件。

折线/趋势使用LineChart，简单柱状仍用Bars。图表数据上限和缺失值规则由目录及lineChartData.ts统一；AI先排序/聚合，不能把缺失补0或超量静默截断。示例源码应与运行时指南同源并实际执行验证；不能只在测试页画图就声称AI会用。具体约束见[趋势图规范](../frontend/applet-charts.md)。

需要查找、排序、分页和详情的记录工具使用DataTable，简单展示继续用Table。行ID稳定，列定义只传JSON；受控onChange是局部patch，合并到临时视图state，不能替换或保存成业务记录。窄容器仍可读取完整详情，500行渲染限制与每实例8 MiB UTF-8 JSON保存预算分别生效。具体约束见[数据管理规范](../frontend/applet-data-table.md)。

Applet 计算逻辑可按现有沙盒策略导入远程 ESM 库，见 [runner.ts](../../../src/lib/applet/runner.ts)；这不授予任意 React/DOM UI 能力。UI 保持目录白名单，业务网络访问经过宿主授权。

HTML App 用于游戏、Canvas/WebGL 或确需完全自定义视觉的场景。其主题、消息、存储桥与隔离规则由 [widgets/app.tsx](../../../src/widgets/app.tsx) 及运行时支持，不得通过增加宿主权限绕开沙盒。

共享要求：实际容器宽度布局，分别处理 `widget/modal/drawer/page/status`；设置字段与业务状态分离；保留应用 ID 和数据命名空间；状态栏紧凑视图需显式实现；关闭/切换不能虚构后台常驻。生命周期细节见 [Hooks 规范](../frontend/hook-guidelines.md) 和设计规范。

## 协议边界

本仓负责 [aiProtocol.ts](../../../src/lib/aiProtocol.ts)、模型/设置 UI、请求参数和产品工具编排。通用传输、流式解码和工具基础合同消费 `@tulai-design/agent-core` / `agent-providers`；源码在独立 ai-platform 仓库。

遇到供应商兼容问题先确定协议和请求/响应边界。需要修改核心包时按跨仓任务处理、验证发布产物后再升级本仓依赖，不能在搭搭复制另一套通用解析器或直接改 node_modules。
