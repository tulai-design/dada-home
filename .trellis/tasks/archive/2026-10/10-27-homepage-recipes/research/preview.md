# Research: 首页草稿预览与检查隔离

- Query: 如何在现有 App、PageView、特效和 AI 分栏中加入可见草稿预览，且取消不污染正式页面、业务数据或应用运行实例？
- Scope: internal
- Date: 2026-10-27

## Findings

### 涉及文件

| 文件 | 作用 |
| --- | --- |
| `src/App.tsx` | 正式页面、主题、背景 portal、AI 分栏和检查根节点注册 |
| `src/components/PageView.tsx` | 页面实例到 widget DOM 的唯一布局和组件分发入口 |
| `src/lib/pageSectionLayout.ts` | hero/section/split 的扁平布局计划 |
| `src/page-sections.css` | 基于实际内容容器的分区布局与单列重排 |
| `src/components/AssistantSplitPane.tsx`、`src/assistant-split.css` | 页面与聊天固定父节点、实际容器测量和双栏宽度 |
| `src/lib/pageInspectionHost.ts`、`src/lib/pageInspector.ts` | 当前挂载页的有限几何测量、陈旧渲染检查 |
| `src/fx/Fx.tsx`、`src/fx/useFxTheme.ts` | 实际特效运行、容器策略及根节点主题读取 |
| `src/lib/componentData.ts`、`src/widgets/{note,applet,app,search,custom,feeds,clock}.tsx` | 证明 no-op host 不能隔离组件的直接存储/网络行为 |
| `src/components/TemplateSettings.tsx` | 已有模板 UI 只有直接套用确认，没有预览事务 |

### 现有宿主的接入点

- `App.tsx:233–251` 用 `currentPage` 和 `useLayoutEffect` 注册正式页面 root、workspace 对象与 revision。`createPageInspectionHost` 的对象身份比较要求 DOM 确实属于最新提交，而非刚算出的配置。
- `App.tsx:723–765` 是正式页面节点；`PageView` 被 `FxLayers` 包住，背景另 portal 到 `App.tsx:653` 的全窗口 `.fx-root`。草稿不得复用这个 portal，否则在预览时会更改正式页面和外壳背景。
- `App.tsx:680–714` 的 `AssistantSplitPane` 已经允许左侧内容替换且右侧聊天保持挂载。`AssistantSplitPane.tsx:82–104` 是稳定父级，不需要再为草稿创建第三种聊天模式。
- `PageView.tsx:43–66` 与 `pageSectionLayout.ts:9–49` 是既有布局合同。预览应共用这一层，不能另抄一套 grid 计算。
- `PageView.tsx:79–93` 直接执行各 definition.component/custom/application；这里需要明确的受限预览内容入口，不能假定宿主 callback 改成 no-op 就安全。

### 直接重复渲染真实组件会发生什么

| 组件/模块 | 证据 | 草稿中直接挂载的后果 |
| --- | --- | --- |
| 便签/待办 | `note.tsx:12–21`、`todos.tsx:18` | 按同一实例 ID 读写真实 `useComponentData`；预览输入即修改业务数据 |
| Applet | `applet.tsx:70–121` | ready 读 `applet.<id>`，save 直接 `writeStored`；初始逻辑可能定时/取数/持久化，no-op host 无法阻止 |
| HTML App | `app.tsx:244–253`、`291–320` | iframe SDK 处理真实 fetch、存储和打开网址；另开副本破坏单应用运行语义 |
| 搜索框 | `search.tsx:51,91–104` | 引擎切换直接改全局 searchMode，另有轮换定时器与交互焦点逻辑 |
| 时钟天气 | `clock.tsx:19–22,47,65` | 默认 showWeather=true，挂载会真实取数；即使禁用主按钮也不能阻止 |
| 订阅/天气/自定义 HTTP | `feeds.tsx:33–40`、`weather.tsx:22,60`、`custom.tsx:36–62` | 自动网络请求和共享资源缓存；自定义 art 在调用 useWidgetData 后才判断 layout，不能仅按 art 认为不取数 |
| 私有数据模块 | `componentData.ts:99–115,118–132` | 读取也填内存 cache，写入会调度 IndexedDB/localStorage；没有预览命名空间或只读 context |

