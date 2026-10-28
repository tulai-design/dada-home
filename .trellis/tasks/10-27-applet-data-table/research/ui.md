# Research: Applet 数据管理宿主 UI

- Query: 现有 Lobe UI / TanStack 能力如何复用，怎样提供受控数据表、窄屏详情、键盘/触摸操作与真实验证？
- Scope: mixed（本机已安装源码/类型为精确版本依据，官方组件文档核对公开方向）
- Date: 2026-10-28

## Findings

### 版本与选择

| 位置 | 已核对事实 |
| --- | --- |
| `package.json` | 直接依赖 `@lobehub/ui ^6.5.1`、React/ReactDOM `^19.1.1`，没有直接依赖 TanStack。 |
| `node_modules/@lobehub/ui/package.json` | 实际 Lobe UI 为6.5.1，peer React `^19.0.0`；内部依赖 `@tanstack/react-table ^9.2.8`、`@tanstack/react-virtual ^3.14.18`。 |
| `pnpm-lock.yaml:1486,1492,1501` | 实际锁定 React Table9.3.1、React Virtual3.14.21、Table Core9.3.1；本机React19.3.1。 |
| `node_modules/@lobehub/ui/es/Table/engine/useTableEngine.mjs:3` | Lobe内部使用v9的 `useTable`、`tableFeatures`、`createExpandedRowModel`，不是v8 `useReactTable`接口。 |
| `node_modules/@lobehub/ui/package.json` exports | 实际入口及类型为 `.mjs` / `.d.mts`。目录还存在 `.js` / `.d.ts`，核对本机类型必须跟exports，不能误用遗留文件。 |

**工程建议**：沿现有直接依赖使用 Lobe `Table` 或其公开 Table atoms，不新增直接TanStack依赖。本轮有界本地数据操作可在纯数据模块完成；若宿主自己计算筛选、排序、分页，优先以 Lobe atoms 画受控语义表格，配 Lobe Input / Button / Checkbox / Select，避免完整Table再执行一次排序/分页。atoms是Lobe公开组件，不属于凭空自绘替代控件。

另一可行选项是完整Lobe Table：使用 `pagination={false}`、已分页dataSource、显式rowKey、自定义详情列，排序仅发受控事件不再本地重复排；但必须明确双层状态边界。不要因现有Applet简单Table是原生table就新增第二套无约束控件实现。现有Table保持兼容，新DataTable单独命名。

### 公开 UI API（以6.5.1本机 .d.mts 为准）

- `Table/type.d.mts:453`附近的 `TableProps<T>`：`columns`、`dataSource`、`rowKey`、`rowSelection`、`expandable`、`pagination:false|config`、`onChange(pagination,filters,sorter,extra)`；`variant:'borderless'|'outlined'|'filled'`，默认borderless。columns具有 `key/dataIndex/title/render/sortOrder/sorter/hidden`。
- `Table/type.d.mts:242`附近选择：`selectedRowKeys`受控；`onChange(keys,rows,info)`；`getCheckboxProps`可提供ARIA名称；`preserveSelectedRowKeys`保留离开当前dataSource的ID，不能不加处理地把已删除业务行永久留在选择中。rowKey应稳定ID，不能当前页下标。
- `Table/type.d.mts:190`附近展开：`expandedRowKeys`、`expandedRowRender`、`onExpandedRowsChange`；可显式Lobe详情按钮，避免只靠整行点击或hover。
- `Table/atoms/layout.d.mts:5`及 `cells.d.mts:5`：公开 `TableRoot`、`TableContainer`、`TableScroll`、`TableElement`、`TableHeader`、`TableBody`、`TableRow`、`TableCell`、`TableHeaderCell`。接收原生HTML/ARIA属性，可给table关联名称，th加scope/aria-sort，Button放入表头。TableRoot指定borderless，局部样式只改必要间距/换行/容器约束。
- `Input/type.d.mts:18`：受控value、`onValueChange`来自Base UI；已有宿主 `render.tsx:107`使用此接口。支持 `allowClear`、`maxLength`、`aria-label`、width/minWidth/maxWidth；搜索无需添加另一套输入组件。
- `Checkbox/type.d.mts:12`：`checked`、`onChange(checked:boolean)`、ARIA和 `indeterminate`（继承Base UI）可用于当前页全选。行控件名称包含行主字段，避免一组无名checkbox。
- `Select/type.d.mts:82`：`onChange(value|value[]|null|undefined)`；option为 `{value,label}`。按单选用途收窄；组件外部需可读标签。
- `Pagination/type.d.mts:16`：`current/pageSize/total/onChange(page,size)`；`simple:{readOnly:true}`可缩为上下页和页数，`showSizeChanger:false`禁止自动尺寸控件；默认total>50会开启页大小选择。`responsive`是窗口断点，不能代替容器判断。

### 需要宿主处理的库边界

1. `Table/pipeline/useBreakpoint.mjs:3–14`通过 `window.matchMedia`决定columns.responsive；大窗口里的窄抽屉/半宽小组件会误判。直接复用 `src/lib/applet/useContainerWidth.ts:4`，从实际容器选择列/紧凑视图；不要配置库的responsive后声称容器适配已完成。
2. `Pagination/Pagination.mjs:116,125,145,174`含固定英文ARIA（Previous page/Next page/Pagination/Current page）；本仓 `src/main.tsx:65`只有ConfigProvider motion，未配置全局中文。为本轮有限页导航，Lobe文字Button“上一页/下一页”与页数摘要更直接，也符合统一控件要求，避免为此扩范围全站i18n。
3. `Table/render/Header.mjs:58–74`默认排序控件为ActionIcon，完整默认header路径没有给该图标独立设置列名。即使用完整Table也应实测可访问名称；atoms配中文Lobe Button和aria-sort可明确表达“按金额排序/升序”。不能只认为库自带无障碍就跳过验证。
4. 宿主明确筛选/排序/分页/选择操作规则；库自动resetPage、保留隐藏选择等默认行为不能替代对外协议。数据删除后页码和选择的收敛须可预测。

