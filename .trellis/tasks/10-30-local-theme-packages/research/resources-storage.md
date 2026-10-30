# 本地主题包资源与存储研究

日期：2026-10-30。范围：只读源码与官方资料研究；下文是待具体设计采纳的建议，不表示产品已经实现。未修改产品代码。

## 建议结论

本项采用有预算的 JSON 包，字体仅接受内嵌 base64 WOFF2。安装定义与字体字节进入专用 IndexedDB 仓，设备启用状态另存本机仓。完整备份包含定义和字节；配置快照、完整业务快照同步与加密增量同步均只携带工作空间里的不可变引用，不携带包字节、不复制设备启用状态。缺包或停用保留合法主题设计与请求引用，实际回退，重新安装并启用后恢复。

字体运行时推荐 `FontFace(internalFamily, ArrayBuffer)`，在消费文档的 `FontFaceSet` 中 add/delete，不创建 Blob URL、外链或用户 CSS。现有 document lease 接口可扩展，不能把 family-only 缓存键照搬到不同资源源。

## 当前源码事实

| 边界 | 当前行为与本项影响 |
| --- | --- |
| `src/lib/fonts.ts` | `acquireThemeFonts(doc, fonts, {signal, timeoutMs})` 按 document WeakMap 去重、引用计数、超时、取消、最多4并发/32项；Google 字体使用 link.onload + `doc.fonts.load/check`。`undefined` 会加载4个默认远端family，`[]` 为系统零网络。当前 key 只有小写family，本地源不能共用该身份。 |
| `src/lib/themeAuthoring/previewProtocol.ts` | render/report 为64KiB严格 JSON，只允许固定身份、设计、模式、宽度与状态；准确匹配 channel/window/origin/draft/revision/request。不能把MiB级base64直接塞入现有render字段，也不能传任意URL。 |
| `src/themePreview.tsx` | 独立document运行固定夹具；主题资源lease独立，未初始化业务App、工作空间、同步或AI。资源解析不能引入这些模块。 |
| `src/lib/db.ts` | DB版本6，StoreName目前七仓；业务snapshot只读取kv/apps/convs/turns/toolDetails五仓。`db.batch`与`db.atomic`可复用，事务中禁止等待crypto/网络。新增仓不会自动进入snapshot。 |
| `src/lib/storage.ts` | 完整备份版本3、JSON上限256MiB，显式序列化五仓；`exportBackupSnapshot`等saveBarrier，import严格校验后走恢复提交；单独新仓不会自动备份。 |
| `src/lib/storageCommit.ts` | DATA_STORES五仓白名单、恢复日志版本4；`replaceOperations`、checkRestorePoint、受影响仓snapshot、rollback均显式枚举。完整恢复需要同时扩展这些边界，不能只改导出。 |
| `src/lib/syncData.ts` | configuration/full只从明确configNames与五仓投影；full遍历所有kv作为component。不要把主题资源塞kv：它会被误当组件同步。 |
| `src/lib/incrementalAdapters.ts` | 仅明确config/component/applicationData/conversation/turn集合；8MiB值预算。不要为包bytes新增集合；workspace主题引用走既有配置校验。 |
| `src/lib/incrementalConfigSchema.ts` | workspace出站仅排除network，入站保留本机network。包启用状态不应放workspace，否则两条同步都会复制。 |
| `src/lib/persistence.ts` | `assertPersistenceWritable`和`withPersistenceExclusive`可用；安装/删除必须遵守恢复、重载门禁。失败不能当空库。 |
| `src/lib/storageUsage.ts` | 容量统计只列配置和五业务仓，需明确增加本地包计量，否则用户无法识别资源占用。 |

## 资源字段与验证建议

`ThemeFont` 保留 `family/role`，可增加一个本地资源引用，精确绑定包ID、不可变version、resourceId和sha256；格式由整体包设计统一决定，不维护第二套身份。引用不接受路径、URL、data URL或CSS文本。资源清单只认manifest里的确切ID，不执行文件系统解压，因此不需要ZIP依赖或路径拼接。

