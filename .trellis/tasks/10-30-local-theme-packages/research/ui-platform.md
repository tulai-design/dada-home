# 本地主题包 UI、预览与 Web/MV3 平台接入研究

研究日期：2026-10-30。代码基线：`7fa143a`。本文件只读审查并给出具体集成建议，未修改产品、启动浏览器或宣称主题包已实现。包格式、额度和领域 API 以本任务后续审读的 design 为准。

## 1. 当前可复用边界

| 现有位置 | 已有行为 | 本项接入含义 |
| --- | --- | --- |
| `src/components/ThemeSettings.tsx:28` | 外观页在 `useAppSettings` 下显示明暗、frame能力、装饰、主题库 | 新增独立「本地主题包」组，保留已有主题作者入口；主题行显示包归属和可用性，不用主题实例ID推断包 |
| `src/components/ThemeSettings.tsx:103` | UI创建/编辑按钮带 `theme-author-entry`，作者面板据此移焦点 | 包主题进入作者仍走同一个 create draft API；不另做包专属编辑器 |
| `src/components/SettingsPage.tsx:95` | 备份先 `file.size` 限额，再 `text()`、parse、摘要Modal | 复用文件选择与摘要模式，但主题包安装不是全量备份替换，不能调用 `importBackup` 或刷新页面 |
| `src/components/SettingsPage.tsx:58` | Blob下载、临时anchor、revokeObjectURL | 主题包JSON导出可沿用；只导出显式选择的主题与精确资源闭包，不读设备密钥/聊天/权限 |
| `src/components/TemplateSettings.tsx:42` | 领域预校验、错误留在表单、成功才关闭 | 包导入/卸载也应保留失败输入与明确路径原因；安装失败不先关闭摘要面板或清旧安装 |
| `src/App.tsx:837` | 作者面板稳定挂在业务host下，和设置页是否打开无关 | 包资源变化应使已有草稿检查失效，不能key整个App、重挂应用或重置助手 |
| `src/components/ThemeAuthoringPanel.tsx:128` | preview readiness与正式document字体预备合并为port.prepare | 包字体仍使用同一prepare/lease；不能绕过当前revision、source/dependency冲突检查 |
| `src/lib/fonts.ts:77,134` | document-scoped字体lease，按family引用计数；目前来源只有Google CSS | 新增本地来源必须扩展lease身份为来源内容引用，不可仅按同名family去重，也不能缺包时退回Google |
| `src/lib/themeAuthoring/previewProtocol.ts:5,9` | render控制消息64KiB，只携带ThemeEntry与mode/width | 不能把base64字体塞进现有ThemeEntry/render消息；需要独立且有预算的资源传输边界 |
| `src/lib/shell/theme.ts:5` | 实际外壳fault回落可信基础paper，请求对象保留 | 包availability应由共享resolver纳入有效渲染策略，不能只在Settings藏行或把请求改写default |

作者表单、范围与错误仍由现有catalog/validator产生。安装UI只解释manifest/依赖/资源和状态，不复制主题字段schema。现有Lobe Select会丢弃传入的aria-label，作者面板已使用显式label/id；新包主题选择同样使用这一模式。

## 2. 建议的最小完整用户流程

外观页在主题库附近增加「本地主题包」组，说明「只导入本地声明式设计与字体；安装后可选择启用」。不新增在线工坊入口、账户、网络下载或代码授权按钮。

1. **导入**：点击「导入主题包」，选择单个JSON；在读取前检查文件字节，读取后交领域纯parser/validator。重新选择同一文件需清空file input值。校验不通过显示字段路径和原因，当前主题及旧包保持。
2. **检查并安装**：摘要显示名称、ID、不可变版本、摘要、主题数量、资源种类/解码字节、宿主合同依赖及当前兼容性。按钮明确「安装，不切换主题」。摘要是完整性指纹，不显示成「认证作者」或「安全认证」。初次安装与新版本替换都走同一验证/准备入口。
3. **启用**：已安装包卡显示「已安装 · 未启用」与启用按钮；启用需要资源准备成功，失败留原状态和旧版本。启用包与选择具体主题的动作语义在UI中区分；多主题包不猜默认想用哪一个。若提供合并快捷操作，按钮必须明确写「启用并使用〈主题〉」，不能点包名就默默应用。
4. **选择主题/改变量**：启用后在现有主题库使用包贡献的主题；进入现有作者创建完整变体，保留精确包/字体引用。用户改变量仍是独立完整快照，不依赖包的运行时继承树。包的不可变源定义不可由用户「改名」原地修改，改名/编辑先进入个人变体。
5. **停用/恢复**：停用卡明确说明若当前使用此包会暂用基础外观，但保留请求主题与变体；显示「已停用，可恢复」。重新启用精确依赖后能恢复之前请求，无需用户重新创建。设置、停止、保存错误、权限恢复入口始终可访问。
6. **卸载**：先显示领域模块返回的变体/模板/当前使用引用清单与卸载结果。可采用「有引用则阻止并指向依赖项」或「保留设计为缺依赖状态」之一；不要无说明级联删变体/模板。设计应明确活动主题是否允许卸载并回退。只有无引用的资源才可回收，不能为了卸载把家庭字体或另一个版本仍在用的字体删掉。
7. **导出**：包卡导出原不可变包；主题行导出当前完整变体及其精确资源依赖，文件摘要说明是否包含字体。不能以「主题JSON导出成功」宣称缺字体的文件可跨设备完整恢复。无资源主题也导出同一格式，不新增第二种随意JSON主题格式。

