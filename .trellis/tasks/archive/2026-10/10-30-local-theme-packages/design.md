# 本地声明式主题包：具体设计

状态：accepted，2026-10-30；基线 `7fa143a`。仅支持数据，沿用已打包 skin/shell、作者字段目录与文档字体 lease；不安装 JS、CSS、SVG 或 ZIP。

## 1. 格式、身份与预算

使用一个 UTF-8 `.dada-theme.json` 文件，避免 ZIP 解压、路径和新依赖。外层严格 `{manifest, resources}`。manifest 为：

```ts
type PackageIdentity = {packageId: string; version: string; digest: string}
type ThemePackageRef = PackageIdentity & {themeId: string}
type LocalThemeFontRef = PackageIdentity & {resourceId: string; sha256: string}
type Manifest = PackageIdentity & {
  kind: 'declarative-theme'
  schemaVersion: 1
  name: string
  description: string
  requiredRenderers: {skin: string; shell: string; skinVersion: number; shellVersion: number}[]
  contributions: {id: string; kind: 'theme'; design: ThemeDefinition}[]
  resources: {id: string; mime: 'font/woff2'; bytes: number; sha256: string}[]
}
// 文件 resources 只保存 {id, base64}，与 manifest 资源一一对应。
// ThemeDefinition 为 ThemeEntry 的完整设计/名称说明，不含实例id、builtin、packageRef。
// 其中 fonts 使用 {family, role?, resourceId} 或 []，不是带自身digest的运行时ref。
// hydrate依据资源descriptor展开resource；导出反向折回resourceId再计算digest。
```

packageId 为小写 `[a-z0-9][a-z0-9.-]{0,63}`，不允许 `..`；version 为严格 `major.minor.patch`，不接受范围或 URL；digest/sha256 为小写 64 位十六进制。贡献/资源 ID 为 1–64 位字母数字、下划线、连字符，无路径、斜杠、点或编码解码。每个 JSON 对象拒绝未知字段、原型相关键和非 JSON 值。

digest 为删除 manifest.digest 后的规范 JSON 的 SHA-256：对象键递归排序、数组保持顺序、标准 JSON 编码。manifest 包含每个资源的 sha256 和解码后 bytes，因此资源内容受到摘要约束；base64 不直接参与包摘要。先校验 UTF-8 大小、JSON 结构与预算，再解码、核对每个资源字节长度/WOFF2 `wOF2` 文件头/SHA-256，最后核对包摘要。不把摘要当作者身份、版权或可信签名。导出使用同一函数重建摘要。

明确预算：文件 JSON ≤ 6MiB；单字体解码后 ≤ 2MiB；单包总资源 ≤ 4MiB；每包 ≤ 4 字体、≤ 8 主题贡献；manifest ≤ 64KiB；每份主题设计 ≤ 32KiB、JSON 深度 ≤ 12；本地仓所有版本资源合计 ≤ 16MiB、最多 16 个精确版本。安装的总预算在写事务内重新计算，避免两个并行安装越限。相同 packageId/version/digest 重复安装幂等；同 packageId/version 不同 digest 拒绝，不能覆盖。不同版本并存，没有隐式升级或版本范围求解器。

## 2. 已知数据与不可用设计

`ThemeEntry` 新增 `packageRef?: ThemePackageRef` 与 `rendererContract?: {schemaVersion: number; skinVersion: number; shellVersion: number}`。包实例两项必填；普通内置/本地方案保持已有字段。origin 继续只描述内置来源，不拿包 ID 冒充内置定义；包派生完整保留 packageRef 和资源引用，来源不是继承树。

ThemeEntry.skin/shell 接受非空有界字符串；`ThemeSkin`/`ThemeShell` 继续代表宿主已知的有效实现联合。已知 schema/renderer 必须走当前作者目录完整验证；未知 renderer 只允许包引用条目，保留同一完整设计字段，经通用 JSON/字符串/数组/预算校验但不解释或执行。支持性判断只影响运行解析，不能使 readThemes、模板读取或同步删除记录。

