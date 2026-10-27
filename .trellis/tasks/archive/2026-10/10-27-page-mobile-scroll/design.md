# 移动端长页高度链修复

基线：5f4a0c3。以当前用户截图中的结构化长首页为验收场景，不调整用户主题、分区或数据。

## 已取得的独立几何证据

最小浏览器实验：492×636视口，`.page`位于top48、bottom636，高588，`padding-bottom:82px`；两层固定`height:100%`包装高506，内部自然内容高1180。滚到底时scrollHeight只有1180，末尾links bottom588、Dock top566，重叠22px。改`.page`为flex-column并阻止包装收缩仍重叠。两层包装改为自然内容高度后scrollHeight1262，末尾links bottom506，原82px留白重新有效。

这说明固定高度祖先的后代溢出可以扩大滚动溢出区域，却不会把外层末尾padding随自然内容推到真正末尾；不能以`.page`有padding、overflow:auto或flex:1断言末尾可访问。此为隔离几何实验，真实App证据另记verification。

## 实施原则

在FxLayers宿主边界区分单屏与自然长页，使长页两层包装随内容增长；不替换React父节点、不在resize时卸载组件。不无条件改ClickSpark组件在其他场景的高度，不把所有页面改为flex。保持旧三块首页/舞台布局及背景覆盖。

保留Dock的单一底部留白定义。真实浏览器回归须包含完整App→canvas→page→FxLayers→ClickSpark→PageView链路；滚到底测末尾链接矩形与Dock，并用命中测试证明链接可点，不能仅断言scrollHeight大于clientHeight。

主会话维护任务/规范/提交，实现代理负责宿主样式与浏览器测试，独立代理核对根因和修复后行为。

## 矩阵发现的既有断点冲突

768px实际App验收还暴露styles.css旧max980规则将body改滚动、app改自然高/纵向、canvas改溢出可见，而当前Dock/手机外壳断点为760px。中间区间Dock仍为侧栏，却被排到页面上方，破坏可用画布高度。恢复旧两层height100%仍复现page bottom1318.56、links bottom1270.56，超出636px视口，证实并非本轮自然高度修复引入。

最小删除这组过时的外壳覆盖，保留desk-grid等组件响应式规则。该文件在本任务原边界内，768可访问性属于原验收；不扩展为全局响应式重构。新增断点两侧760/761/980/981实际App验证，检查旧首页与系统页仍在视口内。
