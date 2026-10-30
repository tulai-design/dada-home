# A3 技术设计提案

状态：accepted；分层开放方向及四阶段方案已完成实施，见 ADR 0005。日期：2026-10-30。本文保留架构设计中的示意接口；最终字段与实现边界以各子任务设计和 docs/specs 长期合同为准，不能把示意字段当已支持能力。

## 1. 设计目标与切入点

要隐藏的复杂性是：主题来源与变体、有效值与模式、皮肤资源、桌面交互、内容生命周期、作者校验和保存往返。不能把 App 的几十个 props 移入一个新文件就称解耦。

三个已有外壳普通/Switch/Win98 作为真实 Adapter；主题与宿主之间的 Seam 放在“业务目标已解析、内容已归宿主所有，桌面呈现尚未决定”处。源码证据见 research 三份报告和 docs/work/research/2026-10-30-theme-shell-architecture.md。

## 2. 数据身份及解析

建议区分五个角色，字段是示意，不预先发布外部 SDK：

```ts
type RendererRef = {id: string; contractVersion: number}
type ThemeSpec = {
  schemaVersion: number
  skin: RendererRef
  shell: RendererRef & {config: JsonObject}
  tokens: {shared: JsonObject; light: JsonObject; dark: JsonObject}
  recipes: JsonObject
  assets: AssetReference[]
}
type ThemeDefinition = {
  id: string; version: string; name: string
  spec: ThemeSpec // 安装的不可变预设，内置定义也是此角色
}
type ThemeInstance = {
  id: string; name: string; description: string; revision: number
  origin?: {definitionId: string; version: string}
  spec: ThemeSpec // 派生时完整复制设计，不是仅保存新改的一个字段
}
```

- 实例 ID 只标识用户方案，重命名不改变 renderer；skin ID 对应造型，shell ID 对应交互。包 ID/版本只标识分发单元，不能代替实例或数据 ID。
- 派生保存完整语义设计，包括共享值、双模式、字体、部件 recipe、外壳配置和资源引用。不是复制当前浅色计算结果，更不复制页面/应用业务状态。
- 来源仅用于溯源；基础定义升级不悄悄覆盖用户变体。不在运行时维护任意父主题继承链。未来显式“基于新版更新”另定合并/冲突操作。
- skin/shell 均引用宿主已登记并支持的合同。数据自称某种能力不等于宿主具备该能力；非法组合在正式提交前拒绝。
- 静态定义/资源解析与用户变体数据分开；第一阶段只用打包内置资源，动态资源库在本地包阶段引入。

`resolveTheme(instance, catalog, mode, userPreferences)` 输出唯一 `ResolvedTheme`：原请求身份、实际 skin/shell、有效语义值、来源与回退原因、可编辑能力和有效 Dock/窗口度量。渲染、外观查询、Agent、设置和测试共用结果。

值来源固定为宿主合同默认 → 主题共享设计 → 当前模式设计 → 明确属于用户偏好的局部策略。各字段是否允许跨模式覆盖由 schema 决定。Dock 等用户偏好与主题造型分开：外壳可声明呈现方式或建议，但不能偷偷改写已保存偏好。Agent 查询必须披露最终是否生效，不能只回写入值。

读取的 unknown 入口统一校验：workspace、主题导入、模板、备份恢复、快照同步、增量配置同步。模板按精确主题身份查回，不能取“第一个非 default”。无需新增旧协议兼容桥；原真实数据不自动清空。

## 3. ShellHost 的 Interface

宿主只传三类信息：

1. **只读模型**：当前目标/修订/标题，语义导航目录，经过投影的个人展示字段、明暗、助手状态。不给完整 Workspace、设置、密钥或 ComponentHost。
2. **语义意图**：页面、系统页、应用的判别联合目标，以及打开助手/命令面板/切明暗。目标由宿主校验并执行，外壳不能调用存储或任意宿主函数。
3. **受控布局事实**：画布尺寸、内容可见区与保留区、允许的 chrome 挂载位置。内容节点归宿主所有，不把 ReactNode 提供给第三方复制或重挂。

示意：

```ts
type NavigationTarget =
  | {kind: 'page'; id: string}
  | {kind: 'system'; name: 'settings' | 'market' | 'monitor'; section?: string}
  | {kind: 'application'; id: string; mode?: 'modal' | 'drawer' | 'page'}
type ShellIntent =
  | {type: 'navigate'; target: NavigationTarget}
  | {type: 'assistant'; placement: 'preferred' | 'panel'}
  | {type: 'command-palette'}
  | {type: 'toggle-color-mode'}
  | {type: 'close-content'}
```

模块内部由外壳 controller 管菜单/封面选择/桌面工作区窗口临时状态，提供 chrome/launcher 与有限 layout descriptor；不是向 App 暴露 setWin98Open 等主题专用方法。应用级窗口的 canonical ID、运行占用、返回目标和保存继续归宿主。