结论：本轮最小可靠方案应是**明确标注范围的布局预览**，保留真实布局和受控视觉，业务组件与任意 App/Applet 不启动副本。不建议为了草稿给全站存储与每个组件增加分叉，或复制所有应用数据制造第二个运行空间。

### 建议的最小 UI/渲染方案（推断，交由主会话冻结）

1. 在 `.canvas` 左侧内容区加入 `HomepageDraftPreview`，上方只有组合名称、必要状态及“检查 / 应用 / 取消”等操作。利用已有 AI 分栏继续聊天修改草稿；手机沿用可见面板和正常纵向滚动，不新增浏览器全屏模式。
2. 草稿渲染走 `PageView`，增加显式可选预览渲染器或受限 `preview` 分支。保留稳定 `.widget[data-id][data-type]`、span/look、section 计算和标题。只在内容分发处选 `DraftWidgetPreview`，默认正式分支保持原行为。
3. 预览内容须列清真实/替代：时钟用冻结时刻且不含天气请求；搜索框为不可提交的静态显示；常用网站保留配置文本与字号布局，禁链接且不用外部 favicon；便签/待办等可用**创建草稿时只读捕获**的业务快照或明确空态，不提供编辑行为；Applet/App/外部源组件显示名称和范围明确的占位，不调用原组件。静态 custom 可复用已有解释器，但确认 source 被限制为 static，外链图片/SVG 也需明确预览资源策略。
4. 预览可以真正渲染受控的本地 FX（无业务持久化），背景限制在预览容器内，使用 `FxLayers` 的本地背景而非全局 portal；Spline/远程资源应静态替代并列入 unknown。若不准备细分 FX，本轮可用既有静态语义替代，但不能宣称动画或最终外观已实测。
5. 原正式页可保持挂载但隐藏/inert，避免打开/取消草稿销毁正在输入的临时状态；预览内容无业务运行，故不产生第二份 App。正式隐藏页检查应返回不可测，不能偷测草稿代表正式页。若选择暂时卸载正式页，需在 design 里承认并测未持久状态边界，不能声称取消完全无影响。
6. 预览容器使用当前主题即可满足组合天然适配双主题，浏览器分别在 light/dark 验证。预览内的明暗切换若修改正式 theme 或 document 根，会违反“预览不污染正式状态”；此类控件不能直接调用正式 setMode。

### 主题与样式隔离中的两个关键风险

**局部 data-theme 不能完整实现独立主题预览。** `App.tsx:270–280` 把 activeTheme 与 theme.mode 写到 documentElement；`theme.css:11–44` 基础 token 与不少 dark 选择器都是 `:root[data-theme='dark']`；`Fx.tsx:14–23` 与 `useFxTheme.ts:25–35` 直接读取 documentElement。给草稿 wrapper 设 data-theme 或只包 Lobe ConfigProvider 不会改变所有 FX/宿主 dark 样式。若本轮要双主题并排/局部切换，必须引入真正 theme context 或隔离 preview document，成本明显高于跟随主题并分别测试。

**同 ID 的两份 PageView 会被现有 look.css 串改。** `PageView.tsx:114` 对组件样式输出全局 `[data-id="id"]{...}`。正式页与草稿保留相同 ID 后，草稿改 look.css 会影响正式 DOM，反向同样发生。应在同文件把组件 CSS 限定到已有唯一 `.page-grid[data-page-style="${pageStyleId}"]` 下的直接 widget；页面级 css 已有这个 scope（`PageView.tsx:67`）。无论最终选择独立预览或同时挂载，都应验证两个相同 data-id 的页面互不影响。

