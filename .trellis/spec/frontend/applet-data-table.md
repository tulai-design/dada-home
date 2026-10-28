# Applet 数据管理

## 协议与数据

DataTable是独立Applet白名单积木，保留简单Table。目录→runner顶层handler→UiTree接线，属性只传JSON标量和稳定行ID；不允许列内render/formatter函数，不透传Lobe/TanStack内部配置。

dataTableData.ts统一unknown校验、500行/8列、每文本500字符、有限数字绝对值≤1e12；列key唯一，行id非空且唯一，声明列必须有自有values字段，null显式缺失，0/false保持。非法/超量局部报错而不是截断；表格限额与应用存储的8 MiB UTF-8 JSON预算分开校验。

## 受控视图

state与顶层onChange同时提供。state含query、sort、零起始page、pageSize、selectedIds；onChange回传局部patch，应用以Object.assign合并，不替换全部state。搜索/排序/页容量变化同时回到第0页；只选中或翻页不覆盖其他最新状态。

固定处理次序：全列子串搜索→稳定单列排序→分页。搜索包括窄容器隐藏列；number列数字比较，null始终最后，同值保持输入顺序。派生视图夹住删除后的页码、剔除不存在的选择ID，不在render/resize中回传修正事件。

选择跨筛选/翻页按稳定ID保留，当前页全选只影响当前页，展示全局已选数并支持清空。详情按行ID，不按可变下标。跨iframe输入回声须处理结构克隆与快速连续patch，不能用引用相等假设或让旧回声覆盖新输入。新的宿主快照即使内容与此前相同，也可能是快速输入往返后的确认，不能只依赖JSON内容变化处理确认；确认后释放对应的待回声记录，外部state重置仍须生效。回声历史有界，不因handler不回写而无限积累。

业务记录用persist，查询/页码/选择等临时state默认不持久化；settings是用户配置，设置热更新不重跑init或损坏记录。示例与运行时AI指南同源，实际执行增删/筛选排序/详情/保存恢复。

## 宿主与验证

使用已声明的Lobe Table/公开atoms及其Input/Select/Button/Checkbox/Empty；不直接导入间接TanStack依赖，更不混用v8/v9 API。Lobe列responsive按窗口判断，宿主须测自身容器：窄时减少优先列，所有字段仍通过可键盘/触摸的详情读取，不能只缩小整个宽表。

复用useContainerWidth并保持错误恢复前后的观察外壳。分页与选择控件有中文名称和范围说明；长文本换行，空数据/无匹配/非法数据区分，搜索无匹配可清除。不新增卡片壳、硬编码颜色、浮层或标题栏。

测试经真实目录/runner和UiTree观察用户结果；必须包含稳定数字排序、隐藏列筛选、跨页选择、删除最后页、延迟回声与快速输入、外部重置、错误恢复、长文本与上限。浏览器覆盖四宽双主题、宽窗口内窄容器、键盘和触摸，resize/theme不重启业务；真实共享示例验证持久记录与临时视图分离。
