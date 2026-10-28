# Applet 数据管理验收

日期：2026-10-28。基线：dde5d73。结论：本子任务通过；父任务组合验收仍独立保留。

## 交付行为

DataTable作为独立白名单积木，接通catalog→真实runner→unknown校验/视图派生→Lobe宿主Table，保留原Table。复用已经安装的Lobe UI 6.5.1，不新增依赖、不直接导入间接TanStack 9.3.1，也不复制v8 API。

- 最多500行、8列，稳定唯一行ID；严格检查标量、数值、文本、列key、状态和限额，非法/超量局部报错，不截断业务数据。
- 全列搜索（包括窄屏隐藏字段）、数字或文本稳定单列排序，null始终最后；先过滤排序，再分页。删除最后一页后派生页码收敛，不在render自动发事件。
- state与顶层onChange构成受控协议，回调传局部patch由Applet合并；选择按ID跨搜索/页码保留，当前页全选不影响其他页，完整选择数可见且可清空。
- 实际容器<480px保留1个关键字段，480–719px最多2列，宽容器最多4列；每条记录可展开全部字段，键盘/触摸均有操作入口，长文本换行。
- 共享“开销记录”源码用于AI指南与实际验证：从空记录开始，添加/按ID删除、页容量设置、刷新恢复；persist只包含records与nextId，临时筛选/排序/选择不持久化。默认drawer、生活分组、不钉Dock/status、不挂页。

## 自动化与构建

使用本机 `/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm`，build子进程PATH同样指向本机目录。

- `test`完整测试链通过，其中协议与共享示例11/11、真实UiTree SSR7/7。
- `exec tsc --noEmit`通过；项目没有独立lint命令。
- `build`通过，PWA成功；保留既有大chunk提示。最终回声修复后再次运行完整test/build通过。
- 任务上下文校验、git diff --check通过，本轮125个Markdown本地链接均有效。

数据测试覆盖空态、标量0/负数/false/null、文本转义、稀疏数组、重复ID/key、非自有字段、非法状态、500行/8列/文本数值上限、全列匹配、数字与文本稳定排序、分页夹限、跨页选择以及输入对象不被修改。真实runner覆盖目录发现、可克隆patch回传、快速patch合并、共享示例增删/设置/persist/刷新；最大100条中文项目与备注同时满足现有100000字符和100000 UTF-8字节边界。

SSR沿UiTree真实渲染Lobe组件，覆盖可访问名称、过滤分页、空/无匹配、标量与HTML转义、孤立代理项行ID不抛错、局部错误与兄弟积木、旧Table兼容。缺失目录、数据模块未实现、共享示例缺失、未知UiTree积木分别有先红后绿证据。

## 浏览器与视觉

使用独立Playwright Chromium上下文及本地Vite5175，减少动画开启，外网与代理请求拦截。夹具真实runner/UiTree但保存仅在内存；真实App示例在新上下文创建，不接触用户浏览器数据、不调用真实模型供应商。

`scripts/test-applet-data-table-browser.mjs`覆盖四宽320/375/768/1440与深浅主题、宽窗口内280/360/600px实际容器，搜索隐藏列、稳定数字排序/null-last、页容量/原顺序/搜索重置、跨页ID选择/当前页全选/清空、删除最后页收敛、完整长字段详情、空/错/超量/错误恢复、孤立代理项ID详情关联、键盘Enter/Space与模拟触摸、延迟回声及外部重置。尺寸/主题变化核对原输入DOM和值保持、init/fetch只一次；旧Table显示保持。

主会话人工查看 `/tmp/dada-applet-data-table-desktop.png`、`/tmp/dada-applet-data-table-mobile.png`、`/tmp/dada-applet-data-table-dark.png`，确认选择框、文字层级、表格与窄屏操作区呈现正常。

`scripts/test-applet-data-table-app-browser.mjs`已通过：共享创建参数→create_applet→抽屉空态→UI添加7条→搜索隐藏备注和零金额详情→数字排序及跨页选择删除2条→四宽双主题保持输入→设置每页10条→刷新恢复5条业务记录和设置、临时视图清空→widget同数据→compact status只有5笔摘要。

## 修复与审查

- 合法JSON行ID含孤立代理项时，encodeURIComponent会抛URIError；改为UTF-16码元构造安全DOM ID，保留业务ID，SSR与浏览器均有回归。
- Lobe Select把空字符串视作placeholder，导致原顺序显示为空；宿主使用不与合法列key冲突的内部sentinel，公开sort仍为null，真实恢复原顺序流程通过。
- 回声集合限制最近64个值，避免不回写的应用handler造成无限累积。
- 选择框最初被CSS拉成大空框，已改由Lobe自身label提供44×44px命中区，方框保持16px；实际点击label空白区域只切换一次。主会话人工查看桌面/手机浅色/手机深色截图，视觉已通过。
- Spec定向复现快速query空→a→空、只收到最终同内容快照后，外部再次设a被旧pending误吞的问题。改为依赖真实p.state快照，在各切片先确认当前值再判断旧回声；宽度变化造成的归一化对象不算确认。独立最小脚本红灯 `/tmp/dada-table-echo-red.log`、绿灯 `/tmp/dada-table-echo-green.log`；持久夹具?echo=1和完整矩阵通过 `/tmp/dada-applet-data-table-echo-green.log`，输入DOM保留且只有两次用户patch，没有自动回写。SSR7/7、tsc和最终完整test/build均通过。

Standards与Spec独立复核均已关闭已知问题，剩余发现0。Spec修后独立浏览器重跑时本地5175服务已关闭，故该次重跑未完成；其最终结论依据代码复核、修复代理的最小绿灯与浏览器代理完整矩阵，不记作额外一次独立浏览器通过。

## 存储核对与边界

用户询问IndexedDB与100KB时，实际核对确认：内置组件和聊天已使用IndexedDB，但AI App/Applet仍各自写localStorage，并硬编码100000 JSON字符上限。Applet底层写入失败可能只保留内存；该问题已记录到运行时契约与父任务后续重点。本轮未提高限额或改变存储，100KB不是浏览器容量结论；后续需独立处理IndexedDB接入、旧数据迁移、失败反馈和备份兼容。

本轮不包含服务器分页、虚拟化、多列复杂筛选、任意单元格编辑或数据库功能。浏览器验证限Chromium，触摸为模拟，未做实体设备、Safari或读屏软件完整验证；未评价真实供应商生成质量。父任务组合验收仍独立保留。