UI建议只保留一层包摘要/详情Modal，避免作者panel内再叠安装向导。导入安装不启动作者；用户明确创建变体才打开作者。包操作pending期间禁用重复点击，并显示「验证资源/正在保存」；失败保留详情。卸载按钮在缺依赖/停用包上仍能看到，但由领域依赖策略决定是否可操作，不能藏掉恢复办法。

## 3. 状态呈现与请求/实际分开

建议由领域层提供有限状态和原因，UI不自行猜测：`installed-disabled`、`available`、`missing-package`、`missing-asset`、`incompatible-renderer`、`resource-error`。这些是建议术语，最终枚举由design定。

- 包卡显示身份与状态，主题行显示「来自〈包〉 · 版本」；资源错误显示具体family/asset及重试/重导入入口。
- `workspace.theme.active`仍标记请求选择；若不可用，checked行旁写「当前请求，暂用基础外观」，实际造型/外壳能力来自共享effective resolver。不要让用户误认fallback为其原主题设计已被删除。
- 不能只禁用缺包主题行、隐藏其设计或normalize时删掉；应仍可查看/导出/管理。作者在缺依赖时可保留草稿和合法变量，但inspect明确unavailable/error，应用受同一资源与合同检查。
- 不兼容renderer与损坏数据分开：合法未知引用应保留且不可执行；非法字段/超预算/代码载荷应拒绝导入。不能把任意未知CSS/HTML「保留」成以后可能执行的数据。

## 4. 本地字体与隔离预览

### 4.1 避免64KiB与完整资源矛盾

当前render消息预算是完整JSON的64KiB，合法字体通常可能超过它；base64又增加体积。因此ThemeEntry、草稿、模板和render控制消息应只保存紧凑精确引用，例如包ID/版本/内容摘要/assetId，字体字节单独存资源库并由领域resolver读取。不能为了本地字体直接放大所有控制消息预算，或把完整workspace/整包投给preview。

建议父bridge在已验证包与引用后投影当前草稿实际需要的字体资源，通过独立有预算的消息类型传二进制ArrayBuffer（或有限批次），沿用exact source/origin/channel/draftId/rev/requestId并加资源身份和累计额度；接收端再次核对当前请求和摘要。资源传输的单项、总量、并发和超时应由同一核心常量约束，不由UI拍一个较大阈值。转移Buffer须clone当前资源，不能detach资源库仍在用的原始buffer。

新资源协议仍只支持字体二进制，不能引入任意URL、CSS、HTML或函数。64KiB控制消息与字体二进制额度在类型/validator/文档中分别表述，不能让后续资源报文绕过所有消息校验。

### 4.2 文档内FontFace与资源身份

