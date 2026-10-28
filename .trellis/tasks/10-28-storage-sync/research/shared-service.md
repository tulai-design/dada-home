# 搭搭与默默共用同步服务的边界

日期：2026-10-28。范围：只读检查 `/Users/xiaomengdao/WebstormProjects/aifenjing` 的当前源码与规范，给当前搭搭任务提供架构输入；未读取真实创作数据库、启动应用、执行同步、修改该仓或提交。搭搭自身细节由本任务其余研究负责。本文“建议”是设计判断，不是已实现能力。

## 结论

可以共用一个可部署的数据同步服务，浏览器和 Tauri 客户端使用同一网络协议。服务的最小抽象应是**应用命名空间下有身份、有版本的记录及独立不可变对象**，不应包含搭搭 `turn`、默默 `shot` 或数据库表定义。两个应用分别负责本地读写、可携字段投影、关系约束、冲突呈现和版本升级。

**只同步原始文件不够。** 默默浏览器用 IndexedDB，正常桌面发行策略用 SQLite + 受管媒体文件；数据库内同时有内容、连接密钥、运行状态和本机授权。同步数据库文件不能解决跨端格式、离线并发、删除、关系原子性或秘密过滤。WebDAV/对象存储可以成为服务内部的对象存储后端；它本身不等于可靠的业务数据同步。关闭应用后的数据库快照适合备份与明确恢复，不能直接替代记录合并。

默默现有 checkpoint/provider 雏形提供了可借鉴的完整性与 CAS 原则，**尚不能直接接服务宣称产品同步完成**：它明确只支持单项目的 `project`/`media` 测试投影，既没有完整生产 codec，也没有真实 provider、产品应用事务或用户同步入口。[现有协议范围与证据限制](/Users/xiaomengdao/WebstormProjects/aifenjing/.trellis/spec/frontend/checkpoint-protocol.md:5)

## 实际存储和跨端边界

| 方面 | 当前证据 | 对共用服务的影响 |
| --- | --- | --- |
| 一套业务存储接口 | `platform/product/store.ts` 在模块加载时固定选择一个 ProductStore；IndexedDB 与 native store 共用所有业务命令，不在失败后切换 owner。[选择与初始化](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/platform/product/store.ts:20) | 新增同步适配层读写该接口，保留本地权威存储，不建立第二套业务数据库。 |
| 浏览器 | 数据库名为 `aifenjing`；Dexie schema 已到版本 28。[启动配置](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/platform/runtime/storageProfile.ts:20)、[数据库版本](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/platform/storage/browserDatabase.ts:316) | 浏览器没有可同步的普通数据库文件。需要从同一事务快照导出、用本地事务应用。 |
| 桌面 | 正常发行策略明确 `storage: sqlite` / `product-sqlite`；root 由 Rust 选择为 app data 下 `product-workspace-v1`，实际库为 `.local/state.sqlite`，另有 writer lock 库。[发行策略](/Users/xiaomengdao/WebstormProjects/aifenjing/apps/desktop/scripts/release-policy.mjs:5)、[工作区 root](/Users/xiaomengdao/WebstormProjects/aifenjing/apps/desktop/src-tauri/src/desktop.rs:150)、[库与锁](/Users/xiaomengdao/WebstormProjects/aifenjing/apps/desktop/src-tauri/src/full_product_store/mod.rs:188) | 网络协议不能把绝对路径或本机文件句柄当成可携数据。新下载的字节通过 native staging/claim 入库。 |
| 业务表 | 当前 registry 有 54 表，静态分类为 content 33、device 4、mixed 17。device 是 connectors、searchConnections、connectorAliases、deviceSettings；schema 与 TS 类型注册表是闭集。[schema](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/platform/storage/schema.json:1)、[表类型](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/platform/storage/tableTypes.ts:44) | 分类是投影审查的起点，不能把 `content` 当作“整行安全上云”或只删掉 4 张 device 表。 |
| 媒体载体 | 不只有 `media.blob`：文件素材版本和不可变设定快照中的 `media[].blob` 也携带字节。浏览器为 Blob，native 为独立受管文件及 opaque ref。[三类载体与声明](/Users/xiaomengdao/WebstormProjects/aifenjing/.trellis/spec/frontend/shared-product-storage.md:197) | 需要遍历所有二进制载体与历史引用闭包，不能只同步 `media` 表。 |
| 本机二进制身份 | native ref 带 workspace、binaryId、hash、length、MIME，来自受信任 producer/decoder；JSON 形状相同不构成本机访问权限。native 路径是 `assets/id-<binary UUID hex>`。[引用校验](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/platform/storage/codec.ts:71)、[文件命名](/Users/xiaomengdao/WebstormProjects/aifenjing/apps/desktop/src-tauri/src/product_binary.rs:376) | 远端保存逻辑对象引用；接收设备重新准备和验证本机 binary ref，不能反序列化远端 JSON 后直接授权文件访问。 |