为真正未知数据 schema 增加最小 `opaqueDesign?: {schemaVersion: number; payload: JsonObject}`。只允许有 packageRef 的条目；顶层身份、名称、描述与请求 renderer 仍可诊断，payload 原样经 ≤32KiB/深度12验证并往返。opaque 条目不进入作者表单，不应用字段 patch，不加载字体、不启用；在未来宿主理解对应 schema 后显式转译，不擅自猜字段。这个 envelope 只为缺依赖保留，不开放任意扩展对象作为主题样式。

未知 manifest.kind/schema 的导入不安装资源：校验有界身份/manifest envelope 后，保存 `unsupported` 元数据记录（≤64KiB，不 bytes，不 enabled），UI 显示不支持、可导出原 envelope/卸载；不能按已安装可用主题宣传。损坏 JSON、摘要或资源仍明确失败，不等同未知类型。该元数据不自动产生工作空间主题。

工作空间版本升至 9，完整主题和模板的 unknown 边界复用一个验证器。包依赖缺失/停用和错误 renderer 不属于损坏数据，现有 built-in ID 保护不变。普通无 packageRef 自定义主题仍要求已知 renderer，避免把任意坏引用变成可接受的动态设计。

## 3. 本机仓、同步与备份

主数据库版本 7 新增 `themePackages`，keyPath `k`，key 为精确 `packageId@version`；记录包含 manifest、已校验字体 ArrayBuffer、enabled、generation、installedAt。资源和启用状态属于本机安装仓，不放 localStorage、kv/apps、工作空间或同步记录。内存只缓存经过校验的快照，初始化失败向持久化故障入口报告，不发布“空仓成功”。每次写等待 IDB 事务完成后发布快照/递增 generation。

保存屏障包含已接受的包写入。`DbSnapshot` 增加 themePackages，但 syncData 导出依然显式只取原业务仓；普通配置、完整业务快照、加密增量同步只传 ThemeEntry 的完整设计和精确 packageRef/font refs，不传包 bytes、enabled、generation 或安装元数据。跨设备收到设计后如实提示缺包，需要用户导入同摘要文件；不从 URL 自动下载字体，也不继承设备授权。

完整备份版本 4 显式包含 themePackages；ArrayBuffer 转为资源 base64，导入先校验所有包的 hash/预算/关系，再进行任何写入。恢复包统一 enabled=false，即使原来启用；保留请求主题，显示停用回退。恢复日志版本 5、DATA_STORES 与 replaceOperations 覆盖新仓；回滚恢复原本 enabled 状态，不套用“备份恢复默认停用”策略。重置清除包仓。旧备份/协议不增加兼容桥，旧原文不主动删除。

不宣称 localStorage 与 IDB 完全原子。安装只写包仓；激活先准备，后一次工作空间 commit。保存失败沿现有故障与恢复合同显示，不能声称已落盘。config 同步/备份的 package refs 不能用来写包仓。

## 4. 安装、启停、启用贡献与卸载

以下公共接口在 `src/lib/themePackages/`，UI 与 Agent 共用；参数从 unknown 校验：

```ts
parseThemePackage(text: string): Promise<ThemePackageImport> // detached, immutable, no writes
installThemePackage(input: ThemePackageImport): Promise<ThemePackageSummary> // revalidate, disabled
listThemePackages(): readonly ThemePackageSummary[]
subscribeThemePackages(listener: () => void): () => void
getThemePackageAvailability(theme: ThemeEntry): ThemePackageAvailability
setThemePackageEnabled(identity: PackageIdentity, enabled: boolean, options?: {signal?: AbortSignal}): Promise<void>
activateThemePackage(identity: PackageIdentity, themeId: string, options?: {signal?: AbortSignal}): Promise<ThemeEntry>
getThemePackageDependents(identity: PackageIdentity, workspace?: Workspace): ThemePackageDependent[]
uninstallThemePackage(identity: PackageIdentity): Promise<void>
exportThemePackage(identity: PackageIdentity): Promise<string>
exportThemeWithDependencies(theme: ThemeEntry): Promise<string>
```

