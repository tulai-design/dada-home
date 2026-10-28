# 数据表选型核对

日期：2026-10-28。

本机@lobehub/ui 6.5.1已经提供Table、受控选择/展开以及表格atoms，其内部@tanstack/react-table为9.3.1；本项目没有直接声明TanStack依赖。Lobe的responsive依据window.matchMedia，需由宿主自己测量真实容器再选可见列。源码证据见runtime.md与ui.md。

本轮查询[官方TanStack状态指南](https://github.com/tanstack/table/blob/main/docs/framework/react/guide/table-state.md)及[当前React适配状态文档](https://github.com/tanstack/table/blob/main/packages/react-table/skills/table-state/SKILL.md)：受控状态必须同时提供当前值和对应回调，v9示例为useTable/feature模式，不能照抄v8 useReactTable。稳定行ID支持跨排序/分页选择，参考[官方行选择资料](https://github.com/tanstack/table/blob/main/packages/table-core/skills/table-features/references/row-selection.md)。这些仅作为方案核对，不将库内部回调对象暴露给Applet。

决定复用已经安装的Lobe Table/公开atoms与交互控件，不添加第二个表格运行时。宿主以有界纯数据模块定义标量校验、子串搜索、稳定单列排序、分页及ID选择；Lobe负责显示。沙盒仅传顶层handler和JSON patch，不传formatter等函数。当前范围无需虚拟化、多列复杂筛选或服务器分页；将来扩大范围再评估，不把本模块演变成自制通用数据网格。
