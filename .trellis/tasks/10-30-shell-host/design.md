# ShellHost 具体设计

状态：已实现并通过验收。实施基线：`62db7cb`。前项 theme-identity 已完成实例/skin/shell 分离，本项不再修改持久化格式。

## 1. 当前切口与边界

当前 `App.tsx` 仍拥有 Switch 主屏、Win98 打开/最小化/最大化状态，逐入口恢复窗口，直接导入专属 chrome；`SwitchHome` 与 `PageView` 使用条件二选一，进入启动器会卸载业务。`Rail`、Switch 封面、Win98 桌面/菜单分别从 Page/Application 生成入口，Settings 仍按 shell 判断展示。这些复杂性必须被模块隐藏，而非把原 props 搬入包装组件。

本项以当前真实三个外壳提取稳定宿主边界。业务导航、页面、应用 canonical ID/运行器、Reader、助手、审批及持久化归宿主；外壳只决定菜单、启动器、选中封面、窗口装饰和临时可见区。不开第三方 JavaScript、桌面 DSL、动态 package 或多窗口管理器。新可信外壳仍随构建打包。

## 2. 唯一导航目录与成功激活

新增纯模块 `src/lib/shell/navigation.ts`，由 Workspace 和现有应用展示信息投影一次；Adapter 不接完整 Workspace，也不各自过滤 Page/Application。目录包括所有可打开页面、应用和系统入口，`home/pinned` 表达已有显示政策，各 Adapter 决定封面/桌面/菜单布局。

```ts
type NavigationTarget =
  | {kind: 'page'; id: string}
  | {kind: 'system'; name: 'settings'; section?: string}
  | {kind: 'system'; name: 'market' | 'monitor'}
  | {kind: 'application'; id: string; mode?: ApplicationOpenMode}
type NavigationEntry = {
  key: string
  target: NavigationTarget
  label: string
  icon: {kind: 'page'; name?: string} | {kind: 'application'}
    | {kind: 'system'; name: 'settings' | 'market' | 'monitor'}
  home: boolean
  pinned: boolean
}
type NavigationActivation = {revision: number; target: NavigationTarget; title: string}
type ShellIntent =
  | {type: 'navigate'; target: NavigationTarget}
  | {type: 'assistant'; action: 'toggle-preferred' | 'open-panel'}
  | {type: 'command-palette'}
  | {type: 'all-navigation'}
  | {type: 'toggle-color-mode'}
  | {type: 'close-content'}
```

助手是语义动作，不伪造为持久路由。`all-navigation` 沿用现有页面选择器，并包含应用入口所需的现有可达途径；若现有 chooser 不含应用，实施时明确扩大目录消费，不新增第二套目录。应用 mode 省略时沿用应用现有打开策略。

宿主唯一执行器使用最新数据校验目标，复用现有 `goPage/openSettings/openMarket/openMonitor/openApplication` 的业务政策和返回目标；入口函数可作兼容内部调用点，但最终都进入该执行器。快捷键、命令面板、待执行 AI 跳页也走此处。接受目标后发布单调递增 `activation.revision`，包括重复打开同一页/同一设置 section/同一应用；只有目标变化依赖不足以恢复最小化窗口。无效 ID、已删除应用和不支持 mode 不发布成功 revision，也不先收起启动器；当前目标被删除时由宿主执行已有有效回退并发布成功激活。

目录中 page/app ID 保持原 canonical ID，`key` 仅用于跨 kind 的 UI 唯一键。标题从当前目标投影，重命名可刷新标题而不伪造一次激活。

## 3. 固定舞台与有限 Adapter Interface

ShellHost 模块包含稳定 provider、导航/画布固定锚点和只读呈现接口；不要把全部 App state 塞入万能 context。建议入口为 `ShellHost`、`ShellNavigation`、`ShellCanvas`、`useShellPresentation`，内部实现可以合并文件。Provider 不能用 theme ID、shell ID 或 variant revision 作 key。

