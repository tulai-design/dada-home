# Research: 页面布局结构的数据与操作兼容边界

- Query: 如何用可选页面结构和组件 ID 引用表达 hero / section / split，同时保留扁平组件身份、操作、模板、导入、撤销和应用挂载？
- Scope: internal；只读源码调查，不修改实现或规范。
- Date: 2026-10-27

## Findings

### 推荐边界

继续以 `Page.components: ComponentInstance[]` 保存唯一组件实体；新增可选 `Page.sections` 只保存布局元数据和组件 ID 引用，不复制实例，不把 section 注册成组件，也不把布局挂到应用 canonical config。旧页无 sections 时走原渲染路径，无需转换已有组件。建议 `WORKSPACE_VERSION` 由5递增，migrate无sections时不补结构，避免旧快照产生行为变化。

最小候选结构（具体命名与阈值应在 design 冻结）：

```ts
type PageSection =
  | {id: string; kind: 'hero'; title?: string; description?: string; items: string[]; align?: 'start' | 'center'}
  | {id: string; kind: 'section'; title?: string; description?: string; items: string[]; columns?: 1 | 2 | 3}
  | {id: string; kind: 'split'; title?: string; description?: string; primary: string[]; secondary: string[]; ratio?: 'equal' | 'wide-primary'}
```

首版无需递归嵌套、任意CSS、任意数字断点、重复引用、独立组件副本或另一个持久化存储。手机收列/分栏堆叠是受控布局策略；结构标题是可选的真实内容，默认不生成宣传或说明文案。

### 关键事实与必须处理的入口

| 文件/行 | 当前行为 | 对本任务的影响 |
| --- | --- | --- |
| `src/lib/workspace.ts:18,77,224` | version=5；Page仅有扁平components；实例id存业务身份 | 新字段必须可选，组件实体和ID保持原处 |
| `src/lib/ops.ts:53` | locate遍历扁平components，按id/别名/类型查找 | 保留扁平实体后无需重写lookup |
| `src/lib/ops.ts:71` | replacePage执行Fx预算校验，再替换页面 | 新setPageSections可沿用纯函数+预算入口；不能让布局分组绕过同页特效统计 |
| `src/lib/ops.ts:262,298` | add/update组件维持已有实例id和config | 新组件未分组时必须继续可见；update不应重建sections或丢掉引用 |
| `src/lib/ops.ts:344,353` | remove、同页/跨页move直接编辑components | 删除与跨页移动必须清除源页引用；同页move的toIndex语义需明确（见下） |
| `src/lib/ops.ts:242,417` | 卸载内置addon、删除custom widget直接filter所有pages | 两条路径绕过replacePage，需要同步清理引用 |
| `src/lib/applications.ts:181` | 更新应用canonical记录时按id同步所有页面config | Page spread保留sections，引用身份天然有效；禁止复制安装记录 |
| `src/lib/applications.ts:212,218` | removeApplication与mountApplication直接filter挂载；mount同页也先删再append | 卸载/取消挂载/跨页挂载需清理旧引用；同页仅调span不应意外把应用移出原分区 |
| `src/lib/workspaceStore.ts:58` | migrate用白名单重新构造每个Page；过滤失效组件 | 不显式读sections会刷新即丢失；必须在过滤后的components上校验引用 |
| `src/lib/workspaceStore.ts:115` | 模板readTemplates调用migrate，再用checked.pages | 接好migrate即可复用；不能另造模板专用分区读取规则 |
| `src/lib/templates.ts:19` | snapshotOf深克隆整份pages | 自存模板天然保留sections，不需第二个快照字段 |
| `src/lib/templates.ts:100` | freshIds只给内置preset组件换id；应用id共享同一map | 新预设若带sections，引用必须用同一旧→新映射重写，否则结构悬空 |
| `src/lib/templates.ts:135` | 自存模板原id恢复；内置preset重发id；不覆盖未挂载应用库 | 保持这一区别，不应为用户自存模板也重发id |
| `src/lib/templates.ts:163` | isSynced比较pages的JSON | 新结构自动进入同步判断，不要单独维护计数 |
| `src/lib/workspaceStore.ts:274,289,300` | commit存原对象快照，undo/redo回换对象并persist | 只要纯函数不原地改sections/ids，现有历史可完整恢复；无需新history通道 |
| `src/lib/appearance.ts:87` | resetAppearance只移除wallpaper/layers/css/look，spread其余page字段 | sections属于布局，应保留；新增回归确认不要当装饰清除 |
| `src/lib/tools.ts:139` | get_workspace只描述components与layers，没有结构说明 | 必须披露sections、有效顺序、未分组项；AI才知道当前结构 |

### 写入与读取规则

建议 `pageSections.ts` 作为轻量纯领域模块，只依赖 type 与 WorkspaceError，避免 ops/applications/workspaceStore/templates互相新增循环依赖。实现一处严格输入校验与一处宽容读取/引用清理；允许复用底层shape校验，但新工具非法输入必须原子失败，不能静默丢掉组件后仍回报成功。

严格写入至少校验：数组与对象类型、有限枚举、分区ID唯一、标题长度、items字符串数组、引用存在于目标页、全页每个组件最多一次、primary/secondary不重叠、有界分区数量。传null或[]明确恢复旧扁平布局，只删布局元数据；不删组件、不卸载应用、不碰私有数据。省略该字段则不改变结构。

读取/导入允许丢弃坏分区、坏引用和重复引用，但保留原组件实体。过滤失效组件后清理悬空引用，至少确保未被引用的合法组件仍渲染在剩余区域；不能因为结构配置不完整让内容消失。空分区的保留/删除策略必须统一，不能每条CRUD各猜一套。

### 必须先决定的顺序合同

