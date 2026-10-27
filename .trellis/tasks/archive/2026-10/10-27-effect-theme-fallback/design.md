# 双主题特效与失败恢复设计

2026-10-27，基线41ce919。沿用已批准PRD；测试边界为公开ops/目录/模板与真实组件浏览器行为。

## 最小行为差距与归属

normalizeParams只保存单组颜色、useDark只观察明暗，外层文字与vendor各自处理颜色；Quiet无重试，WebGL初始化失败经常静默return。新契约分别属于catalog/颜色解析、渲染宿主与vendor错误上报边界。

预计修改：catalog及新theme纯函数用于保存/描述/解析；tools说明与公开行为测试用于AI可发现能力；Fx/views/widgets及主题hook让外层和内部同源；11个WebGL实现仅补失败上报/现有清理，不重写算法；fixture验证真实失败与恢复。docs/spec同步已经实现的规则。

## 颜色合同

params新增可选palette:'theme'与light/dark颜色补丁。light/dark只接受本效果已登记color/colors字段，不能修改动画、布局、预算、scene或嵌套控制字段。优先级：原有默认+params → palette语义映射 → 当前模式颜色补丁。未声明这些字段保持旧固定色和既有适配行为；不迁移覆盖历史配色。

纯resolveFxTheme(def,normalized,{dark,colors})返回剥离控制字段的完整参数副本。theme hook读取宿主实际CSS变量并观察data-theme/style，确保同模式配色变化也生效；浏览器必要时把颜色转换为vendor可读的具体色值，不把var()塞进GPU参数，不改保存配置。

widgets文字样式、横幅文字、静态卡片和内部vendor共用解析结果。显式新配色绕过旧inkFor的默认色替换。Spline只支持横幅文字配色，Noise无颜色参数，不承诺能改远程场景颜色。

## 失败合同

宿主ErrorBoundary保留静态内容并上报可见说明，重试只重建装饰，不重挂业务子树。重试重新创建lazy边界；浏览器自身可能缓存模块下载失败，必要时说明刷新页面。切换effect/scene参数后可以从旧失败状态恢复。

11个WebGL效果在getContext/shader/program失败处通过统一helper向画布派发运行失败事件；异步编译也走同路径。上下文丢失由宿主捕获，安全卸载。helper将事件排到microtask以确保宿主完成监听，并忽略已卸载canvas。现有cleanup必须保留；不捕获全局error、不吞业务异常。

图层位于aria-hidden装饰容器时，不在其中放不可访问的重试按钮；通过页面说明提供可访问的重试。内容块可显示简短失败状态与Lobe重试按钮。静态内容继续携带完整正文、单位及配色，减少动画不显示错误提示。

## 范围与验证

不引入新依赖，不更改预算/还原默认外观语义，不强制重配旧颜色；不实现自动对比度/FPS检查。外部3D场景错误与任意异步异常的复杂情况如实声明覆盖范围。

TDD先验证公开add/set layers保存分支失败，再实现规范化与解析；真实浏览器覆盖三类效果、明暗和同mode变量变化、WebGL不可用与contextlost、懒加载失败与重试、减少动画及输入状态保留。最后全测试/type/build、双轴审查、提交代码并归档记录。
