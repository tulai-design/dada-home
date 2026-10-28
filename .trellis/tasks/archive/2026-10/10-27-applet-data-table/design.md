# Applet 数据管理设计

日期2026-10-28，基线dde5d73；沿用main与每轮验收后本地提交约定。

## 变化边界与选型

当前Table只有静态列/行及局部横滚。新增独立DataTable白名单积木，交付本地有界记录的搜索、单列排序、分页、稳定ID选择和窄容器完整详情；原Table/Bars/LineChart行为保持。

复用已安装@lobehub/ui 6.5.1的Table或其公开atoms、Input/Select/Checkbox/Button/Empty，不新增依赖、不直接消费其间接@tanstack/react-table 9.3.1。内部不采用TanStack v8的useReactTable等示例。用小型纯数据模块提供宿主协议与确定性视图；Lobe承担表格和交互外观。Lobe的responsive以窗口匹配，不能代替本轮实际容器测量。

不增加服务器分页、后端数据库、列内函数、任意HTML、复杂单元格编辑、导出/导入、虚拟化或数据库管理器。AI业务增删通过Applet现有事件操作records；宿主表格不存业务数据、不请求网络。

## 公开协议

`ui.DataTable({title?, columns, rows, state, onChange, selectable?})`：

- title可选，默认“记录”；提供时非空、最多80字符。
- columns为1–8项：`{key,label,type?:'text'|'number',priority?:1|2|3}`。key唯一，匹配`[A-Za-z][A-Za-z0-9_]{0,39}`，拒绝constructor/prototype；label非空且≤80；默认type=text、priority=2。优先级越小越重要，相同按列定义顺序。
- rows为0–500项：`{id:string,values:Record<string,string|number|boolean|null>}`。id非空、≤80、全表唯一且稳定，不能使用当前排序/分页下标。每个声明列必须有自有values属性；数值有限且绝对值≤1e12，文本≤500字符；number列只接受number/null，text列接受全部标量。额外值不展示；缺失用显式null显示“—”，零与false不能丢失。禁止静默截断。总限额不是持久化额度，Applet保存仍受100KB限制。
- state是必需的对象：`{query?:string,sort?:{key,direction:'asc'|'desc'}|null,page?:number,pageSize?:5|10|20|50,selectedIds?:string[]}`。省略字段默认query=''、sort=null、page=0、pageSize=10、selectedIds=[]。query≤200，page为非负安全整数；sort key必须在columns中。selectedIds为≤500个合法id字符串，重复合并，已删除/不存在ID从有效视图选择中剔除。
- onChange为必需的顶层事件，宿主回传可序列化的局部状态patch；示例使用`Object.assign(s.table, patch)`，不能把patch直接替换整个state。不会回传函数或Lobe/TanStack内部对象。selectable默认为false，true时提供选择。
- 数据或state非法、缺少handler显示局部错误，保持兄弟积木。空数据和有记录但无匹配分别提供可理解的Empty。

## 状态与数据处理

`dataTableData.ts`导出DataTableColumn/Row/State/Data类型、ROW_LIMIT=500/COLUMN_LIMIT=8/PAGE_SIZES、normalizeDataTable(raw)判别结果及deriveDataTable(data,state=data.state)。derive返回`{state,rows,totalCount,filteredCount,pageCount}`，state为有效分页/选择，rows为当前页。明确输入类型，不在非法数据上继续推导。

全局query对全部声明列（含窄屏隐藏列）按显示文本大小写不敏感的子串匹配，trim只用于匹配，不改输入。按列type进行稳定单列升降序；null始终排最后，等值保留输入顺序，sort=null恢复输入顺序。先过滤再排序再分页。pageCount至少1；筛选/排序/页容量操作发patch并把page设0，删除后有效page夹到最后可用页；不在render/resize时发事件。

选择跨搜索与分页保留稳定ID，当前页全选仅影响当前页，保留其他页ID；显示全局“已选N条”，提供清空选择。删除数据后有效选择剔除缺失ID。批量业务操作由Applet负责。控件立即反馈但要正确处理沙盒延迟回声；局部patch防止搜索与选择的快速连续操作相互覆盖，外部state更新可正常重置。选择/搜索/分页默认不persist，记录与必要ID计数才persist；刷新恢复记录但临时视图回初始状态。

## 宿主UI

`DataTable.tsx`配独立applet-data-table.css，UiTree新增分支；通过p+onChange适配现有Fire。实际宽度复用useContainerWidth，错误→合法恢复始终保留测量外壳，不改iframe key/srcdoc/init。

简洁标题、搜索、排序与记录数；所有按钮、输入、选择沿用Lobe，不加大圆角、卡片底色或额外上边线。可用Lobe Table展示已经派生的当前页数据，关闭其重复分页/排序以避免双重处理；原生语义结构可用Lobe公开atoms。按实际宽度选优先列：<480px仅一个最高优先字段，480–719px最多两列，≥720px最多四列；所有列均可在每条记录的详情中读取。详情通过Lobe文字按钮展开，包含完整字段名/值（dl），按稳定行ID关联，不用只可点整行或hover。

搜索/排序控制支持所有列，包括隐藏列；排序按钮或选择控件明确当前方向，提供恢复原顺序。分页使用中文Lobe上一页/下一页与页容量Select，显示实际页数和匹配/总数；窄时换行，不缩小字体。选择checkbox有明确标签，“全选当前页”不暗示全数据；详情与选择支持键盘和触摸，焦点可见。长文本换行，数字不丢失精度。无匹配仍保留清空搜索的入口。表格空态本地化。

## AI共享示例

`dataTableExample.ts`导出RECORD_APPLET_SOURCE与RECORD_APPLET_EXAMPLE，catalog guide引用同一源码。示例“开销记录”从空开始，用户添加项目、金额、分类及备注，表格支持查找/排序/分页/详情、按ID批量删除；persist仅records与nextId。最多100条，备注≤200，显式拒绝超量不删旧数据，适合100KB保存额度。

settingsSchema提供默认页容量5/10/20；init读取设置，onSettingsChange只更新页容量和页码不重建数据。status分支只显示记录数；默认drawer、分组生活、不钉Dock/status、不挂页。未经请求不在用户空间安装示例。

## 分工和验证

- 数据代理所有权：dataTableData.ts、dataTableExample.ts、catalog.ts、scripts/test-applet-data-table.mjs。先真实目录/runner红灯，再纵向实现数据/state/示例行为。
- UI代理所有权：DataTable.tsx、applet-data-table.css、render.tsx、scripts/test-applet-data-table-render.mjs。先UiTree未知积木红灯，再Lobe接入；与数据代理按冻结接口协作。
- 浏览器代理所有权：tests/applet-data-table-regressions.html/.tsx、scripts/test-applet-data-table-browser.mjs、scripts/test-applet-data-table-app-browser.mjs。真实runner与UiTree隔离内存夹具、真实App共享示例，外网/代理拦截，不连接用户浏览器数据。
- 主会话负责文档/规范、测试链与旧loader适配、完整tsc/test/build、双轴审查、提交归档；当前子任务之后另做父任务组合验收，不能以子任务全绿替代。

验证320/375/768/1440双主题、1440窗口内280/360px容器；真实输入/选择/排序/分页patch，筛选全部隐藏列，清空搜索、跨页选择、删除最后一页、稳定ID详情、长字段、空/错/上限；键盘/触摸；resize/theme不丢输入/不重复init/fetch。真实共享示例创建→增删→筛选排序→窄屏详情→设置→刷新恢复记录但清空临时视图。原Table兼容与完整构建必验。