`close-content` 与外壳局部最小化不同：前者由宿主关闭当前工作区所附的打开应用/阅读器并遵循现有返回策略，外壳收起内容窗口；后者只改变可见性并保留运行实例。激活 shell-host 时用当前 Win98 关闭/最小化的公开行为确定精确合同，不把关闭伪装成隐藏或后台常驻。

导航目录由一个纯投影生成，提供入口 ID/kind/label/icon/固定位置意图；各外壳决定封面、桌面、开始菜单或 Rail 的不同展示。宿主接受目标后发布导航修订，外壳自行露出内容窗口并收起启动器。必须包含“打开同一目标”的意图修订，不能只监听 pageId 是否变化，否则在桌面上重新打开当前页不会恢复窗口。

设置业务模型与验证共享。现有 frame、avatar、设置页标题等差异转为少量呈现能力/声明 schema；需要不同设置布局时由可信呈现 Adapter 消费同一模型。不要逐设置行开放任意 render 回调，也不让外壳接触同步/AI密钥。

## 4. 稳定舞台与生命周期

推荐树形关系（示意，不是最终 JSX）：

```text
TrustedHost
├─ PersistentContentStage        固定父节点/容器身份
│  ├─ 当前页面或系统业务内容
│  ├─ 应用运行器及稳定窗口 portal
│  └─ 与内容绑定的装饰/检查根
├─ ShellChromeAndLauncher        可替换的可信外壳
├─ AssistantHost                 保持对话、草稿和执行
└─ TrustedOverlayHost            审批、授权、保存故障与恢复入口
```

不是要求所有系统页永远常驻；正常路由改变继续有原本生命周期。保证的是同一路由下换主题/外壳不额外重建业务树。启用分栏等宽度变化仍沿现有稳定容器方式处理。

| 事件 | 宿主状态 | 外壳状态与清理 |
| --- | --- | --- |
| 同外壳换变体/配色 | route、应用运行器、输入、助手与审批保持 | 不以实例 ID 变化重置菜单/窗口；不必要时不重建 controller |
| 换外壳 | 保留route、当前应用身份/打开方式、输入及助手执行 | 旧菜单、拖动、pointer capture、监听和动画释放；新外壳按受支持布局接管 chrome |
| 显示启动器/最小化 | 内容隐藏但不销毁；隐藏区域 inert/aria，不可被页面检查冒充可见 | 恢复焦点，保留正常恢复入口 |
| 关闭内容 | 与最小化不同，显式关闭应用可以卸载；不删除业务数据 | 发宿主意图，不私自清除应用/会话 |
| 外壳抛错或缺失 | 继续持有业务状态与原设计引用 | 同层错误隔离，回落可操作 chrome；能进设置、助手、停止和恢复 |
| surface 变化 | 保留现有持久数据合同，不额外承诺零重挂 | 不引入与A3无关的新多窗口调度器 |

错误边界不能沙盒化同源代码，也不能阻止无限循环；仅用于可信实现局部渲染故障。第三方执行安全不能靠 ErrorBoundary、少传props或CSS前缀代替。

## 5. 造型与作者目录

数据主题不只有颜色。能力按宿主真正消费的语义组织：

- 基础 token：颜色、字体角色、字号/行高、间距、圆角、边线/阴影、动效与减少动画；颜色/长度/枚举按类型校验。
- recipe：按钮、输入、卡片、列表、tabs 等正常/hover/pressed/focus/disabled 状态的有限参数。涉及元素拓扑改变时由已登记造型实现，不允许任意选择器穿透 UI 库。
- shell config：导航密度、封面比例、任务栏、工作区标题栏、桌面图标、窗口装饰等已实现字段；每个字段声明适用外壳。
- assets：按ID引用受控字体/图片/素材，声明体积、来源、失败后备与可离线性；不将任意url藏在颜色字符串里。

一份目录生成 runtime validator、表单、工具 JSON schema/按需说明和读回诊断。不要为外壳每个字段单写一个 Agent 工具，也不把 UI 表单 schema 误当完整验证器；复杂交叉约束由同一领域模块执行。

动态声明式包首版不接收任意原始 CSS。已打包可信 skin 可以自有作用域 CSS，由宿主适配 Lobe 和稳定语义部件。未来若确需工坊样式文本，另建解析/命名空间/URL白名单与overlay限制，不直接开放 .lobe-* 或宿主审批DOM。

推荐逐步整理 CSS 的职责为 base tokens、宿主控件适配、语义部件、专属 skin/shell；以视觉回归分块迁移，不一次重排全部CSS。新增主题不增加 root skin 选择分支和散落的设置ID枚举。

## 6. 作者模块与预览

