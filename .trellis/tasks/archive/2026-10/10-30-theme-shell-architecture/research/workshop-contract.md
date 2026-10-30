# Research: 创意工坊与热插拔合同

- Query: 当前主题与应用机制如何演进为可热插拔主题/插件，哪些应在 A3 建立，哪些必须延后？
- Scope: mixed（仓库事实为主；Chrome 扩展平台限制核对官方文档）
- Date: 2026-10-30
- Baseline: `27358e2`。本文件是设计研究，不代表已实现或已接受。

## Findings

### 1. 现有系统有可复用的隔离和身份基础，但没有通用包运行时

| 文件与位置 | 当前事实 | 对未来工坊的含义 |
| --- | --- | --- |
| `src/lib/registry.ts:81-119` | 组件定义聚合名称、配置 schema、默认值、React 组件和形态；注册仅 `Map.set`。 | schema 目录是作者/Agent 共用的好基础，但无重复注册拒绝、卸载或变更订阅；不能当作动态插件注册器直接复用。 |
| `src/widgets/index.ts:1-27`、`src/lib/workspace.ts:20-48` | 组件按固定 import 顺序自注册；类型是内置联合与 `custom:*`。 | 当前是编译期功能注册，第三方运行器/宿主 React 组件尚未实现。 |
| `src/lib/market.ts:12-39,158-180` | 市场是含 React 图标引用、内置类型、安装页面和设置入口的静态目录；安装状态只是 addons ID。 | “把目录换成远端 JSON”只能分发元数据/配方，不能令未打包代码突然可执行，也不是完整安装协议。 |
| `src/lib/workspace.ts:90-116`、`src/lib/applications.ts:192-215,237-240` | 应用安装记录与展示位置分开，canonical ID 跨运行形态复用；卸载移除入口但保留私有数据。 | 可沿用“安装项身份、运行实例身份、数据身份分开”的思想；包 ID 不能代替安装实例 ID。 |
| `src/lib/applicationDataSchema.ts:2,46-79`、`src/lib/applicationData.ts:27-31,53-90` | 数据按 `app:id` / `applet:id` 隔离，写入等事务确认，失败保留最新 pending；数据类型目前明确限两类。 | 插件数据不能挤进裸组件 ID 或任意 `fp.*`；新增类别须显式扩充数据、备份、同步合同。 |

### 2. 热插拔前首先要解决“缺包被当成坏数据删除”

- `src/lib/workspaceStore.ts:51-70` 在读取时按当前 registry 和 widgets 过滤组件；注册晚到、包被禁用或尚未下载，都可能令合法未知实例从内存工作空间消失，随后保存可固化丢失。
- `src/lib/workspaceStore.ts:118-151` 用同一 migrate 规整模板，模板也受加载顺序影响；`168-172` 只保留已知 addon ID。
- `src/lib/applications.ts:85-107` 仅承认 `app/applet`，解析失败或运行器不可用记录直接跳过。当前合同有合理静态前提，不能直接推广至动态扩展。
- `src/components/PageView.tsx:108-110` 已有“未知组件”占位，`src/components/ApplicationHost.tsx:29-35` 已有“运行器不可用”，但这些渲染占位不能补救上游读取时已经被删除的记录。
- `src/lib/themes.ts:85-105` 只读取固定主题字段，并注入内置定义；`src/lib/workspaceStore.ts:195-197` 活动主题不存在则回退。未来应区分“请求使用的主题/包”与“当前实际回退外观”，回退不能覆盖原引用。

**提案：** 在第一次引入动态外部引用的同时实现缺包保留。结构校验先验证包引用与通用实例 envelope，运行器解析后再校验本类 payload；未知但合法的 payload 原样保存、导出、同步，显示 unavailable/disabled/incompatible，不执行。不要无条件接受任意 JSON：未知插件 payload 仍受 JSON 类型、体积和引用规则限制。损坏数据继续明确拒绝或隔离，不把损坏与缺包混为一谈。