与整体设计owner同步后的拟定预算：每字体压缩bytes<=2MiB、每包<=4字体且decoded总量<=4MiB、安装库decoded总量<=16MiB且<=16个版本。JSON含base64应另设与4/3编码开销对应的文件上限（建议6MiB），并在具体设计中固定为唯一常量，而不是多层各自猜数。中文全量字体可能超预算，首期明确要求作者使用子集WOFF2；不声称这些数字是浏览器配额。

校验顺序：先File.size/JSON UTF-8预算，再严格对象字段/数量/base64字符与长度预算，解码后验证实际byteLength、WOFF2签名`wOF2`、至少48字节header、header声明length等于实际文件长度、合理的numTables与totalSfntSize；建议解压后声明总量也有16MiB单字体上限，防止小压缩包诱发大分配。随后SHA-256核对、FontFace实际解码。header与摘要都不能代替浏览器字体解码，也不能证明作者可信；font解析失败整包安装/启用失败。

所有资源sha及包规范化摘要在进入IDB事务前计算；不可变包身份相同且摘要不同时拒绝，不能覆盖旧版本。重复相同包为幂等，不借重复导入悄悄启用。预算应按安装后的去重规则明确核算，失败零部分激活。

## document字体lease扩展

建议维持现有消费接口，新增受控本地资源resolver参数或专用适配层：resolver返回已核对的bytes及immutable identity，绝不接受任意URL。整体设计owner拟定引用为`resource?: {packageId, version, digest, resourceId, sha256}`，三段精确版本、摘要小写64hex；最终由整体schema统一维护。默认resolver只读enabled包；enable阶段可传只闭包绑定本次已验证package identity的预备resolver，避免公开任意`allowDisabled`布尔绕过。资源模块只依赖纯schema、db和persistence，不依赖workspace store/同步初始化。正式App和preview各自持有lease。

本地font的内部CSS family必须由digest派生，例如`TadaLocal_<sha256>`；family仅作为作者展示名称。原因是prepare会先在正式document加载资源，同名不同版本若直接使用作者family，会在提交前抢占当前字体，破坏预备不改正式外观合同。`fontVars`必须对local引用输出相同内部alias加系统后备。lease key至少包括source kind与sha256，Google仍按规范family；同内容不同名称可按明确定义的key去重，不能互相误删。

从`doc.defaultView.FontFace`创建实例，使用ArrayBuffer直接source；等待`face.load()`且status=loaded，add到该doc.fonts，必要时check确认。同步没有active consumer时不创建face。release只delete自己创建的face，绝不clear整个doc.fonts；迟到load回调在generation失效时不能重新add。超时/取消立即结算并阻止后续add，资源字节promise的后续结果丢弃。load不能被平台真正中止时，仍要实现逻辑取消和结果隔离。

本地包设计必须显式fonts:[]或仅本地资源，不能用undefined继承默认远端字体；字体token也不能偷偷引用Google目录字体。否则“声明式包默认无网络”会被现有默认4family破坏。继承/派生快照保存明确资源引用，资源缺失不自动改成[]并写回用户设计。

## 预览与CSP

优选在父级准备资源后新增单独、严格有预算的font-only二进制消息：header继续绑定exact window/origin/channel/draft/revision/request，限定theme确切引用的resource列表；bytes为ArrayBuffer，按安装预算再次检查总量和hash。不要放宽现有render JSON 64KiB，也不要允许任意HTML/CSS/URL/function。父级复制buffer后transfer，不能detach安装库自己的缓存；子级每request替换其资源map，旧revision迟到消息丢弃。

较小实现的备选是preview通过纯resource repository按refs只读同源专仓，不import任何业务初始化；因为preview代码是可信同源隔离，这不是新增第三方权限。但若要沿用“preview不访问业务存储”的清楚说明，二进制消息更直观，后续也方便离线夹具。两种只选一种，不能做双协议fallback。

