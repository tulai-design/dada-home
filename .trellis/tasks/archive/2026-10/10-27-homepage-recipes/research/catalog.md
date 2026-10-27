# Research: 首页组合目录与 AI 草稿操作

- Query: minimal / productivity / editorial / showcase 如何确定性组织既有首页组件，同时保留 ID、应用安装、主题与特效预算；AI 草稿工具最小合同是什么？
- Scope: internal
- Date: 2026-10-27

## Findings

### 当前事实与文件

| 文件 | 用途与证据 |
| --- | --- |
| `src/lib/presets.ts:31` | 现有四个模板预设是整套工作空间；desk/reader/night 会安装 addon，night 会创建主题，不符合本轮保留当前首页的组合语义。 |
| `src/lib/templates.ts:20` | snapshotOf 复制设计快照，包含页面、布局、安装与应用目录，默认还带主题；不含业务数据。 |
| `src/lib/templates.ts:100`、`:139` | 内置模板套用会 freshIds，并整体替换 pages/statusbar/layout/widgets/addons；不能把首页组合实现为 applyTemplate(preset)。 |
| `src/lib/ops.ts:35`、`:72`、`:78` | 纯 workspace→workspace 操作已明确可用于预览；setPageSections 统一校验规范化和特效预算。 |
| `src/lib/pageSections.ts:4`、`:78` | 目录公开三类结构、最多8分区/1hero及720px容器规则；sections 是 ID 引用，未引用组件保留于尾部。 |
| `src/lib/ops.ts:483` | 默认工作空间包含 clock/search/links，addons 为空；不能靠默认效率方案假定 todos/note/agenda 已安装。 |
| `src/lib/market.ts:68`、`:100` | 书桌包含 todos/note，日历包含 calendar/agenda/countdown，安装会创建对应页面。 |
| `src/lib/workspace.ts:21` | 明确内置类型集合；app/applet/custom 的用途不能仅凭类型判断为待办、日程等。 |
| `src/fx/policy.ts:19`、`:71` | 图层与 fx 内容块共用预算；旧超限页只能不增加超限维度，读取/纯重排可保留。 |
| `src/lib/tools.ts:192`、`:245` | inspect_page 和 set_page_sections 的公开接口、上下文与提交语义。 |
| `src/lib/tools.ts:644`、`:698` | 现有 list_templates 的“换布局先看模板”描述需让位给本轮首页草稿场景；apply_template 是高危整体覆盖，不是草稿应用。 |
| `src/lib/ai.ts:37`、`:55`、`:74`；`src/lib/skills.ts:40` | 首页编排指引目前只推荐正式分区写入；必须补上草稿流，否则模型仍直接修改正式页面。 |
| `src/lib/pageInspectionHost.ts:31` | 当前检查桥只接受正式 workspace 与挂载 root，且通过对象身份判断 stale-render，不能直接拿其正式状态检查草稿 root。 |

### 推荐的确定性组合策略（设计建议，不是当前行为）

组合是“如何安排现有内容”的纯函数，不是复制模板、重建首页或安装功能。只读 home.components，所有成员出现且仅出现一次，各分类组内部稳定保留当前顺序。不要从其他页面搬内容；不要按标题猜测自编应用的用途。允许可选 focusId 显式指定首页已有组件作为焦点；不合法 ID 原子拒绝。没有足够内容时生成少量有效分区，而非补假数据或装饰标题。

| 组合 | 确定性结构 | 默认三组件的可观察结果 | 空内容处理 |
| --- | --- | --- | --- |
| minimal 极简启动页 | clock/search 组成居中 hero；links/bookmarks 为单列快捷区；剩余原内容单列排后。没有 clock/search 时用显式focusId或首组件作hero。 | clock/search 主视觉，links独立尾部。 | 不删除其他内容来伪装“极简”；空首页保持原空态。 |
| productivity 效率工作台 | search 优先作hero；todos/note/pomodoro及明确选为焦点的组件放主栏；agenda/calendar/countdown/weather/clock 放辅栏；links/bookmarks作为快捷区；未知 app/applet/custom 保留在主工作区或尾部（固定规则，目录披露）。 | search 置前，clock与links以主次栏组织，可采用links主、clock辅；不假装已有待办。 | 缺任务或日程时省略对应组，不额外安装desk/calendar。 |
| editorial 编辑式内容页 | 内容焦点优先显式focusId，其次 feeds/note/quote/custom 的首项，最后clock；剩余阅读内容为单列，search/links/bookmarks及日程类为辅助区，可使用2:1 split。 | clock作为焦点，search/links保持单列阅读顺序，区别于极简居中主视觉。 | 不给便签写示例文章；未知App不猜正文结构。 |
| showcase 视觉展示页 | 显式focusId优先，其次现有fx，再次custom/app/applet，最后clock/首组件作hero；search和快捷入口为紧凑区；其他内容两列。 | clock独立满行焦点，search/links下方两列；窄容器仍单列。 | 没有现有特效时不自动新增WebGL或图层；披露这是布局方案，素材另按用户要求添加。 |

表中的默认顺序/候选分类最终由主任务 design 冻结；实现应有包含所有原组件的唯一性回归，不在三个调用点维护三套分类。分类仅决定摆放，不决定是否可在预览运行。

每个 recipe 目录条目建议提供：id/name、用途、焦点与顺序规则、适合已有内容、empty行为、compact行为、theme行为、effect行为。不要把“deep theme automatically perfect”作为承诺；沿用当前主题 token 与当前组件配色，预览提供双模式切换，不写正式主题设置。

