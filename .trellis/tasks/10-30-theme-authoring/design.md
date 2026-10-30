# 主题作者与隔离预览具体设计

状态：待主会话审读与激活；不是已交付合同。前置为 theme-identity 与 shell-host。本文基于当前源码，旧 research 中丢 skin/shell、模板误选和 Switch 舞台卸载已由前项解决，不再作为本项待修缺陷。

## 1. 最小完整切片

一次完成「发现真实能力 → 基于已安装主题创建内存草稿 → 按明确作用域修改 → 在独立文档预览 → 用户确认后一次应用或取消」。支持颜色/尺寸/字体、按钮与输入的有限 recipe，以及 Switch 封面比例、Win98 窗口间距两个确实被当前实现消费的外壳参数。不开放任意 CSS/选择器/JSX/代码，不做图片上传、资源包或工坊安装器。

保留 `ThemeEntry.overrides/light/dark/fonts` 和 skin/shell/origin 的完整快照方向。新增两个有真实消费者的可选字段：

```ts
type ThemeRecipes = {
  button?: {radius?: number}
  input?: {radius?: number}
}
type ThemeShellConfig = {coverScale?: number; windowGap?: number}
// ThemeEntry 增加 recipes?: ThemeRecipes; shellConfig?: ThemeShellConfig
```

radius 为 px、0–24；不新增已有控件可自行处理的 focus ring 参数。coverScale 为百分比整数、80–120，仅 switch；windowGap 为 px 整数、4–40，仅 win98。无消费的字段不先建立。shellConfig 单层且按 shell 验证；混入不适用字段整次拒绝，不悄悄忽略。模式无关；以后真正需要每模式 shell config 再扩展，不预置任意 JSON。

recipes 是主题语义，覆盖宿主普通业务控件的圆角形状；不改 Switch 封面按钮、Win98 标题栏等专属 chrome 的结构与安全控制。明确作用于 `.lobe-button/.btn`、`.lobe-input/.ios-input` 这些现有稳定宿主部件，不承诺所有第三方应用 iframe 内部都消费。默认缺省保持原 skin 造型；显式值由最后加载的宿主 adapter CSS 消费，不能写入后被 skin 的固定 radius 静默遮盖。

新增字段需要更新所有 ThemeEntry unknown 边界、clone/read/save/tweak/template/backup/sync/增量路径及相等判断；工作空间版本升一位表达新正式格式，不增加旧版本迁移桥。已有字段不改名、不引入双份 tokens 数据。草稿 revision 不要求所有正式 ThemeEntry 增加 revision：正式设计冲突用规范化 fingerprint 足够，避免再维护两套修改计数。

## 2. 单字段目录

新增 `src/lib/themeAuthoring/catalog.ts`；每项定义 `path/group/label/description/type/scopes/range-or-enum/skins-or-shells/storage/cssBinding`，目录版本为明确常量。validator、表单、Agent JSON schema、按需说明与有效值来源均从此目录生成，不能把一套 UI schema 当成另一套独立的运行 validator。

首期字段表是实施合同，不把「所有 CSS 变量」当可写能力：

| 组 | 字段与类型 | 作用域/消费 |
| --- | --- | --- |
| 基础色 | bg/bg2/bg3/text/text2/text3/text4/border/rule/main | light/dark/both；已有 root/Lobe 映射 |
| 布局 | radius 0–24px、radius-lg 0–32px、gutter 8–48px、side-width 64–120px | shared；已有布局变量 |
| 外框 | frame/frame-gap 0–16px、frame-color | shared；只对目录 frame 能力非 none 开放；frameOff 用户偏好仍最后生效并读回来源 |
| 字体栈 | font-sans/font-serif/font-mono | shared；仅系统栈 ID、目录字体引用或受控 `var(--font-sans)` 别名；不接受任意 CSS 文本 |
| Switch 色 | 当前内置所有 switch-* 色（red/blue/amber/muted/cover-ink/avatar/avatar-ink/cover-blue/red/green/amber/violet/focus/orb） | shared 或 light/dark/both；仅 switch；已有具体选择器 |
| Win98 色 | 当前内置所有 win98-* 色（desktop/face/field/light/shadow/dark/title/title-end/title-text/selection/selection-text） | light/dark/both；仅 win98；已有桌面/窗口/选中态 |
| recipes | button.radius/input.radius | recipe，无 mode；正式 CSS 与预览同 adapter |
| shell | coverScale/windowGap | shell，无 mode；分别由 Switch CSS、Win98 几何 controller 真正消费 |
| 资源 | fonts 数组，沿用 family/role，最多4项 | resource，无 mode；受控字体加载与明确系统后备 |