产品术语按实际模型使用：默默 `Project` 分 video/audio/music；视频有 episode/shot，另有 Studio 素材库、IP、素材版本、项目记忆、参考资料、Agent 对话和任务，不是一个聊天应用数据模型。[项目模型](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/features/projects/models/project.ts:10)、[注册模型](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/platform/storage/tableTypes.ts:44)；该仓没有根 `GLOSSARY.md`。

## 身份、版本、秘密和执行状态

1. **保留业务 ID，另设同步空间身份。** 业务 ID 是字符串，创建器通常生成 `<prefix>_<UUID>`；native workspace 有持久 UUID，但浏览器 `browser-local` 明确只是本地 adapter 名，checkpoint 拒绝把它当可携 workspace。首次启用同步应持久化真实 `spaceId`，把设备本地 root/owner 与同步空间分开，不能让所有浏览器都加入同一个 `browser-local`。[ID 创建](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/platform/identity.ts:1)、[浏览器身份限制](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/features/library/services/workspace.ts:42)、[拒绝该身份](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/app/workflows/checkpoint.ts:204)、[native workspace 持久身份](/Users/xiaomengdao/WebstormProjects/aifenjing/apps/desktop/src-tauri/src/full_product_store/mod.rs:202)

2. **三个版本不能混用。** native `product_revisions` 与 `change_sequence` 是本机事务守卫；业务模型中有各自 `revision`、`updatedAt`，部分对象完全没有 revision；checkpoint 的 `sha256-v1` 是规范化内容版本。服务需要自己稳定的记录 revision/commit cursor，客户端持久化对应关系，不能用时钟时间戳做唯一冲突依据。[native 内部表](/Users/xiaomengdao/WebstormProjects/aifenjing/apps/desktop/src-tauri/src/full_product_store/mod.rs:26)、[写入修订](/Users/xiaomengdao/WebstormProjects/aifenjing/apps/desktop/src-tauri/src/full_product_store/mod.rs:1178)、[Project 时间戳](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/features/projects/models/project.ts:27)、[Media 模型](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/features/library/models/media.ts:17)、[checkpoint 格式](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/app/workflows/checkpoint.ts:63)

3. **秘密默认留设备。** ConnectorConfig 当前直接带 `apiKey`，SearchConnection 明确 local-only secret；MCP native vault 使用 macOS Keychain/Windows credential store。同步服务凭据与模型密钥是两件事，前者用于访问服务，后者不能由业务记录原样带出。当前 provider 只有 opaque credential handle 契约，没有 vault 或 live authentication 实现。[连接配置](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/features/settings/models/connector.ts:8)、[搜索秘密](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/features/settings/models/search.ts:1)、[MCP vault](/Users/xiaomengdao/WebstormProjects/aifenjing/apps/desktop/src-tauri/src/mcp/vault.rs:25)、[provider 凭据边界](/Users/xiaomengdao/WebstormProjects/aifenjing/.trellis/spec/frontend/checkpoint-protocol.md:25)