```ts
type ShellModel = {
  entries: readonly NavigationEntry[]
  activation: NavigationActivation
  mode: 'light' | 'dark'
  profile: {name: string; avatarSeed: string}
  assistant: {open: boolean; busy: boolean}
  dock: DockStyle | undefined
}
type ShellPresentation = {
  content: 'visible' | 'launcher' | 'minimized' | 'closed'
  maximized: boolean
  reserves: {top: number; right: number; bottom: number; left: number}
  backdrop: 'page' | 'shell'
}
type ShellCapabilities = {
  settings: {header: 'sidebar' | 'wide'; avatar: boolean}
  navigation: 'dock' | 'launcher' | 'taskbar'
}
type ShellAdapterProps = {
  model: ShellModel
  dispatch: (intent: ShellIntent) => void
  publish: (presentation: ShellPresentation) => void
}
type ShellAdapter = {
  id: string
  capabilities: ShellCapabilities
  Chrome: ComponentType<ShellAdapterProps>
}
```

ShellHost 内部只在隔离的 Adapter session 上按实现身份换 key，渲染 `<Adapter.Chrome ... />`，让组件独立持有 hooks。禁止动态执行 `adapter.useController()`；不同实现的 hook 顺序不能进入同一稳定组件。Chrome 使用模块私有固定 port 将外部导航和画布装饰渲染到两个可信锚点，不能指定任意 DOM 目标；不向 Adapter 交业务 children、ApplicationHost 或通用宿主回调集合。

```text
App（可信业务）
└─ ShellHost（固定身份；registry/model/dispatch）
   ├─ ShellNavigation（固定外部导航锚点）
   └─ AssistantSplitPane（原固定容器）
      ├─ ShellCanvas（固定 .canvas 和 overlayContainer）
      │  ├─ chrome 锚点（可换 Adapter 的标题栏/启动器/任务栏）
      │  └─ .shell-content-stage（固定父节点）
      │     ├─ TopBar/StatusBar
      │     ├─ 当前 PageView 或系统业务页
      │     └─ 绑定该页的 Fx/检查/首页草稿
      └─ ChatAssistant（保持现有宿主身份）
可信的 ApplicationHost、Reader、审批/保存错误 UI 保留原宿主所有权；
附着窗口 portal 的目标容器在换壳、显示启动器及最小化期间保持同一 DOM。
```

舞台不能位于 Adapter/错误边界内部，不能因 visible/launcher 改 React 分支或换父容器。正常路由变化继续现有生命周期，不承诺所有页面永远常驻。移除 SwitchHome/PageView 的 ternary，同时调整 `.canvas > .page/.topbar` 等直接子选择器，避免固定舞台引入布局退化。

Adapter 在布局 effect/事件后发布有限 presentation，不在 render 中写父 state。ShellCanvas 观测真实画布尺寸，验证保留区为有限非负数并不挤出整个内容区域；非法 descriptor 进入外壳故障回落。常量高度用 CSS 变量和容器布局，确需测量时从模块提供的只读画布测量获取，不能读取业务 DOM。发布去重，防止无限 effect 循环。无需预置无人消费的 shell config。

## 4. 外壳职责、隐藏与关闭

三个注册实现为 standard/switch/win98。Standard 包装现有 Rail/Dock 行为；Switch 持有封面选择、主屏开合、手势及电量/网络监听；Win98 持有窗口打开/最小化/最大化、开始菜单和桌面选择。`bindOpen`、`setWin98*`、`switchBoard` 等专属控制不再穿过 App。

成功 activation revision 使当前 Adapter 显示工作区、关闭启动器/菜单；同 shell 配色/派生变更不重启 session。跨 shell 可按新外壳初始展示策略显示启动器/桌面，但业务 route 与运行实例保持。切换时旧 session 清理 document/window 监听、异步电池回调、滚动绑定、pointer capture、计时/动画及 portal。

| 动作 | 宿主业务语义 | 外壳呈现 |
| --- | --- | --- |
| 打开启动器/最小化/显示桌面 | 不改 route，不清 Reader，不调用应用 minimize/close | 隐藏固定舞台和附着 overlay，可恢复 |
| 选择有效导航目标/恢复当前窗口 | 复用当前运行实例或按原路由规则导航，发布 revision | 显示内容，恢复局部窗口 |
| `close-content` | 关闭当前附着应用，沿用 `closeApplication` 的返回政策；清 Reader；不删 page/业务数据 | 关闭局部内容窗口，留下恢复/导航入口 |
| 应用自己的最小化 | 保留应用现有最小化事实 | 外壳恢复不能覆盖该事实 |