`ThemePackageImport` 不靠 TypeScript brand 充当安全边界：安装重验结构/bytes/hash，避免确认预览后被调用者修改。导入摘要 UI 显示包版本/摘要缩写、贡献、资源体积、离线可用与同步边界；用户确认安装不会改变当前主题，默认 disabled。

启用包只改变本机 enabled，不替用户选择新的贡献；若当前请求恰好依赖该包，准备成功后原请求自然恢复。启用前验证所有已知贡献及其字体，缺 renderer/schema 则拒绝启用。启用准备通过闭包绑定本次精确包身份的资源读取器，不能公开 `allowDisabled=true` 任意绕过读取。准备期间不发布 enabled；失败/取消保持原状态。成功前重核仓 generation/digest，等待后不复用陈旧记录。

选择贡献 `activateThemePackage` 必须已安装且 enabled；复制贡献完整设计，附 packageRef/rendererContract、分配独立实例 ID，并在资源预备 await 后重核包 generation/启用状态与选择 generation，基于最新工作空间一次 commit。已有同精确贡献的未修改实例可复用；用户变体永不被覆盖。失败保留原选择和包，准备 lease 释放。激活流程不运行真实 App，也不依赖作者草稿必须存在。

停用仅把本机 enabled=false，保留所有请求引用和设计；同一 resolve 路径立刻给 paper/standard、fonts:[] 安全回退。资源 lease 在正式消费者接管回退后释放；不卸载业务舞台或清聊天/审批。再次启用资源准备成功后恢复原变体设计。

卸载先检查当前主题库（包括未选中变体）与所有模板的精确 packageRef/资源引用；有引用则阻止删除并列出引用，活动引用也不例外。用户可先停用并删除/改用依赖方案，再卸载；不新增强制删用户主题按钮。删除无引用包前停止其新 acquire，等待/释放准备租约，以 generation 令在途启用失败；事务完成再发布不存在。包版本升级采用另装新版本→显式选择，失败不影响旧版本。

`exportThemeWithDependencies` 导出一份新的声明式包，贡献只含该完整方案、资源仅含精确引用，所有资源从安装仓取 bytes；缺资源、undefined默认远端字体或显式Google字体均失败，提示先在作者中选择系统/本地资源，不静默改设计。生成独立 packageId/version 并重写贡献内部本地 ref 到新 identity，计算摘要时资源引用使用内部 resourceId 形态，实例化时才展开 package identity，避免摘要自引用。原完整包导出保持原 identity/digest。

## 5. 统一有效解析与实际资源消费

`ThemePackageAvailability` 为 `{status: 'available'|'missing'|'disabled'|'incompatible'|'unsupported'|'resource-error', reason?: string, generation: number}`。无包普通主题可用；缺精确 digest 视为 missing，不能匹配同 ID 其他版本。opaque/未知kind/schema 为 unsupported，renderer合同版本或组合不支持为 incompatible，损坏资源为 resource-error。坏数据不能借 fallback 校验通过。

`resolveTheme` 请求身份与有效身份分开：返回请求 theme id/skin/shell/packageRef、availability 和已知有效 skin/shell/values；不可用统一从安全 paper 默认设计解析，fonts:[]、无 recipes/shellConfig，不套用不可用包的颜色。实际 root data-skin、ShellHost、字体加载、设置能力、应用主题消息与 inspector 全消费有效结果，不能只把 chrome 换成 standard 却继续 win98 CSS。原 ThemeEntry 不回写。同步订阅包快照，使启停不需要 reload。