4. **历史内容不等于执行权。** mixed 表包括 chat/run/tool call/job/队列；AgentRun 冻结工具、权限、MCP 快照、opaque responseItems，待发送队列拥有预分配 run/message ID 和执行设置。`desktopMediaImports` 虽标 content，仍含 grantId/scanId 与原生执行状态。因此 portable codec 要逐字段审查；可同步历史事实与保留结果，不能让另一设备因收到 `running`、`queued`、`approved` 自动继续执行付费生成、MCP 调用或本机导入。具体“转为中断/只读/需重新授权”的规则属于默默客户端。[运行模型](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/features/agent/models/agent.ts:111)、[队列模型](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/features/agent/models/agentPendingInput.ts:28)、[导入模型](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/features/library/models/desktopMediaImport.ts:14)、[规范要求字段审查](/Users/xiaomengdao/WebstormProjects/aifenjing/.trellis/spec/frontend/shared-product-storage.md:113)

5. **本机设置另行分类。** deviceSettings 明确永不同步；列宽、发送快捷键等仍有少量 localStorage 偏好。业务同步与设备偏好不是同一份导出。[DeviceSetting 契约](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/features/settings/models/deviceSettings.ts:1)、[发送快捷键](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/features/agent/ui/FloatingComposer.tsx:211)、[面板宽度](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/app/layout/panelWidth.ts:25)

6. **“已同步”和“可离线使用”分开。** 媒体有 ready/missing/corrupt；文件缺失必须保留逻辑记录，不能变成同步删除。上传确认只是服务接受，下载后只有完整校验与本地原子应用回执才证明设备已应用。[字节可用性](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/platform/storage/binary.ts:92)、[协议回执语义](/Users/xiaomengdao/WebstormProjects/aifenjing/.trellis/spec/frontend/checkpoint-protocol.md:27)

## 已有 provider 能复用什么，仍缺什么

`CheckpointTransport` 已划出良好边界：`putBinary/readBinary`、`putManifest/readManifest`、`readHead/compareAndSwapHead`、可选历史列表及关闭；capabilities 区分发布、双向、备份、列表、取消、进度、认证和单对象最大尺寸。provider 不接收任意表或本机根目录。[端口](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/app/workflows/syncProvider.ts:17)

其现有算法值得保留：对象键 `sha256:<hash>`；先上传所需对象与 manifest，最后 CAS head；失败候选仍不可变保留；冲突回传 currentHead；下载对指定 workspace/revision 全部校验后才调用应用端；发布回执和应用回执不同。[内容对象键](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/app/workflows/syncProvider.ts:205)、[发布](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/app/workflows/syncProvider.ts:220)、[交付](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/app/workflows/syncProvider.ts:290)

但当前 manifest 类型写死 `momoki.protocol-fixture.v1`、单 projectId、partial project/media；注册/发布实际调用只出现在协议测试。不存在全产品投影、持久应用 ledger、用户同步入口、后台重试、真实 HTTP 服务实现。现有 transport 把整个 binary 作为 Uint8Array，准备结果按内容大小保留；256 KiB 有界哈希并不等于整个同步过程内存恒定。它可做原则和回归用例来源，不能视作生产级 SDK。[测试投影类型](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/app/workflows/checkpoint.ts:6)、[binary 输入与快照](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/app/workflows/checkpoint.ts:75)、[规范的内存说明](/Users/xiaomengdao/WebstormProjects/aifenjing/.trellis/spec/frontend/checkpoint-protocol.md:21)

## 建议的共用服务最小协议

为满足搭搭 R5 的“首次引导后只传变化、不同记录都保留、同记录冲突可恢复”，建议服务以**通用记录变更事务 + 分页变更日志**为主；checkpoint 是引导/备份/压缩历史的应用版本化清单。仅一个全空间 head CAS 也能保护整包，但会把无关编辑都变成空间级冲突，不能直接满足增量记录体验。