应用实际隐藏为“应用自身 minimized OR 外壳内容不可见”，不能把 shell 临时隐藏写回应用持久状态。Reader 需要可见性 prop 或固定附着 overlay 包装；隐藏时不条件卸载 Reader，也不换 portal 容器。关闭是明确卸载的允许边界，不能把 close 偷换成后台常驻。

隐藏阶段实际 DOM 必须不可点击、不可聚焦、不可辅助技术访问，采用稳定父节点的 `hidden/display:none`、`inert`、`aria-hidden`；提前把焦点从隐藏内容转移到可达的启动器/恢复按钮。恢复时优先还原仍连接且可见的原控件；用户已明确选其他目标则按新目标处理，不抢焦点。焦点引用不是业务 DOM 操作接口，不传给 Adapter。

`pageInspector` 只登记已提交呈现为 visible 的正式页面，首页草稿和隐藏舞台不登记。不可只在 passive effect 延迟清理，让隐藏布局暂时能被检查。Fx 依据通用 presentation/backdrop 展示，不能以 renderer ID 改业务父节点。

## 5. 能力目录、故障及有效回落

Registry 拒绝重复 ID，静态内置三 Adapter。Settings 从当前有效能力读取 header/avatar/navigation；frame 沿用 skin 的 `themeCapabilities`，不把 skin 权限混入 shell。standard 为 sidebar/no-avatar/dock；switch 为 wide/avatar/launcher；win98 为 sidebar/no-avatar/taskbar。Settings 和 App 不增加新的 shell ID switch/if。未来新增可信实现可增加静态 ThemeShell/catalog 配对，但不增加宿主业务分支。

测试允许构造内部 registry 和请求 ID 注入 ShellHost，第四 Adapter 只实现/注册自身即可运行。生产持久化 ThemeShell 仍为三种已支持值；不为了测试把 unknown 引用放进 workspace validator，不保存 test theme。

错误边界只包 Adapter session。未知实现、初始化/渲染失败、有限 descriptor 校验失败均切到 standard；异步和事件错误需模块内有明确捕获并上报，不声称 React ErrorBoundary 能捕获事件错误。可信 same-origin 实现仍可能无限循环，这不是隔离或第三方 runner。

回落保留 requested shell/skin 和整个主题记录，另提供 active shell/skin 与 reason。**必须实际回落有效 skin/layout**：当前 `html[data-skin=win98/switch]` 的全局 CSS 会隐藏 Rail 并改变 canvas，不能只把组件替换成 Rail。故障时把根的渲染皮肤/变量、`data-shell` 与几何一起切到宿主安全 standard/paper 基础，原请求快照不重写；主题 effect 与 ShellHost 只能有一个协调有效渲染结果的入口，防止 effect 互相覆盖。稳定舞台原 DOM 不换父节点，重新应用变量只触发重绘。

恢复提示、进设置、助手/停止和重试入口由可信宿主持有，位于 Adapter boundary 外；fallback 下即使原皮肤选择是 Win98/Switch 也必须有真实可见/可点入口。重试只在显式操作或请求实现身份变化时触发，不能每 render 反复挂坏 Adapter。运行时 fallback 信息供设置/外观查询使用，不把“请求成功保存”误报为当前已生效。皮肤回落是故障策略，不新增用户偏好双写。

## 6. 验证与交付边界

先用真实 App 复现 Switch 启动器卸载、跨 shell 重挂及 Reader/应用最小化丢可见性的旧行为；记录 red，再用固定舞台验证 green。DOM 引用、未提交输入、应用 init/request 计数与 canonical ID 必须联合检查，单纯显示值或 localStorage 相等不足。

测试第四 Adapter 使用与正式业务舞台相同的模块边界与真实内容，覆盖不同 hooks 数、同目标 revision、隐藏/恢复、注册缺失、render/event/descriptor 故障；不只挂一个空 div。故障测试读取实际 computed display/geometry/inert，确认在 Win98/Switch 请求主题下设置/助手/停止仍能操作，业务 DOM、草稿、审批和运行器保持。

浅深、1440/390/320、分栏窄画布、reduce-motion、窗口保留区及 Web/MV3 继续现有真实矩阵。普通路由切换/close 的允许卸载与换壳保持分开断言。实现前主会话审读本合同并激活；实施后以实际源码更新长期文档、检查、双轴审查、提交和归档。回滚只回提交，不清数据、不改真实远端。
