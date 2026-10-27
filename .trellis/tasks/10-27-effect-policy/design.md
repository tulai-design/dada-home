# 页面特效策略设计

2026-10-27。本任务只交付特效目录、组合预算和运行质量，双主题色板及全面错误恢复仍由后续任务处理。

## 统一接口

新增 src/fx/capabilities.ts：26个效果的渲染类型、成本、持续动画、触屏策略、来源核对状态和宿主质量限制。catalog.describeFx 向 AI 暴露同一资料，参数范围仍由现有 normalizeParams 负责。

新增 src/fx/policy.ts：纯函数分析页面 layers + type=fx 组件，提供 assessPageEffects(page)、assertFxBudgetChange(previous,next)、planPageEffects(page,{compact})。使用结构类型或 type-only 导入，避免 catalog/registry/workspace 的运行时循环。key 为 layer:<index> 或 block:<instanceId>。

初版政策：桌面预算8点、GPU上下文最多1、持续动画最多3；DOM每项1点，Canvas每项2点，WebGL每项3点，Spline6点。这里的点数是明确的产品上限，不是测量出的FPS或耗电。小于480px的实际容器使用4点预算，WebGL/Spline以静态替代，指针装饰关闭。后续如调整阈值须记录实测依据。

## 写入和兼容

ops.replacePage 检查变更页，覆盖新增、更新、跨页移动、setLayers；installAddon 新页也检查。模板 applyTemplate 检查即将应用的每一页，拒绝新超限组合。旧页面允许每个资源维度不比原来更差的编辑，不阻止逐步减负或普通内容修改。

migrate/import/sync/undo 保留合法旧配置，不在 store.commit 全局拒绝或删配置。渲染器始终用同一policy规划可运行效果，超限的旧项静态显示，页面给简短可展开说明。AI get_workspace 返回同一分析，避免只在视觉上静默降级。

## 运行时

FxLayers 接收当前page与canvas实际容器节点，用ResizeObserver读取宽度，并为页面blocks与portal layers共享计划。FxEffect按稳定key取得决策；未在共享计划中的效果走保守的单项规划。

宿主统一监听减少动画、document.hidden、IntersectionObserver。减少动画/超预算/小容器重型效果使用主题变量静态背景或完整静态文字/卡片；隐藏/离屏卸载效果实现，保留业务子树，复现时重新挂载装饰。宿主不引入第二个RAF循环，清理由现有vendor卸载实现承担。

ClickSpark的wrapper始终保留，disabled时清理其引擎（effect依赖disabled），不因暂停更换children父类型造成业务应用重挂。重型效果质量参数由宿主最后覆盖，AI不能用params绕过。

## 来源

历史本地vendor缺少明确上游revision/license证据时如实标记待核对，记录本地引入commit和文件路径。移除笼统MIT注释；不把上游当前许可套到历史源码，不新增依赖。

## 验证

公开ops/tool行为：图层+内容块共同计量、新增/更新/移动/模板拒绝原子性、旧页减负、load/undo保留。真实组件fixture：目录查询、超预算说明、窄容器静态化、减少动画完整内容、隐藏/离屏卸载、恢复；测试不依赖vendor私有字段。

## 范围与回滚

不实现任意自定义Applet/App内部动画计量，不声称检测帧率或对比度。现有已存数据无schema变更；回滚代码后配置仍可读取。静态替代只保证内容和运行开销，不替代后续语义色板与全面失败恢复。

审查补充：窄容器下光效卡片显示静态正文；粗指针禁用光效卡片与ClickSpark，并关闭其他效果的指针跟随装饰。每块自身窄宽导致的静态显示也汇总到页面说明。还原外观是公开写入，恢复默认背景前执行同一预算检查，冲突原子拒绝并指导减负/移动后重试。