### 3. 四种扩展的自由度与热加载不是一回事

| 类型 | 适合的运行形态 | 现有能力与真实限制 | 推荐演进 |
| --- | --- | --- | --- |
| 数据主题：配色、字体、材质、密度与参数 | 导入数据后立即切换 | `ThemeEntry` 已可保存/撤销；主题 vars 可传到 App iframe，见 `src/widgets/app.tsx:283-292`。 | A3 首选；主题记录引用稳定 shell/skin 身份，由宿主解释数据，不将 JS 作为主题字段执行。 |
| 声明式桌面组合：导航位置、受控区域、Dock 与部件组合 | 宿主 renderer 解释 JSON 后立即切换 | Applet 已证明“逻辑隔离、宿主渲染 JSON UI”路线，但其目录是应用内容目录，不能直接等同桌面 Shell 目录（`src/lib/applet/runner.ts:6-10,204-217`）。 | 建立面向桌面的少量受控组合与 schema，用现有普通/Switch/Win98 验证真实变化；不提前造无限组件树。 |
| 可信代码 Shell：自定义宿主导航、窗口编排 | 编译进宿主、由注册表切换 | React renderer 可深定制，但获得同源运行权限；当前扩展主页 CSP 不允许远端 JS（`browser-extension/manifest.json:39-42`）。 | A3 先做静态可信 adapters；“开发者新增实现，重新构建发布”与“用户导入数据立即启用”明确区分。 |
| 第三方任意 JS 插件/主题 | 隔离应用；或将来单独的受限 Shell runner | 当前 App/Applet 支持隔离逻辑与 HTML，不能在父宿主插入任意 React component、访问真实 DOM slot 或获得扩展 API。 | 应用型插件可沿现有隔离运行器扩展；整桌面任意代码是另一项高成本产品/信任决策，不作为 A3 顺带功能。 |

“热插拔”建议在产品层拆成可观察合同：**无需重载地安装数据并启用/禁用/切换**、**运行实例停启**、**代码版本更新**分别验证。开发环境 HMR、换一份配置、替换已执行模块不是同一个保证。

### 4. 沙盒基础值得复用，但不能作为宿主插件的授权证明

- App 文档 CSP `connect-src 'none'`、`frame-src 'none'`；脚本只允许内联与既有 ESM CDN，图片/媒体有域名限制（`src/widgets/app.tsx:143-169`）。iframe 无 `allow-same-origin`（`348-354`）。
- Applet 只在隔离逻辑 iframe 内执行 JS，向宿主传 UI JSON；逻辑网络也禁直连（`src/lib/applet/runner.ts:204-217`）。
- App 宿主检查 iframe `source`、session 与递增请求号，防旧会话回复或重复写（`src/widgets/app.tsx:294-325`）；Applet 保存、call 分别校验会话/序号（`src/widgets/applet.tsx:108-170`）。这些规则应在未来 runner 复用，不能只看消息里的包 ID。
- 当前网络授权是 `host.networkGrants`，不是包级 capability；App/产物通过桥接获取 fetch/copy/ask 等固定能力（`src/widgets/app.tsx:175-206,226-254`；`src/widgets/applet.tsx:24-49`）。不能由“已允许某个域名”推导出“此包已被授予所有宿主功能”。
- App 普通主题变化通过消息更新而不重启程序，代码/设置/形态或权限收紧会重建 session（`src/widgets/app.tsx:270-292`）；Applet 主题与设置、尺寸走上下文消息（`src/widgets/applet.tsx:73-79,182-190`）。A3 应维护这些生命周期，不因换 Shell 无意创建第二份业务运行器。
- `WidgetBoundary` 隔离 React 渲染错误（`src/components/WidgetBoundary.tsx:20-52`），App/Applet 报告脚本错误；未发现通用插件的 CPU/内存预算、终止协议、资源撤销登记。不得将现有错误展示宣传成任意代码的完整资源隔离。

