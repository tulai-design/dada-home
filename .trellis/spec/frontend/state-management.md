# 状态与持久化

## 工作空间与编辑

[workspace.ts](../../../src/lib/workspace.ts) 定义页面、组件、应用、主题与模板结构。[ops.ts](../../../src/lib/ops.ts) 负责结构编辑与验证，[workspaceStore.ts](../../../src/lib/workspaceStore.ts) 负责提交、本地存储、迁移、订阅和撤销/重做。

新增结构写操作遵循“读取当前工作空间 → 纯函数返回新结构 → `commit`”。不要直接修改 store 内对象或从工具写 `localStorage`。编辑前规整配置，导入和历史数据读取也要经过迁移/读取校验，不能只保护新建路径。

主题实例 `id` 只用于库选择；渲染与生命周期分别消费 `resolveTheme` 的 `skin` 和 `shell`。派生必须完整复制设计，不能仅保存补丁或按实例 ID 选择桌面；同 shell 变体切换不重置窗口状态。主题和模板内主题的 unknown 校验复用 `themes.ts`，显式备份/同步入站必须先严格校验再写入，不能用宽松读取丢弃坏主题后宣称成功。结构版本 8 的当前合同包含受控 recipes/shellConfig，见[主题、外观与模板](../../../docs/specs/runtime-contract.md#主题外观与模板)。作者草稿只在内存，异步预览与字体等待后必须重核源、选择和版本，再向最新工作空间单次提交；详见[主题作者合同](../../../docs/specs/theme-authoring.md)。

`migrate` 会恢复固定首页、规整主题和应用记录等。结构变更需考虑旧快照、模板导入、缺失字段和无效组件；不能只让新初始化的数据可用。首页布局草稿通过独立内存状态、首页冲突检查和一次正式提交实现，见[首页草稿规范](homepage-drafts.md)；不能把它扩大理解为全工作空间或业务数据事务。

## 数据分离

完整新标签页扩展采用启动前独占运行实例策略：等待页不初始化业务缓存，持有 Web Lock 才启动应用/自动同步；不得用心跳过期抢锁或在等待页提前读写业务。此约束不表示 Web 版已支持多标签页协同编辑，详见[扩展契约](../../../docs/specs/browser-extension.md)。

- 页面、组件配置与主题属于工作空间；见 `workspaceStore.ts`。
- 实例私有业务数据使用 [componentData.ts](../../../src/lib/componentData.ts)；IndexedDB 可用时使用库，否则回落到本地存储。
- 全局小设置通过 [store.ts](../../../src/lib/store.ts)；聊天和组件大数据由 [db.ts](../../../src/lib/db.ts) 与 [storage.ts](../../../src/lib/storage.ts) 初始化。
- 应用用户设置和业务状态分离：设置进入安装记录，业务状态使用 Applet `persist` 或 App 的 `tada.store`。

[applications.ts](../../../src/lib/applications.ts) 是应用安装记录的入口。应用取消页面挂载、关闭窗口、最小化和卸载是不同操作，不得混用。卸载应用保留私有数据的语义与普通组件移除不同，修改时查对应调用链，不凭名称推断。

## 保存确认与故障

数据库读写不得吞错回退空表或成功；请求成功后仍须等待事务完成。多仓关系数据通过 `db.batch` 在同一事务同步排入，统一快照使用 `db.snapshot`，不要跨 await 拼接看似原子的写入。

组件/聊天队列记录最新操作并串行 flush，只确认实际提交的版本；失败保留待写项，后台拒绝也须登记在 `persistence.ts`。配置存储保留即时内存行为，失败使用可重试的最新值，不能把旧闭包快照重放为新值。坏旧 JSON 与实际权限/事务错误分开处理；保留来源，不能删掉唯一原文。

读权限失败的重试必须实际重读，成功后清除对应状态；连续失败不得发布默认值，也不能重置首次失败的版本基线而覆盖期间的用户编辑。聊天使用新的纯schema边界，不为旧格式加迁移；组件既有迁移仍保留来源保护。

导出和同步共用保存屏障，失败不继续生成远端删除或空备份。恢复持有同标签门禁，等待已有工作并使用独立恢复日志；日志仅属于本机，不纳入业务导出/同步。恢复回退也失败时停止编辑并保留日志；后续启动必须先处理日志再初始化业务或同步。不要宣称 localStorage/IDB 跨引擎原子性、导出覆盖所有并发片段或多个活跃标签页安全协作。详见[本地保存契约](../../../docs/specs/runtime-contract.md#本地保存与恢复)。

## 快照同步边界

用户已允许测试阶段采用新存储与同步模型，不要求旧实例或旧协议兼容。`syncProtocol.ts` 定义当前 wire，`syncData.ts` 定义记录 codec，`syncProviders.ts` 处理网络，`sync.ts` 负责协调。不要把 HTTP 成功、JSON 可解析或未知旧版本当作合法空快照；未知范围、目标、记录值和关联必须在任何写入前拒绝。

配置同步与完整业务同步共享显式白名单，并在出入站使用相同校验。Gist 只承载配置；本机授权、连接与运行状态不得伪装成配置记录，任意 `fp.*` 或数据库仓名不能成为远端写入权限。添加新业务类别时同时定义合法形状、导出、导入、本机字段保留和删除语义。逻辑身份不依赖当前物理存储位置，App 与 Applet 同名实例保持不同身份。

记录使用逻辑计数与设备标识排序，内容摘要由规范化 JSON 生成；不可用同毫秒时间戳推断内容相同。元数据按提供方资源、范围与协议隔离；策略改变要更新快照表示，即使业务值未变。关闭密钥同步后应重新投影整个出站快照，不能仅清理本次改动记录。

网络期间的本地修改不得被远端或旧采样覆盖；在共用保存门禁内应用前再次检查。恢复提交抽到不依赖同步模块的 `storageCommit.ts`，供备份与同步共用，不能形成运行时循环依赖。成功拉取后仍保持重载保护。用户没在输入时页面自行重新加载；正在输入则等离开输入框再加载，不盖全屏，也不再要求点确认。业务缓存尚未热更新时，提交后必须保持专用只读门禁直到重载；仅提示刷新却继续编辑会让旧内存覆盖新磁盘值。

只有强 ETag 条件更新才标为有并发保护；Gist 或未提供强 ETag 的服务如实提示无保护。初次创建与已有文件更新条件分开，限流使用有界退避时间并在冷却期零网络。字节预算按 UTF-8 正文计算，不能当作浏览器存储额度或供应商配额；精确网卡流量不在 Fetch 可观测范围内。

## AI 应用业务存储

App/Applet 只走 applicationData 仓库，apps 专仓按类型+canonical实例ID隔离，不能复用 componentData 裸 ID 或回退 localStorage。纯 schema 统一 JSON/8 MiB UTF-8 校验；读取失败不初始化空状态，事务提交后才确认保存。队列独立于 React/iframe，失败保留最新 pending；导出/恢复/同步屏障必须等待已调用但尚在读取初始化的写入。Applet 的保存回执绑定运行会话和序号，不能在发送时标记成功。版本变化需关闭连接并设置 db-reload 写入门禁，不能让旧内存重新开库写回。完整行为见 [AI应用存储](../../../docs/specs/runtime-contract.md#ai-应用存储)。

## 聊天分页与工具正文

聊天UI只消费StoredTurn分页元信息；工具正文经readToolDetail单条读取。不得从可见数组缺席推断删除或从已加载页构造模型上下文。显式append/patch/appendTool绑定convId+turnId，活动轮独立于导航；loadContextTurns独立查最新N轮并沿用contextTurns预算。索引游标使用时间+ID且exclusive，失败不推进；在途读取需保留期间已确认的本地更新，不能仅靠flush后已清除的dirty覆盖旧快照，读取结束释放临时overlay。导航和删除按会话归属撤销请求，删除其他会话不能遗留分页loading。新增工具头和正文同db.batch提交，已保存正文不随回答重写；删除整个会话用key-only索引包括未加载数据。备份严格五仓交叉引用，sync仍完整逻辑Turn原子合并，不增加远端独立正文记录。详见[长期聊天合同](../../../docs/specs/runtime-contract.md#长期聊天与模型上下文)。

## 自建加密增量同步

`incrementalStore` 负责本机 epoch/generation/draft/prepared/版本/冲突/游标，SDK负责通用协议与加密。config/component/applicationData/conversation/turn 的完整业务值均加密同步；不得复用快照脱敏投影删除业务 API Key、端点、订阅 URL 或普通 keys 字段。完整入站替换须传播凭据删除，不能补回旧密钥。配置名单与新增字段校验在 `incrementalConfigSchema`；本机执行授权、设备身份与协调状态排除。

应用保存与draft同db.atomic事务；密码学/网络禁止进入同步决策函数。prepared随机密文及operationId首次发送前持久化，旧确认只清对应generation。入站值、版本、冲突和cursor同事务；配置用待应用行跨越IDB/localStorage，启动先重放。冲突解决同时检查观察时的generation与revision。绑定阻止业务表整包替换，恢复日志仅回退实际触及仓；旧cache的generation写回明确拒绝。

手动同步先上传再在同一保存门禁内逐页拉取；第一条应用后维持sync-reload，不能让后续页重新经过writable断言，也不能flush旧缓存。IDB已提交后即使配置落盘/网络失败也保留重载提示。预算耗尽不得报完成。不是运行实例热更新。详细边界见[加密增量同步](../../../docs/specs/application-incremental-sync.md)。

搜索配置是部分持久对象，`webSearch.normalizeSearchConfig` 接收 unknown 统一规整；设置摘要、详情、readiness 与工具入口都必须使用该边界，不能假定 keys/urls 已存在。