目录必须覆盖内置预设实际存下的全部字段，保持 builtin 也能通过同一校验；比如内置 font-serif 的受控别名不是 arbitrary 字符串。色彩支持明确的有限语法：hex 3/4/6/8、范围有效的 rgb/rgba、hsl/hsla、oklch 与 transparent；实现纯解析并验证数值范围，不借 DOM `CSS.supports` 才能验证。禁止 url、env、calc、任意 var 引用和未闭合函数；frame-color 可引用 main，font-serif 可引用 font-sans 等目录有向别名，拒循环。尺寸作者输入为数值，保存为规范 px；读取既有字段只接受目录支持的完整值，不添加猜测模式/旧格式分支。

当前 `legacyMode/normalizeEntry` 按背景推测旧 overrides 归属应删除。新作者颜色只允许明确 light/dark/both，both 在两分支写同名值；原工具 shared main 的快捷语义如保留也通过同目录转换为 both，不能再形成隐式 mode 优先级。资源/font 字段与生成的 font-* 不重复写；同请求冲突时明确拒绝，避免最后一个写赢。

`describeThemeSchema({themeRef?,group?})` 返回适用字段、限制、当前两模式有效值和来源、资源状态及 renderer/catalog 版本。未消费字段、未知 key、错 scope、越界和跨字段约束整次失败。错误包含精确 path、reason 与建议合法 scope；不把变量成功保存说成已通过视觉检查。

## 3. 草稿事务与冲突

新增作者深模块 `src/lib/themeAuthoring/`。领域纯函数负责创建/patch/验证/构建提交结果；一层内存 store 负责订阅和唯一正式 commit。UI/工具不能直接拼 workspace。沿用单个当前草稿，已有草稿先读或取消，禁止悄悄覆盖。

```ts
type ThemeDraft = {
  id: string
  revision: number
  intent: 'derive' | 'edit'
  sourceId: string
  sourceFingerprint: string
  selectedIdAtCreate: string
  selectionGeneration: number
  dependenciesFingerprint: string
  theme: ThemeEntry
}
type ThemePatchOperation = {
  path: string
  scope: 'shared' | 'light' | 'dark' | 'both' | 'recipe' | 'shell' | 'resource'
  value: unknown | null // null 删除该显式值，回到目录/skin 默认
}
```

创建显式选择 intent：derive 生成新完整变体；edit 只允许现有非 builtin，最终替换该条。UI 默认 derive，不用含糊 id 参数猜操作。源 snapshot 完整复制已有语义设计，origin 仅溯源；元数据 name/description 可随草稿修改并按现有长度校验。mode 偏好保持当前用户实际明暗，不因基于 Switch 草稿而重新套用其 dark 默认。派生最终 ID 在 commit 最新库中分配，处理期间新增同名主题；不预占正式库 ID，不在 create/patch 写 history。

每个修改必须 `draftId/expectedRevision`。一次最多32项，path+scope 不重复；先 clone 并校验全部，再替换草稿、revision+1。失败不部分更新，不改变旧 readiness；成功使旧预览/资源检查失效。取消也校验当前 ID/revision，清内存/preview lease，零正式 commit。刷新丢弃，UI明确提示。