可优先采用`new FontFace(safeFamily, ArrayBuffer)`加载本地字体，成功后加入目标document.fonts，lease release时从同一document.fonts移除。CSS Font Loading规范允许BufferSource形式的字体源；因此可以避免为字体创建blob URL或发网络请求，这是基于API的实施推论，仍需真实Web/MV3与坏字体测试确认。[CSS Font Loading规范](https://drafts.csswg.org/css-font-loading/#font-face-constructor)、[MDN构造器参数](https://developer.mozilla.org/en-US/docs/Web/API/FontFace/FontFace)

当前lease按小写family作key，本地包必须把来源（精确摘要/asset）纳入identity；同family不同字节不能误复用。若允许安装的不同包使用同名字体，最好由resolver生成内部受控CSS family别名（可见名称仍保留原family），防止正式与预览/两个包的同名face意外覆盖。fontVars与preload必须使用同一resolved family，不让浏览器碰运气选择face。

缺包/缺asset/停用时不按family静默请求Google。Google资源与本地资源显式区分；纯本地包默认没有网络权限，不等于系统原本天气/聊天的设备授权被撤销。安装、停用、卸载、修订、取消、重载与A→B→A迟到都需要独立document lease释放；父正式doc与preview不能互删FontFace。只释放作者临时资源不影响正式当前主题资源。

## 5. Web/MV3与焦点/恢复入口

当前`theme-preview.html`是可信扩展页同源iframe，不在manifest.sandbox.pages中。`browser-extension/manifest.json:40`的extension_pages仅允许自身脚本等已有政策，当前frame-src self可承载打包preview。MV3不允许借主题包注入远程脚本或放开unsafe-eval；本项声明式包只交给预先打包的解释路径，与Chrome对远程配置/代码的区分一致。[Chrome CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)、[Chrome安全迁移说明](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security)

采用FontFace二进制源的建议不要求添加host权限、web_accessible_resources或font-src blob；这是当前可信同源页和无URL资源路径的设计推论，并非未经浏览器验证的保证。不要把新字体送到现有生成应用sandbox里，也不要改其较宽松CSP作为主题宿主的捷径。

作者panel当前层级1050，Lobe Select/Modal/网络权限portal在其上方；继续保持。`src/main.tsx:83`的ExtensionNetworkPrompt在App之外，包操作不能把它放进作者iframe或其inert区域。`enableCustomFonts=false`保持，不能由新ConfigProvider再次偷偷注入npm字体。

390/320用实际容器，不只测viewport：包卡动作需换行、ID/digest允许断词，摘要Modal内部可滚动，底部安装/取消可达。键盘选择文件后摘要获焦点、Escape/取消回原导入按钮；安装成功包卡/状态获可访问播报，卸载后焦点回仍存在的列表或导入入口。新包Modal不应长期抢助手或待决审批，安装不刷新App，不改变应用iframe与业务父节点。

## 6. 建议的真实浏览器验证顺序

先冻结核心包格式与API，再以本机独立端口、fresh context跑。前轮多次HMR编辑已确实破坏矩阵，最终应明确代码freeze，构建与dev矩阵不同时进行；Web/MV3使用实际产物分别测，无生产QA桥。

| 场景 | 必须观察的真实结果 |
| --- | --- |
| JSON导入→摘要→安装 | 安装后active主题/父root/业务DOM不变，显示未启用，不能只断返回成功 |
| 启用→选主题→派生→预览→应用 | 两模式computed主色/recipe正确，本地字体FontFace真实loaded且无外部font请求，父子document隔离 |
| 停用→fallback→恢复 | 请求引用仍在；实际skin/layout基础回退；设置/助手/停止/权限入口可点击；恢复后原设计/字体回来 |
| 卸载依赖保护 | 指出变体/模板引用；拒绝或明确保留策略不删除设计，不错误清另一个consumer字体 |
| 重复/同版本异digest/坏签名或内容digest/超预算/路径遍历/未知字段/MIME伪造 | 整体失败，旧包和主题继续可用；不靠吞错误与切默认当成功 |
| 坏二进制字体/加载失败/旧响应迟到 | ready=false、无部分激活，原FontFace继续可用；cancel/patch释放临时face |
| 缺包/缺asset reload/模板/备份/同步 | 精确refs和合法设计保留，错误类别可解释；安装精确依赖后恢复；跨设备权限不被复制 |
| 导出个人变体→全新context安装 | 导出文件含实际设计及依赖字节（合同允许范围），无需原profile和外网即可用 |
| 1440/390/320/窄AI分栏与键盘 | 控件与详情不重叠/不截断/焦点不落遮挡背景；权限Modal仍最高可操作 |
| Web离线与真实MV3 | 正式App/preview加载、JSON filechooser/download、FontFace二进制、portal、启停卸可用且无CSP错误 |
| 生命周期 | 原todo DOM/未提交值、生成应用canonical ID/iframe/init=1/输入、助手草稿/待决审批不变，停止仍取消原操作 |

字体测试可使用本机公开可读取TTF二进制作隔离fixture，不打真实外网；导入导出通过Playwright filechooser/download，最终产物用UI完成。可复用前项`test-theme-preview-packaged-browser.mjs`和`test-theme-authoring-lifecycle-browser.mjs`的context/模型夹具，不把旧任务通过计数冒充新包功能已测。

## 7. 交给设计阶段冻结的接口问题

1. ThemeEntry中的包/资源紧凑引用、未知renderer合法引用边界；UI所需availability reason与requested/effective投影。
2. 单包JSON文本/解码字体/总资源/安装数额度、FontFace支持格式与摘要验证；安装前资源准备到底只验二进制解析还是也完成doc加载。
3. 安装新版本保留旧版本的规则、变体/模板对精确资源的引用保护与卸载策略。
4. 全备份/配置同步/增量同步具体带定义还是带资源；若资源不随行，导出/安装UI必须明确缺资源和恢复方法。
5. preview资源transport与fonts lease provider接口，禁止让preview为了取资源import workspaceStore或打开第二套业务storage初始化。

本轮只写本文件。未安装任何依赖、未改CSP、未创建新任务系统、未触碰真实本地数据或浏览器权限。