### 检查桥建议

- 保持 `inspect_page` 的“正式当前页面”含义；新增显式草稿检查工具/host，或在 schema 明确 target。不要悄悄把默认 inspect_page 改成草稿却沿用正式 revision。
- `inspectPageElement(root, metadata)` 本身已经是可复用纯 DOM 边界（`pageInspector.ts:58`）；草稿 host 应有独立 `{draftId, revision, root, renderedDraft}`，等有界两帧并比较捕获的草稿对象/修订，变化时报告 stale-render。
- 返回包封包含 target=draft、draftId、draftRevision、实际容器、跟随的主题及 `previewed/placeholder` 组件范围；unknown 显式加“业务组件替代视图/未执行应用/未验证交互”。`status=ok` 只说明本次采样完成。
- 若正式页和草稿同时存在，其页面 ID 可同为 home，但 `pageInspector.ts:103–110` 构建 selector 目前只用 data-page-id，文本定位可能歧义。检查草稿应让 selector 前缀含独立 data-draft-id，或采样根使用单独预览标识并在报告保留 sourcePageId。不能为了好看改组件业务 ID。
- `ai.ts:308` 逐字段把 host 能力转发给工具；新增 inspection/show-preview host 必须在 dispatchTool 显式转发，已有单测对此类遗漏已有先例。

### 建议的浏览器验证入口

沿用 `tests/page-sections-regressions.{html,tsx}` 的真实 PageView fixture 方式，新建首页草稿 fixture，公开按钮/工具作为入口；外部 Playwright 路径通过 DADA_PLAYWRIGHT_PATH 注入。

必须观察的行为：

- 四方向 × 320/375/768/桌面 × 双主题；桌面真实窄分栏；长标题和空数据；320px 操作栏不横溢。
- 正式页含输入值与一次 App/Applet 初始化计数，打开/更新/取消草稿后同 DOM/状态保留；草稿不创建业务 iframe，不发送业务取数，不写真实 storage/data。
- 两个同实例 ID 视图，草稿 look.css 不影响正式页；预览背景不进入全窗口 fx-root。
- 生成→检查→故意溢出或不适配修正→检查→应用→撤销；检查报告草稿 revision、root 和当前主题准确。
- 未显示草稿时检查 unavailable，更新尚未提交时 stale-render，取消进行中的检查释放资源；正式 inspect_page 不误采草稿。
- 草稿存在期间右侧聊天继续可用，切换窄宽不会触发二次初始化；键盘能找到应用/取消，Tab 不进入隐藏正式页。

## Related Specs

- `.trellis/spec/frontend/component-guidelines.md`：实际容器、语义 token、宿主控件。
- `.trellis/spec/frontend/hook-guidelines.md`：稳定挂载、清理资源、应用 init 与 view 职责。
- `.trellis/spec/frontend/state-management.md`：工作空间与业务数据分离。
- `.trellis/spec/frontend/page-layouts.md`：统一布局与稳定 keyed 父节点。
- `.trellis/spec/ai/tools-and-apps.md`：检查器的只读隐私边界、App 单实例和工具宿主转发。
- 当前任务 PRD：草稿隔离、整体应用/取消/撤销、真实检查范围。

## External References

无。本报告仅依据当前仓库源码和已确认规范；不引入新库，不对外部 API 作判断。

## Caveats / Not Found

- 未找到已有首页草稿 store、preview renderer 或只读组件宿主协议；TemplateSettings 只有套用确认。
- 本报告是研究与建议，未修改产品代码、未执行浏览器矩阵；方案需由主会话在 design 中冻结。
- “静态/替代预览”能验证布局/文字/受控视觉，不能证明任意应用真实高度、实时业务内容、交互或动态加载后的结果；工具和 UI 必须披露。
- 全站独立主题 sandbox、全业务存储 fork 或任意 App 安全交互预览不属于最小实现，除非明确扩展该子任务。