fingerprint 对对象 key 排序、数组保留顺序，包含源完整设计、名称说明、renderer 引用与新增字段。依赖指纹只覆盖目录/renderer合同版本、当前主题实际引用字体及适用能力，不把无关 todo、页面、聊天或全库变化当冲突。selectionGeneration 订阅 active ID 变化递增，能发现 A→B→A；明暗切换/临时 frameOff 不当作换选中主题，最终沿用最新用户偏好。

apply 流程为：读取草稿最新revision → 校验设计/能力 → 等待资源和当前revision预览准备 → **在await之后再次**取最新 workspace、验证草稿revision/源fingerprint/selectionGeneration/依赖指纹 → 在最新workspace只合并目标主题与 active 选择 → 同步调用正式 `commit(next)` 一次。检查与 commit 之间无 await，失败保留草稿；edit 的源被删/改、derive 的源被改、选择切换、依赖变更均拒绝并解释。无 force、自动合并主题或静默重建。无关业务编辑保留。一次undo恢复先前主题和选择，不试图撤销网络已发生请求。

## 4. 隔离预览与资源

新增正式 `theme-preview.html` / `src/themePreview.tsx` 多入口，由 Web 与 MV3 同一构建产物提供。iframe 加载可信打包代码，使用独立 document/root/portal/font scope；不载 App、业务 registry、workspace store 初始化、sync、analytics、AI 或 ApplicationHost。预览数据只含草稿设计、模式、viewport与无私有数据的固定夹具，不传 workspace、密钥、待办文本、生成应用源码。

这是可信代码的文档隔离，不是第三方执行沙盒。iframe 可用 `sandbox="allow-scripts allow-same-origin"` 以支持正式打包入口和同源资源；不加载用户JS，不把两项 sandbox 权限宣称成敌对代码隔离。MV3 不使用 inline/eval/blob module 脚本或远端脚本；构建显式包含预览 HTML/JS/CSS，CSP 用现有 extension_pages 自身脚本政策。若实施发现该方案与真实MV3冲突，修打包入口，不降为污染正式 html 的预览。

父子消息限定 exact iframe.contentWindow + 预期 origin、随机 channel、draftId/revision/requestId；普通 JSON schema 校验和大小预算（64KiB），禁止任意HTML/CSS/URL或函数。父级从正式 catalog 校验后投影，子级再次校验，不采信任意来源 readiness。迟到回执丢弃；取消/换稿/iframe重载清 lease，检查超时返回 unavailable。预览内部可切浅深、1440/390/320与窄分栏宽度，viewport 是夹具尺寸不改变正式窗口。

静态夹具覆盖真实 Lobe Button/Input/Segmented/禁用/hover展示/focus状态、典型设置行/卡片，以及静态 modal/drawer/toast/window、Switch封面/Win98标题栏与任务栏展示。静态结构复用正式 style adapter/小型纯presenter，禁止启动正式 Shell controller 的电池/在线监听，更不运行第二份真实应用。Lobe portal 容器与 ConfigProvider 归 iframe 自己 document，modal/drawer/toast 不能落父body。夹具受控按钮只演示状态，不调用业务动作。

字体首期只提供「系统后备」与现有结构化 Google Fonts family/role，不新增空 assets/图片资源字段。使用 document-scoped 字体 lease 代替当前全局 `loaded` Map；正式和preview互不卸对方 link。family 严格现有格式，不允许 URL、@font-face 或CSS资源逃逸；地址固定 fonts.googleapis.com，实际字体仅 fonts.gstatic.com。系统栈无需网络。移除两份全局 CSS @import 的不可追踪加载，默认外观网络字体由统一受控加载承担并保留系统fallback。

资源准备须同时处理 stylesheet onload/onerror、FontFaceSet 实际加载和限时失败，不能仅 link.onload 就宣称字体已可用。网络/404/CSP/超时明确显示 family 与失败原因；预览继续用系统后备并标记降级，**apply 不得将该revision标为准备成功**。用户可明确把fonts设为空/系统后备后重试；不能自动删用户字体或自动改正式主题。已有正式主题离线使用仍按系统后备显示，不能因为作者预览失败回写主题。字体字节由浏览器控制，首期不承诺下载字节精确预算；family最多4、请求时限、同时加载数及lease清理有上限，包资源字节预算放下项。