| 能力 | 最小契约 | 服务不应理解的内容 |
| --- | --- | --- |
| 空间隔离 | `appId + spaceId`，设备 ID 用于来源；单人自建可用配对密钥/访问令牌，不必先建账户系统 | applet、turn、episode、shot 等产品含义 |
| 记录身份 | key = `collection + entityId`，payload 带应用 `schemaVersion` 或 opaque 编码版本；identity 不从路径/标题推断 | 数据库表结构、React 状态、跨表业务含义 |
| 推送 | 有持久 `operationId` 和请求摘要的原子 batch；每条 put/delete 携 `baseRevision`；成功返回稳定 revision/commit cursor；同 ID 同摘要重试回原结果，不同摘要拒绝 | 自动重跑工具、生成调用或业务命令 |
| 冲突 | 对同 key 的陈旧 base 显式返回当前 revision 与冲突信息；保留本地候选/可恢复版本；不同 key 的离线变更都可接受 | 用服务器时间戳覆盖全部记录或替用户合并任意 JSON |
| 拉取 | 稳定 cursor、分页、明确页终止、删除 tombstone；先有一致引导快照，再按水位拉增量；支持按应用定义的范围过滤 | 将缺页、未授权范围、读取失败当空库或删除 |
| 事务与恢复 | 同一 batch 的关联记录/引用/去重回执原子提交；提供 operation status 查询以处理丢回复；本地应用和 cursor 同事务推进 | 网络成功等于客户端已保存 |
| 二进制对象 | 独立 immutable object API，hash/length/MIME、存在性查询、完整性验证；记录发布前验证引用对象完整；capabilities 宣告大小/分块能力 | 本机文件绝对路径、native capability 或 `Blob` 序列化细节 |
| 演进 | 服务协议版本与 app payload schema 分开；未知协议拒绝，未知应用 schema 客户端留存并拒绝应用；范围变更有新引导/水位规则 | 服务运行两个产品各自数据库 migration |
| 容量和清理 | 明确 byte 单位、分页/批次/对象限制；引用对象保留与 tombstone/cursor 失效可观测；历史清理前要求旧设备重引导 | 取消同步范围就删除服务器数据；无声明地回收仍被版本引用的对象 |

建议 envelope 示例：`{protocolVersion, appId, spaceId, deviceId, operationId, mutations:[{collection, entityId, baseRevision, kind, schemaVersion, payload, objectRefs}]}`。服务支持 JSON 或字节载荷需在子任务定稿；**无论选择何种编码，业务白名单和加密在客户端投影之前/之后的位置必须明确**。若启用端到端加密，服务仍可看见 envelope 身份/版本/长度，payload 与对象另有密文格式；内容哈希仅证明完整性，不证明身份或加密。[现有 hash 限制说明](/Users/xiaomengdao/WebstormProjects/aifenjing/.trellis/spec/frontend/checkpoint-protocol.md:19)

首期可保留二进制 capability，搭搭只使用记录同步；但若首期验收声称“默默跨设备完整可用”，对象传输是必要能力，不能把媒体支持永远留作占位。媒体为图片、视频、音频以及素材历史，体积不能按聊天 JSON 预算。native full-product 当前仅校验 byte length 不超过 JS 安全整数及 MIME 长度，provider 可声明自己的较小限制；本次未读取用户数据，未声称实际存量大小。[native 元数据限制](/Users/xiaomengdao/WebstormProjects/aifenjing/apps/desktop/src-tauri/src/product_binary.rs:346)、[provider 限额检查](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/app/workflows/syncProvider.ts:231)

## 两项目各自适配项