### 窄屏与视觉方案（建议，待主会话冻结）

- 宽容器：平直的borderless数据表，表头与行对齐，主字段最清晰；不加大圆角卡片、重复标题或逐行上边线。
- 窄容器：按priority保留主字段和必要摘要，余字段通过行内“详情”按钮展开成定义列表；最窄时仅主字段+选择+详情。详情放在原行下面，不再嵌套抽屉/弹窗，不让应用窗口叠更多壳。
- 排序/搜索在窄屏仍能操作所有允许字段，不能因为列被隐藏就失去排序能力。可用一个小型Lobe Select选择排序字段/方向，或者在明确受控的工具栏保留入口。
- 输入、排序栏与分页允许换行；长标题、中文、URL和无空格文本 `overflow-wrap:anywhere`；完整值保留在详情，省略文本不能仅靠title tooltip恢复。
- 详情按钮和选择目标在触屏可稳定命中；使用Lobe控件的焦点状态，必要时容器padding扩展目标。选中不只变色，还显示checkbox及“已选N项”；“全选”明确仅本页还是全部匹配，不做隐含跨页批量删除。
- 空数据用Empty说明如何添加；查询无匹配用另一明确Empty并提供清除搜索；格式错误局部role alert。加载/业务取数失败由应用或明确props表示，不用无匹配掩盖请求失败。
- 暂不引入树表、拖拽列、列缩放、虚拟化、服务端查询、多列排序或任意render回调。约束的单列排序/分页足以兑现本PRD。

### 行为验证入口

- `src/lib/applet/render.tsx:228`现有简单Table最多12列/200行、原样局部横滚，应保持兼容；新组件用不同case。
- `src/lib/applet/useContainerWidth.ts:4`复用ResizeObserver。ref放始终存在的外壳，防止初始错误→有效数据后不再被测量（上一轮趋势图已修过此类问题）。
- `tests/applet-charts-regressions.tsx:1–71`可复用真实UiTree/iframe runner+内存保存的fixture结构，不导入workspace/storage；只在新建Playwright context测试。
- `scripts/test-applet-chart-app-browser.mjs`可复用真实create_applet/配置/刷新/形态闭环结构，共享可执行记录工具源码让目录示例与实际测试一致。
- 最低矩阵：320/375/768/1440双主题、宽窗口内280px容器；搜索中文/无匹配/清空→排序数字与文字→跨页→稳定ID选择→删除最后页后收敛→展开隐藏长文本→刷新恢复业务记录但重置临时查询/选择；主题resize不重启runner、不重复请求、不清空编辑中表单。
- 全键盘搜索、排序、页导航、行选中/全选、详情及返回；模拟touch详情。查询/排序切换后应检查选择语义，不能只断言按钮触发。
- 真正测dom宽度、实际可点击位置、详情末尾能滚动看到；数据条数与页面按钮存在不等于可用。实际截图需人工看，不能用浏览器脚本通过代替审美判断。

## Files Found

- `src/lib/applet/render.tsx`：现有Lobe输入封装及简单Table，新增DataTable接线点。
- `src/lib/applet/useContainerWidth.ts`：实际内容容器测量。
- `src/lib/applet/catalog.ts`：AI积木目录及可执行示例正文。
- `node_modules/@lobehub/ui/es/Table/type.d.mts`：精确安装版本受控API。
- `node_modules/@lobehub/ui/es/Table/atoms/{layout,cells}.d.mts`：公开Lobe语义表格atoms。
- `node_modules/@lobehub/ui/es/Table/{pipeline/useBreakpoint,engine/useTableEngine,render/Header}.mjs`：窗口断点、TanStack v9内部依赖、排序交互事实。
- `node_modules/@lobehub/ui/es/{Pagination,Input,Checkbox,Select}/type.d.mts`：操作控件精确版本类型。
- `tests/applet-charts-regressions.tsx`、`scripts/test-applet-chart-app-browser.mjs`：隔离宿主与真实App回归范式。

## External References

- [Lobe Table官方文档](https://ui.lobehub.com/components/table)：公开Table、列、选择、分页与atoms能力。已浏览核对，具体字段以本机6.5.1类型/实现为准。
- [Lobe Pagination官方文档](https://ui.lobehub.com/components/pagination)：受控页导航与simple模式。已浏览核对。
- Context7 `/lobehub/lobe-ui`查询未找到当前v6 Table资料，结果目录仅展示旧v2版本；没有照搬其旧Antd API。

## Related Specs

- `docs/design-system.md`：Lobe控件、token、克制列表、各形态与真实容器。
- `.trellis/spec/frontend/component-guidelines.md`：宿主UI与主题。
- `.trellis/spec/frontend/quality-guidelines.md`：真实浏览器、公开行为、隔离数据。
- 当前任务PRD：受控数据管理、状态语义、手机详情和可恢复记录工具。

## Caveats / Not Found

- 本研究未写生产代码、添加依赖或执行候选UI原型；不代表新数据管理能力已可用或视觉验收完成。
- 完整Lobe Table与atoms均可行，选择应由主会话依据最终数据协议冻结；不建议同时维护两套排序分页实现。
- 版本来自本机已安装包及lock；未把间接TanStack依赖当成项目可直接导入的稳定公开API。
- 具体行数/列数/页大小上限与跨页选择政策尚待设计确定；本文没有擅自扩大公开协议。