当前`browser-extension/manifest.json` extension_pages CSP为`script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; frame-src 'self';`，未限制font-src；现preview不属于manifest的sandbox.pages，其iframe依赖现有打包入口。ArrayBuffer FontFace不需要远端script、blob module或objectURL，因此不应为本项放宽script-src。Web部署`vercel.json`当前未设置CSP。最终仍需真实Web/MV3载入WOFF2并观察CSP事件，不能凭build或MDN代替验收。

若实施改用Blob URL，必须由消费document自己创建/撤销并按lease寿命计数、不得跨文档传URL字符串，另检查font-src；该路径增加清理面，本项没有必要。

## 仓库、备份、同步与停用

建议专仓`themePackages`保存经校验的可携包数据（定义、manifest、base64字节或能明确JSON导出的资源表示），key精确id+version；专仓`themePackageState`保存本机enabled/当前安装选择等设备状态。避免散放localStorage的大base64以及混进kv/apps。两仓可同db.batch原子安装，但workspace激活是另一存储域，不承诺IDB/localStorage跨引擎原子。

安装先校验/实际解码/预算，再原子持久化包为已安装但未启用；启用先资源prepare，随后重新核验包摘要/启用状态/目标主题引用，再修改正式工作空间。发生保存错误保留旧主题和旧版本，报告可重试具体原因。

完整备份：显式加入包定义及所有字节，先校验schema/header/hash/预算再修改任何仓；snapshot、exportIdb、backup validator/summary、reset、replaceOperations、恢复日志校验、回滚都覆盖包仓。设备enabled/授权不导出；恢复时清本机启用状态，包处于已安装未启用，用户显式启用后恢复。读取失败必须失败，不能导出空资源数组声称完整。

同步三种模式：只携带完整合法主题设计与不可变包/资源引用；不携带包bytes、安装记录、enabled或任何执行授权。完整业务同步“full”仍有明确例外，应在UI与运行时文档说明资源包需另行安装/完整备份，不能宣称跨设备恢复了所有字体。入站缺包不是坏主题，不应被`readThemes/migrate/template`过滤。摘要核验不等于启用，收到引用不会自动安装或授权。

停用是设备状态：释放正式与preview相关lease，保留包字节、主题/变体/模板请求，实际回退，原请求不写回。卸载先从最新workspace的主题与模板扫描依赖，也涵盖作者草稿；有引用时拒绝物理删除并列出引用，建议先停用。即使无引用也先停止新acquire，等待或撤销存活lease再删除；并发启用/卸载应核对generation/摘要，不让晚到prepare激活已删除包。没有文件系统清理或自动下载依赖。

## 验收建议

- 用最小WOFF2真实文件测FontFace成功与损坏文件/header/摘要/超预算拒绝；不把mock loaded当资源成功证据。
- A同display family版本1→2预备期间正式computed字体与页面尺寸不变；apply后生效；取消不遗留face。
- 正式/preview两个document同资源独立add/delete，旧generation迟到load不重新add；停用/卸载后faces与objectURL计数归零（推荐无URL实现）。
- 完整备份恢复包含bytes且默认停用；配置/full/增量出站不含bytes/设备状态，缺资源引用往返不丢，安装正确包后恢复。
- 模拟IDB读写/配额/恢复失败，旧版本与主题仍可操作；绑定增量同步时新专仓操作不会误触apps专仓拒绝或绕过恢复门禁。

## 官方依据

- [MDN FontFace](https://developer.mozilla.org/en-US/docs/Web/API/FontFace)：支持URL或ArrayBuffer源，提供加载状态。
- [MDN CSS Font Loading API](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Font_Loading_API)：binary source自动解码，使用前加入对应FontFaceSet。
- [MDN FontFaceSet](https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet)：add/delete允许按实例控制，避免全局clear。
- [Chrome扩展CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)：extension_pages策略覆盖扩展页面及iframe，script最低约束不能任意放宽。

以上资料支持API选择，预算与存储合同为根据本仓边界提出的设计建议；CSP实际可用性仍以本次真实MV3验收为准。