### 5. 两个最小架构方案

| | 方案 A：可信 Shell adapters + 数据主题包（推荐先做） | 方案 B：受限声明式 Shell + 隔离逻辑插件 |
| --- | --- | --- |
| 作者能力 | 开发者在仓库实现新 Shell；用户/Agent 自由修改公开参数与受控组合。 | 用户/Agent 用桌面区域 schema 编排，特殊逻辑在 sandbox，通过明确动作桥接。 |
| 接口复杂度 | 小：描述 shell 能力/参数、渲染必要插槽、暴露语义动作；业务运行所有权留宿主。 | 较大：桌面 UI 协议、焦点/键盘/拖放/菜单/窗口布局、事件路由、版本和回执都需定义。 |
| 深度上限 | 新交互要宿主实现发布；现有 Switch/Win98 足以检验 seam。 | 受目录限制；任意像素和全新交互仍需扩展目录或隔离全屏HTML。 |
| Web/扩展 | 数据热切换均可统一；代码更新通过正常应用/扩展发布。 | 数据 renderer 可统一；沙盒仍不能拿父DOM和扩展权限，要逐能力桥接。 |
| 近期价值 | 直接改善新增主题、Agent另存定制、现有CSS/状态耦合。 | 更接近低代码工坊，但先定义全面协议会放大 A3 风险。 |

建议先 A，接口用真实 adapters 驱动；待工坊作者确实需要“无需修改宿主的新交互”时，在同一数据包 envelope 下增加 B 的受限贡献类型。二者共用包身份/验证/安装状态，但不强行共用所有执行过程。

### 6. 近期应建立与后延的合同

**A3 近期：**

1. 稳定主题实例 ID、shell/skin 引用与参数 schema 分开；内置 adapter 声明支持的配置、slots 与回退行为。不要用主题记录 ID 判断外壳。
2. 对启用主题执行完整验证、解析依赖、准备资源，再一次提交；准备失败保持当前主题。预览不可获得编辑业务数据能力；取消释放资源且不提交，应用检查观察的 revision。
3. CSS/字体资源有包作用域和显式 dispose，主题切换清理旧 style、字体/对象URL、监听/动画；overlay/portal 使用同一主题根。宿主必须有不会被包遮住的设置/恢复入口。
4. 版本概念先收窄为 `schemaVersion` 与宿主支持的 shell 合同版本；能力来自已安装/受信实现的目录，不接受 JSON 自称支持某动作。
5. 生命周期明确：换视觉不重启业务应用；换 Shell 不能偷偷复制应用、重置 canonical ID 或删除数据。必须重挂载的行为诚实定义并测输入/已保存状态。

**首次本地主题包导入时再做：**

- 最小 manifest：包身份、包版本/内容摘要、包种类、数据 schema 版本、所需 shell ID/合同版本、主题定义入口与受控资源清单。包版本与用户 fork 的主题实例 revision 分开。
- 安装/启用/禁用/卸载状态分开；升级先验证后切换，失败保留旧可运行版本；被引用或正在运行的包先停用/切回回退，再解除资源。
- 缺包保留与依赖诊断；导入、模板、备份、同步统一校验包引用；新设备缺少代码时明确提示安装，不自动执行远端代码。
- 包资源体积、MIME、路径规范化与遍历校验；内容摘要保证缓存/版本一致，不能把摘要当作作者可信身份。纯外观包不默认声明网络/存储权限。

**首次可执行第三方插件时才做：**

- 独立 runner 类型和消息版本；每包能力声明 + 用户授权 + 每次宿主执行检查；按安装实例命名空间保存数据。
- 启动/停止/更新/停用的幂等清理，终止旧 session、取消待决请求、等待已接受保存；关闭后不宣称后台持续运行。
- 权限升级重新征求授权、资源/运行限制和故障恢复；可信代码与非可信代码显示不同安装含义，不允许把第三方JS作为“主题资源”绕过。

