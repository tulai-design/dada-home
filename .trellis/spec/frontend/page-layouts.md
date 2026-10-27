# 页面分区

## 数据与顺序

`Page.components` 是组件实体唯一来源；可选 `sections` 只引用本页组件ID，不嵌入实例或改变应用安装记录。`pageSections.ts` 集中严格写入、宽容读取、引用清理和插入顺序；ops仍是纯操作，store负责commit/history。工作空间v6读取旧页不自动创建分区。

hero/section/split仅一层。严格工具输入从unknown验证，引用不能跨页或重复，非法请求在commit前失败。读取/导入丢弃坏引用时保留组件，未分组项追加，不能让旧内容消失。分区展开顺序（split主→辅）与未分组尾部共同规范化components，禁止隐藏的第二套排序。

组件删除/跨页移动、addon/custom/application卸载和取消挂载必须清引用；同页mount调整span保持原槽位。新增或移动到index时按目标组件槽位插入，末尾未分组。自存模板、迁移与撤销保留ID；内置模板freshIds必须以相同映射重写布局refs。外观还原保留分区。

## 渲染与状态

所有widget保持同一.page-grid父级和稳定组件key，分区标题是有独立key的兄弟元素。不要用嵌套section、display:contents或按宽度分支更换React父级；它们会在跨组或容器重排时丢失临时状态。继续复用PageView原组件resolver、WidgetBoundary与data-id/type，检查器可定位同一组件。

桌面用受控grid坐标；容器小于720px时撤销显式行列，DOM顺序单列。查询.page-grid实际内容宽度，不能依赖window宽度。sectioned模式自然高度、页面纵向滚动；旧页stage和三块首页居中只在未设置分区时生效。新样式独立作用于分区模式，并检查旧viewport媒体查询的!important不会破坏坐标。

## 检查

公开工具、ops/store/templates/migrate验证原子性和身份；真实PageView验证320/375/768/桌面与桌面窄容器、双主题、长标题/空内容、键盘顺序、resize/theme/重分区后输入和计数不重置。用页面检查器复查实际溢出，完整语义见 [设计规范](../../../docs/design-system.md)。