| 层次 | 搭搭（本任务研究与计划） | 默默（该仓需另立实现任务） |
| --- | --- | --- |
| 可携记录 | 配置、应用实例/业务数据、聊天与工具明细分域；轮次只是客户端其中一类记录 | 项目、集/分镜、Studio/IP/素材版本、音频音乐、记忆参考、对话历史等；逐表逐字段 portable codec |
| 本地跟踪 | IndexedDB 事务写入 outbox/同步元数据，兼容旧 localStorage/整包同步身份 | 在 ProductStore 的同一事务边界补 outbox/应用 ledger；浏览器与 native 同契约，device/mixed 投影独立审查 |
| 并发约束 | 沿用实例身份与现有备份/同步兼容；同轮/同配置冲突可恢复 | 关联图和历史闭包，原子变更组；同项目/同素材编辑冲突可恢复，不能仅按 `updatedAt` 重写 |
| 状态与权限 | 同步范围切换与失败不生成伪删除 | 运行、审批、队列、grant、vault、MCP 等本机权力不随历史自动迁移；媒体缺失与逻辑删除分开 |
| 媒体 | 首期无新增附件上传产品，服务接口保持独立对象扩展 | 三种 binary 载体全部覆盖，接收侧验证后 native prepare/claim 或浏览器 Blob 入库，并证明离线读取 |
| 迁移 | 旧备份、Gist/WebDAV/HTTP v1 到新服务的显式可回退引导 | 首次分配/绑定真实浏览器 space；保留既有业务 ID；旧本地 owner 不自动被另一端替换 |

默默**不能使用现有项目 ZIP import 作为同步 apply**：ZIP 是复制项目的导入路径，会为项目与媒体重新生成 ID、重置时间戳并重映射关系，而且本来就不包含全部 Studio/Agent 历史。[ZIP 导出范围](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/app/workflows/packages/projectPackage.ts:95)、[媒体重新映射](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/app/workflows/packages/projectPackage.ts:275)、[项目重新映射](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/app/workflows/packages/projectPackageCodec.ts:801)、[聊天不在项目 ZIP](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/platform/storage/browserDatabase.ts:109)

本机升级接口也不是同步迁移接口：Dexie 有本机 schema upgrade；native registry migration 自动接受旧表定义完全相容的纯新增表，并在本机事务更新 registry；它不会把 IndexedDB 导入 SQLite、把两个 workspace 合并或升级远端产品 payload。[Dexie 版本](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/platform/storage/browserDatabase.ts:130)、[native 相容性](/Users/xiaomengdao/WebstormProjects/aifenjing/apps/desktop/src-tauri/src/full_product_store/registry_migrations.rs:28)、[native 升级提交](/Users/xiaomengdao/WebstormProjects/aifenjing/apps/desktop/src-tauri/src/full_product_store/registry_migrations.rs:149)

## 建议验收边界

- 共用服务用两个无关 `appId`、无关 collection 的客户端契约测试证明没有产品字段耦合；同服务部署互不串数据。
- 每个产品分别证明首次引导、增量分页、重复请求、丢确认后 status 查询、不同记录并发保留、同记录冲突保留候选、明确删除和 tombstone 回放、离线编辑后重连；范围切换不能制造删除。
- 默默另证明浏览器→桌面→浏览器同业务 ID 和关系、三类字节载体完整、缺失/损坏对象不可宣称离线可用、其他设备不续跑付费/本机效果；用隔离空工作区和合成数据，不拿真实数据试迁移。
- 服务确认、本地应用确认、媒体离线完整度分别呈现；发生不确定提交按原 operation identity 查询。默默已有 `UnknownCommitError` 原则可沿用，不能自动重放付费/写入操作。[不确定提交](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/platform/storage/errors.ts:11)、[状态查询契约](/Users/xiaomengdao/WebstormProjects/aifenjing/packages/studio/src/platform/storage/protocol.ts:124)

当前交付仅为研究；上述服务协议、SDK、投影与端到端验收均尚未实现。