`ThemeFont` 新增 `resource?: LocalThemeFontRef`，缺省依旧受控 Google family。包贡献必须显式 fonts:[] 或全部本地 resource，不允许 undefined 默认联网；字体角色覆盖只能用系统栈、角色别名或资源所生成角色变量，不接受伪装 URL/任意 font-stack。字体 family 为展示信息；实际 FontFace family 使用 `TadaLocal_<sha256>` 内部 alias，fontVars 同样输出 alias，避免预备同名不同字节改变正式界面。

字体 worker 扩展 `acquireThemeFonts(doc,fonts,{signal,timeoutMs,localResources?})`，localResources 是受控 `(ref,signal)=>Promise<ArrayBuffer>` 读取器；正式默认只读 enabled 精确包，启用流程传绑定一个已校验包的闭包。FontFace(BufferSource) + doc.fonts.add/delete，不创建 URL/@font-face 样式或网络请求。lease key 包含资源身份/sha，取消失败与 document 释放有计数；读取再次核对 bytes/hash，错误不降为 Google 请求。App 字体必须用 resolved effective fonts，回退不能继续加载 requested fonts。

资源预备通过常驻 `registerThemePackageRuntime({prepare(theme,{signal,localResources})})` 端口，UI 在宿主安装一次、非外观页局部；正式 document lease 加载，不修改 root CSS。返回 `{ready,reason?,release}`，成功后的 lease 交接沿作者双rAF+500ms上限，失败即时释放。无 runtime port 时激活/启用失败且无部分写入。

## 6. 独立预览资源通信

保留控制消息 64KiB；只传精确 font ref，不传 base64。独立资源消息复用随机 channel/draftId/revision/requestId/source/origin，并新增 resourceRequestId 与完整 ref。父端只响应当前已校验草稿列出的资源，从 enabled 包读取；每次最多4资源、单2MiB/总4MiB、4请求并发上限，迟到旧会话/未声明ref拒绝。回传独立复制 ArrayBuffer transfer，不转移仓缓存所有权。

子端 FontFace 加载使用该请求读取器，校验 byteLength/sha/WOFF2头；超时/取消/切revision清等待与FontFace；不用父 URL 或同源业务存储。缺资源显示系统后备与准确错误，但 ready=false，作者应用被拒绝。inspect/get 的 readiness 对当前 id/revision 与资源 generation 绑定，停用包立即使旧报告过期。

## 7. 验证与责任分界

领域回归验证：摘要篡改/重复版本/预算与并发安装；坏包零写；缺依赖/未知renderer/opaque 经读取、模板、备份、快照/增量同步保持；disabled 不改请求引用；await 后停用/卸载/换选择拒绝迟到启用；引用保护包含资源的间接依赖；恢复失败回滚新仓；完整同步不泄露bytes/enabled。

真实 Web/MV3：导入→安装disabled→启用→选择→改完整变体→停用回退→启用恢复→引用保护→删除依赖后卸载；真实 FontFace glyph/check、无Google请求、same-family预备不变当前字形、正式/iframe不同文档lease、无对象URL残留；页面输入/应用iframe/助手草稿/审批停止保持；未知renderer的有效skin/layout回退可操作。

core worker 拥有 package领域/仓库/验证和 workspace/themes/templates/sync边界及数据测试；资源 worker 拥有 fonts.ts/资源加载、db/storage/storageCommit/storageUsage及backup测试；UI worker 拥有外观页导入管理、App有效解析/常驻runtime与预览resource transport；root协调既有工具诊断/docs/package测试入口。本项不新增AI安装工具。确切文件分工以 root 开工消息为准，不并行改同一文件。

## 审读补充

未知类型只接受可完整往返的有界 metadata envelope；携带当前无法保存或校验资源的未知包明确拒绝，不以安装成功名义丢弃资源。原 envelope 导出保持原样。首期没有新增包安装 Agent 工具，文件导入与启停管理由设置完成；现有主题读取/作者工具披露包身份及可用性。