### 最小写入范围与身份原则

- 首版组合只改首页 sections 和由其规范化产生的 components 顺序。可允许受控分区标题/columns/ratio/align 修正；保留每个组件 config/span/look、home.layers/wallpaper/css、全局theme/layout及其余页面。
- 不调用 defaultWorkspace、installAddon、instanceId、applyTemplate；不新建应用，不复制组件，不操作业务数据。若要新增内容，应是另外一项显式需求，不能让“效率方案”隐式安装。
- 调整草稿复用 ops.setPageSections 对 draft.workspace 的纯操作，只在 apply 时调用一次真实 commit；取消不碰 commit，正式模板库也不新增记录。
- 快照可复用 snapshotOf 的设计复制边界，但应用首页草稿应只替换最新 workspace.pages 中的 home，不能用整份快照覆盖当前其他页面、应用设置或模板库。若当前home在草稿建立后变化，必须明确冲突，不能最后写者覆盖；跨页挂载/应用删除也要纳入相关冲突检测。
- 外观方案和新特效不是这四种组合的必要字段。纯重排继续经过 assertFxBudgetChange(previousHome,nextHome)，不绕过旧超限规则；existing layers 和 fx config 原样保留即可不增加预算。

### AI 最少工具建议

建议新建明确草稿工具，不偷偷让全部现有 write 工具重定向到草稿：现有工具里既有结构又有私有数据/网络操作，隐式切换含义容易污染正式数据。

1. `list_homepage_recipes`：只读四类目录、字段、当前适配/限制；告诉模型不是 apply_template。
2. `create_homepage_draft({recipeId, focusId?})`：从当前home创建唯一草稿并显示预览，返回draftId、revision、组件ID、拟更改结构和未覆盖范围。已有草稿不静默丢弃，可报已有ID或要求显式重建。
3. `get_homepage_draft({draftId?})`：返回草稿sections、有效顺序、组件摘要、基础版本、冲突状态及最近检查是否仍匹配revision；明确不读业务数据。
4. `update_homepage_draft({draftId, expectedRevision?, sections})`：只修改草稿，沿用分区严格校验；缺sections不清空，null/[]明确清除。不支持 arbitrary workspace patch。
5. `apply_homepage_draft({draftId, expectedRevision})`：确认是当前可见/最新草稿，检测正式状态冲突，校验后一次commit，返回可撤销。风险声明与审批由产品既有权限策略决定，但不能借此绕过显式apply。
6. `discard_homepage_draft({draftId})`：仅删除草稿/关闭预览，不修改历史和业务数据。

检查不必再增加一个几何算法。可扩展已有 inspect_page 请求为显式 `{target:'draft', draftId}`（默认仍正式页），或新增 inspect_homepage_draft 工具但内部复用 inspectPageElement。报告必须包含 target/draftId/revision、实际预览宽度与主题、placeholder组件列表/unknown。既有 formal host 的对象一致性检查不能用于draft，需要单独挂载记录或通用target读口。更新 ToolHost 后必须同步 ai.ts dispatchTool:300 的逐字段转发。

推荐 AI 顺序：get_workspace → list_homepage_recipes → create_homepage_draft → inspect指定草稿 → update草稿 → inspect同revision → 向用户概括测量范围 → 显式apply。用户取消直接discard。正式 set_page_sections、apply_template 等仍修改正式状态，提示词应明确预览过程不可用它们代替update草稿。最近检查只证明该尺寸该模式的几何，不把一次采样写成双主题全尺寸通过。

### 预览隔离与可检查边界

PageView:82直接调用真实业务组件；只传空updateConfig/禁用鼠标并不隔离：note.tsx:12/21直接读写useComponentData，组件数据按实例ID存储（componentData.ts:7）；Applet:70使用同instanceId私有命名空间，并在运行时提供fetch/open/ask等操作（applet.tsx:24）。因此同ID第二次挂载真实组件可触发网络、计时、初始化或写入，取消也无法撤回。

需要预览专用只读表现或安全白名单，App/Applet/带业务效果的组件可用有类型/名称和固定合理占位的静态表示，同时保留真实布局外框和section规则。检查报告必须标记这些为占位未知，不宣称内部布局或完整视觉已检查。纯clock也可能读取天气（核对实现后选择白名单），links会加载favicon/导航；不能仅按“看起来静态”判断安全。此点由preview研究主导最终实现。

## External References

本次仅研究本仓已安装实现与已有产品约定，没有引入新库或依赖外部API事实，因此未开展外部检索。当前工作空间版本为6；现有依赖使用仓库安装版本，不推荐升级。

## Related Specs

- `.trellis/tasks/10-27-homepage-recipes/prd.md`
- `.trellis/spec/ai/tools-and-apps.md`
- `.trellis/spec/frontend/page-layouts.md`
- `docs/design-system.md`
- `docs/specs/runtime-contract.md`

## Caveats / Not Found

- 未发现已有草稿状态、草稿工具或安全只读预览；现有模板套用不满足本轮身份和范围约束。
- “四类组合满足所有人”不能自动验收。结构算法必须有差异并适应内容不足，但不应为了展示差异偷偷新增业务内容、装饰或安装项。
- 若任务希望草稿同时编辑任意组件源码、全局主题或业务数据，范围明显超出上述最小设计；应在design中另定隔离/冲突合同，不能由通用patch隐式开启。
