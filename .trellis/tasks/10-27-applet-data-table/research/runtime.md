# Research: Applet 受控数据管理运行时

- Query: 新数据管理积木怎样接入现有公开目录、事件桥、状态与持久化，并保留简单Table？
- Scope: internal；源码与本地规范核对，协议建议待主会话冻结
- Date: 2026-10-28

## Findings

### 已有链路与兼容边界

- `src/lib/applet/catalog.ts:37` 只公开简单`Table({columns:string[],rows:(string|number)[][]})`。`render.tsx:228–253`显示最多12列/200行，宽度按列数×96设置，使用局部横滚；没有筛选、排序、分页、选择或详情。保留其截断与显示语义，不借新积木改旧接口。
- `runner.ts:58–64`按`COMPONENT_NAMES`自动构造`ui.Xxx`函数；新增组件需加catalog项和`UiTree`分支，不需要另设宿主工具。
- **`runner.ts:67–76`只转换积木顶层属性中的函数**：转为`{$fn:number}`并留在iframe handlers内。columns里的formatter/render函数不会递归转换，最终postMessage会失败；列定义必须纯数据，不复制第三方React表格API。
- `render.tsx:39–40,256–260`的`UiNode/Fire`已经允许`unknown`事件payload；`widgets/applet.tsx:133`把它装入`{k:'event',fn,payload}`，`runner.ts:142–144`执行沙盒handler。可克隆的对象/数组完全可用，不需增加消息种类或让宿主写业务状态。
- `UiTree`以`child.p.key`（否则位置）保持React子树身份。示例应固定DataTable积木位置/key，按稳定业务ID选择行，不能用排序/分页后的行序号作为身份。

### 状态、生命周期和限制

- `runner.ts:79–93`仅持久化`persist`列出的顶层state键；字符串变化才发save。`130–140`先恢复persist再init。建议记录型示例`persist:['records','nextId']`，而query/sort/page/selectedId及编辑输入放独立临时state；刷新保留记录但恢复默认筛选/页码/选择。
- `widgets/applet.tsx:70,105–108`保存到`applet.<instance.id>`，现有业务存储限100KB；表格行数上限不是持久化容量保证。示例必须限制记录数量/文本长度，使其自己的最大保存体积低于100KB，或明确拒绝超量输入，不能声称500行任意文本必定可保存。
- `widgets/applet.tsx:72–76,123–131`的srcdoc只依赖源码/run，主题、设置和宽度热更新；新表格不能把这些值加进iframe身份。`runner.ts:148–161`更新布局不会重启init。
- `render.tsx:70–88`已有`useEcho`处理输入跨iframe回声，适用于原始值（Object.is比较）；不能直接给整个view对象套它然后指望跨postMessage的结构克隆引用相等。若需复用，应明确稳定比较策略；只提取现有hook时保留其他输入行为。
- `runner.ts:84,95,142`每次render重建handlers，事件后异步schedule。表格交互应始终使用当前handler；不要保留旧编号、在后续effect里自行回放事件。
- 4000节点限制只数积木树节点（`runner.ts:68`），不会限制DataTable props里几千行；宿主边界必须先验证大小再排序/映射/渲染。

### 推荐最小公开协议（建议，非已实现）

建议一个`ui.DataTable`，独立于现有Table。宿主负责本地列表计算和一致控件，Applet拥有传入记录和受控视图状态。数据契约应冻结以下项目：

```js
ui.DataTable({
  title: '记录',
  columns: [
    {key: 'name', label: '名称', type: 'text', priority: 'primary'},
    {key: 'amount', label: '金额', type: 'number', priority: 'secondary'},
    {key: 'note', label: '备注', type: 'text', priority: 'detail'},
  ],
  rows: s.records.map(r => ({id: r.id, cells: {name: r.name, amount: r.amount, note: r.note}})),
  state: s.table,
  onChange: patch => {Object.assign(s.table, patch)},
})
```

建议state包含`query:string`、`sort:null|{key,direction:'asc'|'desc'}`、`page:number`、`pageSize:number`、`selectedId:string|null`。选中即查看详情足以满足本轮，不必同时做批量多选/行内编辑/远端分页；若主会话选择多选，应另定跨页与筛选保留语义。

推荐`onChange(patch)`而非基于过时props发全量next state：输入搜索和点击选择快速发生时，patch由沙盒合并，不会把刚输入的query覆盖成旧值。明确哪些字段每次动作一起发：query/sort/pageSize改变时带`page:1`；翻页只带page；选中只带selectedId。输入框本地乐观回声不能仅因每次树回传都创建新state对象就被重置。**不要在render或布局effect中为了“纠正页码”不断自动发onChange。**

