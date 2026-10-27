# 页面检查器设计

基线：a8a4775。用户已授权继续推进 AI 页面检查能力；本任务完成后按用户约定提交。

## 行为缺口与边界

现在 AI 能读工作空间配置，却不能知道当前页面实际容器尺寸、可见状态、组件外框是否溢出，也不能区分 DOM 可测和无法判断。检查器只读取 App 显式注册的当前 `.page` 根节点；不从 tools.ts 查询全局 DOM，不读取聊天、表单值、iframe 内部、Canvas 像素或截图。

## 跨层链路

App 注册当前真实页面根节点和 pageId → ToolHost.inspectPage 等待有界的两帧布局稳定 → pageInspector.inspectPageElement 读取宿主布局 → tools.inspect_page 显式 JSON 返回 → AI 可在同一轮修改后再次调用。工作空间写入、撤销和 history 不经过检查器。

## 报告合同

`schemaVersion: "1"`；状态为 `ok`、`unknown` 或 `unavailable`。报告含 page id/name/visible、viewport/content 宽高、theme、reducedMotion、revision、measuredAt、settled、issues、unknown、effects。content 使用真实 scrollWidth/scrollHeight；没有测量环境时 theme/reducedMotion 为 null。issues 使用稳定 code/id，带 severity、组件 data-id/type、限定 selector、数值 measurement 和 fix。unknown 明确说明 iframe/canvas 内部、对比度、审美、隐藏或无布局盒等无法测量内容。

确定问题只包括：页面/组件无布局盒、可见组件外框横向越界、页面级横向滚动、组件外框超出没有合法滚动路径的宿主页面。合法 `.ap-table-wrap`、组件内滚动、隐藏 applet runner、iframe/canvas 内部不作为错误；后两者进入 unknown。

## 预期文件

- `src/lib/pageInspector.ts`：无 DOM 全局副作用的纯采样器。
- `src/lib/pageInspectionHost.ts`：宿主等待、取消、未挂载和陈旧渲染边界。
- `src/lib/tools.ts`、`src/lib/ai.ts`：ToolHost 可选检查回调、公开只读工具和上下文转发。
- `src/App.tsx`：注册真实 `.page` 根节点，使用当前视图/页面 refs，等待布局稳定。
- `tests/page-inspector-regressions.*`：真实 DOM 溢出、修复、裁切边界和 unknown。
- `scripts/test-page-inspector.mjs`：公开工具边界，验证 JSON、未知页、未挂载、host 缺失和不提交历史。
- `scripts/test-page-inspector-browser.mjs`：复用外部浏览器工具，在320/375/768/1280px与明暗主题执行真实夹具。
- `docs/design-system.md` 与 `.trellis/spec/ai/tools-and-apps.md`：记录检查事实与未知边界。

## 范围外

不做截图上传、多模态分析、跨源 DOM 抓取、自动对比度、完整无障碍、FPS/耗电、审美评分或自编 App/Applet 内部源码分析。