**在线创意工坊服务以后：** 搜索/评价/作者账号/审核/交易、签名信任链、更新通道、依赖解析器和多版本并存。当前没有需求证据支持现在引入通用 SDK 或包管理系统。

### 7. 备份与同步必须跟随扩展数据定义

当前备份可保存 `fp.*` 配置原文，但恢复后工作空间仍经过 migrate，未知组件的丢失没有被原文备份自动解决（`src/lib/storage.ts:65-93,132-135`）。同步的 `config:workspace` 顶层显式字段表没有 packages/安装清单等字段，应用 type 也限制 app/applet（`src/lib/syncData.ts:110-115,136-157`）；增量配置复用同一基础校验（`src/lib/incrementalConfigSchema.ts:17-18,57,64-77`）。

**提案：** A3 改数据字段时同时更新持久化读写、主题导入导出、模板、快照和增量同步校验。包二进制资源库是否随全备份/同步携带须单独定义；未定义前不能承诺换设备即离线完整恢复外部包。设备授权不随包或同步授予另一设备。

## 必须由用户决定的产品选择

后续决策：用户已确认“声明式主题 + 单独授权并隔离的代码扩展”，见 ADR 0005。以下保留提问时的取舍背景；该问题已解决，不是当前阻塞项。

最高价值选择是工坊的**深度自由度和信任级别**：第一版是否允许第三方代码替换整个桌面导航/窗口交互，还是先让第三方发布数据主题/受控组合、应用逻辑继续跑沙盒？

推荐后者作为首个可发布阶段，A3 仍可支持开发者在仓库新增完全不同的可信 Shell。前者不是多加一个 manifest：它会改变宿主可访问性、权限与 Web/MV3 共用方式，通常需要独立隔离 Shell 协议与恢复模式；把“下载即执行同源 React”当热插拔默认值会推翻当前沙盒模型。

## 外部参考与版本

2026-10-30 通过 Context7 核对 Chrome 官方文档 `/websites/developer_chrome_extensions`：

- [Manifest sandbox](https://developer.chrome.com/docs/extensions/reference/manifest/sandbox)：sandbox 使用独立 origin；不能访问扩展 API 或直接访问非沙盒页面，通过 postMessage 通信，独立 CSP。
- [Manifest CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)：extension pages 最低 CSP 不能放开 unsafe-eval，需放宽执行限制时使用 sandbox。
- [Improve extension security](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security)：MV3 extension_pages 脚本来源收窄；Chrome Web Store 的远端代码政策与 sandbox 技术机制是分别需要核对的问题。

本项目 manifest 目标 MV3、minimum Chrome 120，见 `browser-extension/manifest.json:2-6`。本轮没有申请商店审核，不承诺未来任意工坊代码方案满足审核要求。开发者模式可运行不自动表示商店可分发。

## 相关规范

- `.trellis/spec/ai/tools-and-apps.md`：工具异常、取消、App/Applet能力与协议归属。
- `.trellis/spec/frontend/state-management.md`：状态与数据身份、保存确认、备份和同步边界。
- `docs/specs/browser-extension.md`：可信扩展主页、sandbox、网络权限与单运行实例。
- `docs/specs/runtime-contract.md`：当前主题、应用运行形态及保存生命周期。
- `GLOSSARY.md`：主题、应用、模板与组件市场的当前术语，未来“工坊包/插件”尚未形成已接受定义。

## Caveats / Not Found

- 仅只读审查代码和官方平台文档，未运行浏览器验证或安装第三方包；没有修改产品源码、规范或现有数据。
- 未发现通用包 manifest、加载器、unregister、依赖版本协商、包级 capability 或工坊服务。上述接口均是提案。
- 没有把当前 App/Applet 错误提示当成强 CPU/内存隔离保证，也未发现对任意代码 Shell 的完整恢复机制。
- 当前仓库消费外部 agent 与同步 SDK；本研究没有审查这些外部仓库。
