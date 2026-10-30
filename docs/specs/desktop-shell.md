# 桌面外壳与稳定宿主

核对日期：2026-10-30。本合同描述仓库内可信外壳的模块边界；声明式主题作者草稿、本地包管理和第三方代码隔离继续由后续任务交付。决策依据见 [0005](../decisions/0005-layered-theme-extensibility.md)。

## 业务所有权与稳定舞台

`App` 保留工作空间、当前业务目标、应用运行身份、Reader、助手、审批和持久化门禁。`ShellHost` 提供固定的导航锚点、`ShellCanvas` 画布和内容舞台。外壳 Chrome 是舞台的同层呈现，不接收业务 children，不包住页面或应用运行器。

同路由切换外壳只替换 Chrome session；原页面 DOM、未提交输入、应用 canonical ID 与运行器、聊天草稿和审批继续保留。Switch 主屏、Win98 桌面与最小化隐藏固定内容，不切换其 React 父节点。隐藏舞台不可交互、不可聚焦且不参与辅助技术和页面检查；附着 Reader 与应用窗口同时隐藏，继续保留自身状态。背景装饰可以释放，业务内容仍挂载。

关闭与最小化是不同动作。关闭工作区执行宿主的 Reader 清理与应用关闭/返回政策；最小化不改变应用自身的最小化事实。正常路由、显式关闭和应用 surface 变化继续遵循既有生命周期，本合同不承诺所有业务页面永久常驻。

## 单一导航边界

[navigation](../../src/lib/shell/navigation.ts) 一次投影页面、应用和已启用系统入口，提供唯一 UI key、原 canonical ID、标签、图标语义与固定入口标记。三个外壳消费同一目录，决定封面、图标、菜单或 Dock 的呈现位置，不重新访问完整 Workspace。

[useNavigation](../../src/lib/useNavigation.ts) 是宿主唯一导航执行器。页面、设置、市场、监控、应用、命令面板与 AI 跳页都先校验最新目标。每次成功打开递增 activation revision，同一个目标重复打开也能恢复隐藏工作区；失败不改变路由或发成功回执。同帧连续操作读取最新已接受状态。

应用导航保留现有 modal/drawer/page 策略与返回目标；已最小化的运行实例继续占用原身份。分栏中的助手在系统页和应用导航时保留，其他布局沿用原有关闭政策；页面导航不改助手偏好。设置分区从实际可用目录选择，无效项回到可用项。

## 实现与注册

[contracts](../../src/components/shell/contracts.ts) 定义只读 `ShellModel`、判别式 `ShellIntent` 和有限 `ShellPresentation`。呈现只描述 visible/launcher/minimized/closed、最大化、四边保留区及背景归属。保留区必须为有限非负值，实际消费到舞台几何，不能挤出整个可见画布。

[adapters](../../src/components/shell/adapters.tsx) 登记 standard、switch、win98。每个 Adapter 的 Chrome 是独立组件，自己管理菜单、封面选择、工作区窗口和监听。新可信实现通过新增组件和登记接入，不在 App/Settings 增加其 ID 分支，不动态调用注册表里的 hook。Registry 拒绝重复 ID、非法能力和非法布局。

Settings 读取当前有效外壳的标题、头像和导航能力；frame 等视觉权限继续由 skin 决定。外壳配置尚未公开为自由 JSON，本轮不引入无人消费的配置字段。新增生产实现仍需补静态造型/外壳合法组合并重新构建。

## 故障与诊断

缺失实现、Chrome 渲染错误或非法呈现回报会回落 standard/paper。回落同时更换实际 skin、语义变量和布局，避免原 Win98/Switch CSS 隐藏恢复入口；保存的主题选择和设计不被改写。[resolveShellTheme](../../src/lib/shell/theme.ts) 是有效主题选择的共同入口。

错误边界只包 Chrome session。恢复提示、设置、助手、忙时停止和重试位于该边界外。Adapter 的事件/异步错误需主动报告；这仍是可信同源实现合同，不是第三方代码沙盒，也不能隔离无限循环。旧 session 的迟到回报不能覆盖新 session。

`get_appearance.current.theme` 描述工作空间保存的请求设计；`current.rendering` 来自可信宿主已提交快照，另报有效 skin/shell、语义变量与来源、内容可见性和故障原因。独立领域查询或不匹配的宿主快照返回 null，不冒充实际渲染成功。语义值仍不等同浏览器 computedStyle 或字体加载完成。

## 验证边界

纯回归检查导航政策、同帧请求、目录身份和注册/布局拒绝；真实 App 浏览器回归检查 DOM/输入、运行 init、草稿、审批、隐藏与恢复以及容器尺寸。第四可信 Adapter 夹具通过同一个宿主接口验证扩展接缝，不向生产主题 schema 添加测试身份。构建同时覆盖 Web 与 MV3；具体已运行结果保存在当前 Trellis 任务的 verification/browser-validation，不能以接口存在代替验收。