引入 `sections[].items` 后会有两套顺序：`Page.components` 原有顺序与section槽位顺序。当前 `move_component({toIndex})` 的承诺是“页内改顺序”（`ops.ts:352`）；若渲染只看refs，新操作可能返回成功而界面不动。

建议冻结以下一层结构顺序合同，避免多个相互独立的顺序源：

1. `sections`依次展开；hero/section按items，split固定primary→secondary；未分组组件按原components顺序追加。每次结构写入后，将`page.components`规整为这份唯一阅读顺序。只移动原实例对象，绝不重发ID或复制实例。
2. `set_page_sections`以输入refs安排分区与槽位，再同步components为展开顺序。未引用组件必须保留在尾部未分组区；清空sections保持现有components顺序。
3. 同页`move_component({toIndex})`：先从所有结构槽位移除移动ID，在扁平components移除该实例后夹限目标index；若目标index位置已有锚点组件，插入锚点所在section/slot的前面（锚点未分组则也进入未分组区）；若目标为末尾，则进入未分组区末尾。最后统一展开回写components。这样跨分区移动能真实改变视觉，边界明确采用“放在目标项之前”，没有返回成功而视觉不动。
4. 跨页move复用同一移除/插入helper：清源页refs；目标按toIndex锚点的槽位插入，省略索引追加未分组区。不要复制源页section ID到目标页。
5. 新增组件默认末尾未分组，显式index时同样按目标锚点槽位插入；删除组件只清该ID引用。空分区可保留元数据与标题，但不得偷偷造实例；统一空槽位渲染策略。
6. 应用同页仅调整span保留原槽位与索引；换页、取消挂载、卸载清旧refs。canonical安装记录保持原ID/config/数据命名空间。

上述算法应由一个纯pageSections模块提供“移除引用、按索引插入、展开规整”操作，ops与applications复用；读取迁移也规整到同一顺序。必须对默认末尾、分区边界、primary/secondary跨槽位、未分组区和same-page应用挂载写行为测试。首版不扩展递归结构、不加第二个排序字段。

### 发现与测试入口

- `list_component_types` 仅列真正可添加的组件（`tools.ts:109`附近）。布局结构不是组件，应新增小型 `list_page_layouts` / `set_page_sections` 类工具，或在布局写工具schema+说明提供可发现目录；不要假装 `add_component(type:'hero')` 能包已有组件。
- `get_workspace` 披露结构、引用、未分组项；`ai.ts`与`docs/design-system.md`说明先读组件ID再分组、按容器收列、DOM顺序等于阅读顺序。页面检查器现有`.widget[data-id]`可继续定位，避免section wrapper使用同类名。
- `scripts/test-effect-policy.mjs:1-42` 是最完整可复用loader：真实TS递归加载、缓存避免循环、隔离Fx React渲染和localStorage（Map），可同时运行ops/templates/migrate/commit/undo/redo。其141-153已有迁移与撤销例子。
- `scripts/test-applications.mjs:1-43` 注册真实app/applet数据schema并加载apps/ops/templates/migrate，适合应用ID与分区挂载兼容。
- `scripts/test-application-tools.mjs:1-55` 使用工具factory隔离协议，执行真实工具parse/execute并统计commit；适合验证非法sections请求0次提交、null清空一次提交、get_workspace准确披露。
- `scripts/test-workspace-history.mjs` 主要测试快捷键AST，不适合作为布局数据主测试入口；直接用真实store做结构commit→undo→redo更清晰。

建议最小行为矩阵：旧页migrate幂等；合法结构保存/刷新保留；错误shape/未知ref/重复ref原子失败；删除/跨页move/custom删除/addon卸载/应用取消挂载清理；新增组件仍可见；同页排序真实生效；自存模板保留ID+结构；preset重发ID同步refs；undo/redo恢复同一ID；外观reset保留结构；所有操作不改业务数据命名空间。

## Files found

- `src/lib/workspace.ts` — 类型与当前版本、实例身份、模板快照。
- `src/lib/ops.ts` — 页面与组件纯结构操作、特效预算入口。
- `src/lib/workspaceStore.ts` — 白名单迁移、模板读取、保存及撤销。
- `src/lib/templates.ts` — 快照、自存恢复与内置预设ID重发。
- `src/lib/applications.ts` — canonical应用记录与页面挂载操作。
- `src/lib/appearance.ts` — 外观还原保留布局的现有边界。
- `src/lib/tools.ts` — AI目录、当前布局读取与结构写入契约。
- `scripts/test-{effect-policy,applications,application-tools,workspace-history}.mjs` — 真实数据操作与工具回归loader。

## External references

无。本结论依据当前仓库源码；没有新增外部库、协议或依赖选择，因此不需要外部API资料。

## Related specs

- `.trellis/tasks/10-27-page-sections/prd.md`：旧扁平页面兼容、ID与应用挂载保留、目录发现、模板保存撤销。
- `.trellis/spec/frontend/state-management.md`：纯函数→commit；读取迁移必须覆盖导入与模板；私有数据分离。
- `.trellis/spec/frontend/type-safety.md`：unknown边界、非法写入不可假成功。
- `.trellis/spec/ai/tools-and-apps.md`：schema/parse/effect/风险/结果完整，工具与规范一致，应用身份保持。

## Caveats / Not Found

1. schema是实现建议，尚未冻结；slot/顺序/空section策略应由本任务design明确。
2. 未运行测试；本研究只读取既有测试与源码，不把可复用loader当作新行为已通过。
3. 不改既有`remove_page`是否删除应用私有数据等无关语义；布局任务仅复用现有身份边界。
4. 本轮未研究渲染CSS和实际尺寸断点；它们由并行渲染研究负责。
