# 特效目录与渲染

## 当前合同

[fx/catalog.ts](../../../src/fx/catalog.ts) 保存ID、类别、参数范围与默认值；[capabilities.ts](../../../src/fx/capabilities.ts) 保存真实渲染类型、来源状态与运行质量约束。AI的 `list_effects` 同时读取两者。新增效果必须同步本地实现、这两份目录与 [views.tsx](../../../src/fx/views.tsx) 映射。

[policy.ts](../../../src/fx/policy.ts) 不导入registry/catalog运行时，统一扫描页面layers与type=fx内容块。预算为8点/GPU1/持续动画3；DOM/SVG1、Canvas2、WebGL3、Spline6。持续动画按loop/trigger/ambient/fps等实际配置计算，旧非法值按渲染默认值保守计量。点数是产品政策，不是设备性能测量。小于480px运行预算为4点/GPU0，卡片也静态显示。

参数先规整再保存，渲染时再次规整；之后由 qualityParams 对副本应用上限及真实vendor props，不能改写用户配置，也不能把内部props加入用户schema来绕过策略。Threads等没有外部DPR接口的组件如实披露限制，不伪造参数。

## 写入与旧配置

- [ops.ts](../../../src/lib/ops.ts) 的replacePage统一执行 assertFxBudgetChange，新增插件页也检查。新页严格按上限；旧页每一维允许到max(旧值,上限)，普通编辑、排序与减负可继续，不能用另一维的减少交换超限增长。
- [templates.ts](../../../src/lib/templates.ts) 应用模板逐页按新页严格校验；拒绝前不提交工作空间。保存旧模板仍可用。
- [appearance.ts](../../../src/lib/appearance.ts) 还原外观逐页检查，原子拒绝默认背景与已有特效块的冲突；提示先减负或移动效果，不删除业务内容。
- migrate、导入、同步、undo/redo保留原有效配置；不要把拒绝预算塞进全局commit或迁移。运行规划按图层→内容块顺序选择动画，未知/超预算效果静态降级；不删除配置。
- get_workspace.effects 返回原配置预算与桌面/窄容器规划；页面的「特效已简化」解释运行降级。AI不得把保存配置等同于实际播放情况。

## 运行与生命周期

[Fx.tsx](../../../src/fx/Fx.tsx) 用实际画布容器判断分栏宽度，每个效果块还测自身宽度。减少动画、隐藏或离屏时卸载vendor View，利用其已有cleanup释放RAF/定时器/监听/GPU；不再新增动画循环。各vendor原本已有的暂停逻辑仍保留。

ClickSpark始终作为稳定的业务父节点存在；disabled变化只启动/销毁火花引擎，不能卸载业务子树。粗指针禁用火花、光效卡片，质量参数关闭鼠标跟随并把悬停文字改入场。静态文字保留所有行及内容前后缀，卡片保留正文，装饰背景提供主题变量绘制的替代；懒加载与错误隔离同样保留这些内容。

测试用 [test-effect-policy.mjs](../../../scripts/test-effect-policy.mjs) 验证公开目录、写入原子性与旧数据；[effect-policy-regressions.html](../../../tests/effect-policy-regressions.html) 验证真实组件、StrictMode、resize、减少动画与业务状态。浏览器检查不能用源码字符串断言替代。

## 修改要求与后续边界

- 保持效果失效与正文隔离；关键内容不依赖装饰完成加载。
- 默认墨色和部分lightMode适配继续保留；统一语义色板、错误详情/重试及自动设计检查属于后续任务。
- 预算不覆盖任意HTML App / Applet源码内的动画，不声称测量过FPS、耗电或对比度。
- 来源记录本地引入commit；缺少上游revision/许可凭据标为needs-verification。不要把上游当前条款套到历史副本，也不能沿用旧注释直接断言MIT。