可选择1–500条行、1–12列、每页5/10/20/50，ID/列key为非空≤80字符串且唯一；字符串单元格≤2000字符、数字有限、boolean/null可显式支持。具体上限由主会话冻结，catalog与验证模块共用常量。非法/超量应局部报错，不静默截断；空行合法。所有字段从unknown验证，包括稀疏数组、重复ID/key、长度与单元类型错配；不要从原型取值或把任意对象String成`[object Object]`。

建议固定计算顺序：全部合法rows→全列文本搜索→单列稳定排序→分页；始终保留业务原数组。数值列用数字比较，文本列明确中文比较规则，null排序位置固定（如始终最后），相等时保留输入顺序。搜索应包含详情列；“无记录”与“无匹配”分别提示，后者能清空搜索。

UI展示用有效页码夹到`1..max(1,pageCount)`，但不修改记录、不在render触发状态写入。数据删除导致selectedId不存在时不显示陈旧详情；选择的ID仍存在但被过滤/跨页时，要明确保留并显示该记录详情，或明确清除规则，不以当前可见行索引猜测。最后一页删除记录、排序后查看详情、筛选隐藏已选记录都是必要回归。

宽窄布局必须只改变显示：按真实DataTable容器测量，窄容器保留主列/关键列并提供完整详情；桌面下也能键盘进入详情。不要把表格整体缩小或隐藏字段后使其永远不可读。状态栏由示例返回记录数/总额Text，不在32px高度显示表格。

### 推荐模块与公开测试边界

- `src/lib/applet/dataTableData.ts`（建议新增）：纯unknown校验、限额与无副作用筛选排序分页/有效选择，名字避免与`DataTable.tsx`仅大小写不同。
- `DataTable.tsx`（建议新增）：实际容器、Lobe搜索/排序/分页控件、语义数据区与详情；交互只调用传入send，不直接storage/fetch。
- `catalog.ts`：目录说明与同源可执行示例；`render.tsx`只增加分派，旧Table原样保持。
- `scripts/test-applet-runtime.mjs:20–49`、`scripts/test-applet-charts.mjs:21–54`已有真实buildRunnerDoc+VM harness，后者支持按当前树handler发对象payload。可证明目录→真实runner序列化、事件patch合并、persist记录与临时视图分离、设置/viewport不重启。
- `scripts/test-applet-chart-render.mjs`可借鉴真实UiTree/React SSR模块加载与CSS空loader，断言语义内容/错误而非库私有状态。
- `tests/applet-charts-regressions.tsx:13,33–55`使用真实iframe/UiTree和内存保存，完全不导入workspace/storage；适合新浏览器矩阵。真实App闭环另用隔离BrowserContext调用create_applet，不向用户空间装示例。
- 除基本数据/空错/限额，至少测快速连续query事件后排序或选择、稳定ID在翻页/排序/删除后的详情、全列搜索、原始业务数据不变、临时筛选不save、刷新持久记录恢复、主题/resize不重复init或请求、双主题320/375/768/1440及桌面窄容器、键盘/触摸操作。

## Files Found

- `src/lib/applet/catalog.ts`：组件白名单及AI运行时技能正文。
- `src/lib/applet/runner.ts`：积木序列化、函数编号事件桥、persist与生命周期。
- `src/lib/applet/render.tsx`：简单Table、事件分发、输入回声及宿主控件。
- `src/widgets/applet.tsx`：iframe身份、消息转发、100KB业务保存边界。
- `src/lib/applet/useContainerWidth.ts`：真实可见容器测量，可复用。
- `scripts/test-applet-runtime.mjs`、`scripts/test-applet-charts.mjs`：真实runner行为测试模式。
- `tests/applet-charts-regressions.tsx`：内存夹具与真实宿主浏览器模式。

## External References / Versions

本研究不作第三方库外部API判断。本机package声明React^19.1.1、Lobe UI^6.5.1；`node_modules/@lobehub/ui/package.json:168`间接依赖`@tanstack/react-table:^9.2.8`，lock实际9.3.1。不能抄TanStack v8 API或直接导入未声明的传递依赖；选库与Lobe DataTable能力由主会话/另一研究核对。

## Related Specs

- 当前PRD：`.trellis/tasks/10-27-applet-data-table/prd.md`。
- `.trellis/spec/ai/tools-and-apps.md`：目录和宿主必须贯通，保留沙盒与形态边界。
- `.trellis/spec/frontend/type-safety.md`：unknown运行时验证。
- `.trellis/spec/frontend/state-management.md`：业务数据、应用设置、工作空间分离。
- `.trellis/spec/frontend/hook-guidelines.md`：尺寸与主题更新不重启业务。
- `docs/design-system.md`：Lobe控件、主题、实际容器适配与简洁文案。

## Caveats / Not Found

- 当前没有DataTable公开协议；本文字段、限额与选择策略均为设计建议，不能当已交付事实。
- 未找到自动递归转换列formatter函数的能力；若声明第三方React column API可直接传入将错误。
- 本研究只读源码，没有运行生产或浏览器检查；没有修改业务代码、规范或Git。