apply 前字体资源在正式 document 以未接管全局变量的 lease 预备，成功后复用lease再commit，失败不动原主题。引用同名family去重但按consumer计数；A→B→A迟到错误不能卸载新lease。动态编辑时资源检查只接受当前revision；取消释放作者临时lease，不动正式主题lease。

## 5. Agent 与 UI 的准确范围

六个新工具，避免逐字段/逐外壳工具，同时不做一个巨大 action union：

| 工具 | 合同/效果 |
| --- | --- |
| describe_theme_schema | read；按themeRef/group发现适用目录、有效来源、资源/preview限制 |
| create_theme_draft | write内存；from、intent、name?；不改正式主题，返回id/revision |
| get_theme_draft | read；当前草稿设计、diff、冲突/readiness；无草稿返回null |
| update_theme_draft | write内存；id/expectedRevision/operations+可选name/description；目录生成明确patch schema |
| inspect_theme_draft | read；要求当前id/revision；让可见iframe准备并测有限几何/资源，返回unavailable也明确失败原因，不静默应用 |
| finish_theme_draft | write；id/expectedRevision/action=apply或discard；沿用现有纯主题工具 effect=write/highRisk=false；apply前用户明确要求应用或点击Apply，discard不正式写 |

finish 的 JSON schema 为判别 action。纯主题操作与现有 set/save/apply_theme 同级，不凭本设计增加一道工具审批，也不增加“显式确认”免审标志绕过框架。UI 的 Apply 按钮是明确应用动作；Agent 在用户要求先预览时遵守这一范围，不自行应用，用户确认后调用同一个领域入口；调用时仍重新核对 revision。工具内部抛领域错误，保持A1/A2失败事件与停止/取消机制；resource/preview等待观察 signal，停止不会随后异步commit。Agent不需要额外“开启预览”工具：create自动显示，patch更新，inspect等当前版本ready。

现有 apply_theme/删除/切mode仍负责已保存主题与偏好；set_theme/save_theme 必须消费同 catalog 校验，不能作为未知字段绕过口。保留已有明确即时局部编辑能力以免无关调用退化，但主提示将完整主题创作导向草稿，不把即时commit说成预览。runtime design-system保留原路径/单正文，按需发现目录替代长段穷举所有theme专属变量。

设置页新增「创建变体/编辑方案」入口及同一草稿面板：元数据、共享/浅色/深色、recipe、适用shell、字体组均由目录渲染。表单不能重复定义范围。正式主题与草稿状态区分，应用前能看到diff、冲突与降级原因；取消关闭preview。主题预览与现有首页草稿可并存，各自保留UI/事务，不套用homepageDraftWorkspace覆盖真实App。

## 6. 验收与边界

纯领域/真实工具回归覆盖全builtin目录、拼错/错scope/错skin/范围/别名循环/混合非法整批失败、同一schema的表单/tool约束、双模式有效来源、全部存储往返。事务测试覆盖revision、源改名/删除、A→B→A、异步资源后再冲突、无关业务编辑保留、一次undo、取消零历史、停止零迟到commit。

真实浏览器同时保持正式iOS与预览Switch/Win98不同色/模式，检查父root/inline/font links、overlay/portal归属、业务init/保存/网络计数不增加；全双模式/窄容器/减少动画、字体404/离线/迟到与恢复。测试既看配置又看真实computedStyle/geometry与截图；inspect报告仅schema、资源与有限几何，颜色可读性/审美/全部应用内部为unknown。Web/MV3分别真实加载预览入口，不能只声称build文件存在。

本设计待审读；主会话激活后实施，检查与本地提交归档沿当前授权执行。不推送、不清数据、不接真实远端。
