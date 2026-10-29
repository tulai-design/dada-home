# 页面分区

## 数据与顺序

`Page.components` 是组件实体唯一来源；可选 `sections` 只引用本页组件ID，不嵌入实例或改变应用安装记录。`pageSections.ts` 集中严格写入、宽容读取、引用清理和插入顺序；ops仍是纯操作，store负责commit/history。工作空间v6读取旧页不自动创建分区。

hero/section/split仅一层。严格工具输入从unknown验证，引用不能跨页或重复，非法请求在commit前失败。读取/导入丢弃坏引用时保留组件，未分组项追加，不能让旧内容消失。分区展开顺序（split主→辅）与未分组尾部共同规范化components，禁止隐藏的第二套排序。

组件删除/跨页移动、addon/custom/application卸载和取消挂载必须清引用；同页mount调整span保持原槽位。新增或移动到index时按目标组件槽位插入，末尾未分组。自存模板、迁移与撤销保留ID；内置模板freshIds必须以相同映射重写布局refs。外观还原保留分区。

## 渲染与状态

所有widget保持同一.page-grid父级和稳定组件key，分区标题是有独立key的兄弟元素。不要用嵌套section、display:contents或按宽度分支更换React父级；它们会在跨组或容器重排时丢失临时状态。继续复用PageView原组件resolver、WidgetBoundary与data-id/type，检查器可定位同一组件。

桌面用受控grid坐标；容器小于720px时撤销显式行列，DOM顺序单列。查询.page-grid实际内容宽度，不能依赖window宽度。sectioned模式自然高度、页面纵向滚动；旧页stage和三块首页居中只在未设置分区时生效。新样式独立作用于分区模式，并检查旧viewport媒体查询的!important不会破坏坐标。

长页的自然高度必须贯通特效宿主与ClickSpark包装，不能只让最内层grid变高、祖先仍锁定height:100%。后代溢出会扩大滚动范围，但外层page的Dock底部padding可能不再跟随内容末尾。保持同一React父链；根据页面模式调整高度，不用重新挂载来切布局，也不为解决此问题统一把.page改为flex。

这条约束也覆盖未分区的内置组件页：760px及以下已采用整页滚动，FxLayers与ClickSpark内容层必须一起使用自然高度；桌面旧页仍保留一屏布局。使用稳定的`.fx-page-content` / `.fx-page-surface`选择器，不依赖包装内第几个div。

应用外壳与Dock共同使用760px手机断点。不要在组件的980px响应式规则中把app改为纵向/自然高或让canvas溢出可见，否则761–980px区间的侧边Dock会占到内容上方、使滚动视口超出屏幕。改外壳时检查760/761、980/981两侧，并保留组件自身的响应式规则。

Win98 外壳使用实际 canvas 容器管理桌面、普通内容窗口与任务栏；普通窗口最小化只改变可见性，不改变原页面父链。AI 独立窗口以 `.application-window-layer` 的实际尺寸测量移动与最大化范围，使皮肤为任务栏预留的空间同样参与几何约束；不能仍按整块 canvas 计算后再靠裁切隐藏越界内容。其他主题未预留时，窗口层与原画布等大。

## 检查

公开工具、ops/store/templates/migrate验证原子性和身份；真实PageView验证320/375/768/桌面与桌面窄容器、双主题、长标题/空内容、键盘顺序、resize/theme/重分区后输入和计数不重置。用页面检查器复查实际溢出，完整语义见 [设计规范](../../../docs/design-system.md)。

移动端浮动Dock的验收使用完整App宿主链路，滚动到最底后测最后可点击内容与Dock边界，并验证命中仍是内容。只有PageView的夹具、存在滚动条或scrollWidth未超出都不足以证明底部可访问；页面检查器的几何裁切检查不等于已检查兄弟浮层遮挡。