一个作者模块隐藏创建/patch/规整/冲突/资源/提交复杂性，UI和Agent走相同 Interface：发现与描述 → 派生草稿 → 校验修改 → 预览 → 应用/取消。具体工具数量跟随真实使用，不先发布8个空工具。

草稿有独立ID/revision和来源主题revision，保存双模式完整设计；patch显式指定mode或shell字段，未知字段整次失败。应用只比较受影响主题及定义/能力依赖，不因用户改了无关待办而盲目整工作空间冲突；成功基于最新workspace一次合并提交。切换当前主题期间的新操作也需明确是否仍应用原变体，默认冲突保留草稿，不自动改变新选择。

预览使用不初始化真实存储/同步/AI的宿主预览入口，可在隔离文档中渲染固定控件、设置、窗口与外壳夹具。准备主题变量、字体和 portal 必须作用于预览文档；正式 html 根不被临时覆盖。不创建第二份真实 Applet/App/计时器/后台请求。

不直接扩大 homepageDraft：它仍只负责静态首页布局。主题预览先采用静态典型界面，明确不含全部应用业务状态；有限DOM检查只能报告可测几何，颜色/审美通过真实截图与人工观察另验。

准备资源失败、取消、过期草稿不能提交。正在审批或正在执行Agent时切主题，审批ID/发送锁及停止路径必须保持A1/A2保证。

## 7. 本地包与后续插件

包阶段才落地 manifest/资源库：`packageId/version/digest/kind/schemaVersion/requiredRenderers/contributions/assets`，其中 kind/贡献类型验证内容，不将任意JS当图片资源执行。包版本不可变；变体revision、schema版本、renderer合同版本、包版本各自负责不同变化。

安装是验证并保存不可变内容，启用才改工作空间选择。不能宣称跨配置存储和资源库完全原子：先准备资源，再一次启用引用；失败时保持旧主题，孤立准备资源按回收规则清理。升级先安装新版本再显式启用，不能覆盖仍被引用的旧资源。

缺包/停用/不兼容都保留用户选择和合法payload，实际渲染回退与请求引用分开。动态包带来的陌生类型以有大小/JSON限制的envelope保存，不能因为renderer未就绪而过滤；损坏数据仍拒绝/隔离。这个新模型只在动态引用进入时扩展，不顺带改静态内置组件所有读取语义。

停用/卸载先让活动主题回退到可用定义，再解除运行资源；仍被变体/模板引用的版本要保留依赖快照或阻止删除，不能默默留下坏引用。插件停用与删业务数据分开；主题激活撤销不会自动撤销安装包或已发生外部副作用。

资源体积与文件数、MIME、路径/遍历、对象URL、网络/字体失败等有明确预算和错误。全量备份是否含包资源由包阶段明确；配置同步至少保留依赖引用和状态，不把缺资源解释成已完整跨设备恢复。设备授权不随同步授予。

第三方代码扩展后续单独建设runner：会话身份、postMessage来源、能力声明/授予/宿主执行检查、数据命名空间、取消/停止、保存回执及资源限制。普通App/Applet可以承载应用型贡献；完整桌面交互需要新的受限Shell协议，不能跨iframe传宿主ReactNode。Web和MV3按实际CSP验证，开发者模式不等于商店可分发。

## 8. 不采用的近期方案

- 不一次实现“任意桌面JSON DSL”，先用已有外壳提取真实配置；新表达力按作者需求增加。
- 不做同源远端React执行，受信宿主外壳随构建发布；隔离扩展与声明式包分层。
- 不开多层主题继承、自由mixin、通用全局event bus、万能plugin context或多窗口任务系统。
- 不依赖删除旧测试来隐藏退化；将脆弱ID/数组顺序断言改为新公开行为，并保留真实输入/状态/布局验收。

## 9. 主要风险和验证策略

| 风险 | 验证 |
| --- | --- |
| 主题另存丢造型/值被遮盖 | 所有内置主题派生后读有效值和来源；双模式、共享参数、字体完整 |
| 新字段只改TS未改真实数据路径 | 重载、模板、备份恢复、快照与增量同步统一往返；缺依赖保留 |
| 换Shell重挂内容、双起运行器 | 真实DOM/输入身份、init/请求计数、canonical ID、助手草稿、待决审批 |
| 全局CSS/portal污染预览 | 正式和预览同时不同主题；toast/modal/drawer/window均归属明确 |
| 导航同目标不能恢复/焦点不可达 | 同目标重复打开、桌面恢复、菜单键盘、删除当前目标回退 |
| 新外壳仍需改App | 测试用第四Adapter仅改注册和自身实现，宿主不加ID分支 |
| 外壳失败阻断恢复 | 同层fallback可进设置/助手/停止，主题原记录和业务数据不丢 |

回滚按纵向子任务提交还原；不清数据、不改真实远端。若实现改变了存储结构，先使用隔离fixture验证新模型并记录格式变化，不能用旧快照恢复冒充迁移测试。
