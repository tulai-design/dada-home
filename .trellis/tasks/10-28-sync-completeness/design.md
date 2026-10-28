# 设计与改动边界

业务缺口位于 incrementalAdapters 的投影与入站、incrementalSync/client 的分批控制流、webSearch 的读取边界。

自建服务已经要求客户端加密，因此默认完整同步业务凭据，不复用快照同步的脱敏投影。配置仍使用显式名单/运行时校验。workspace.network 为本机执行授权；同步服务令牌、空间密钥与设备绑定通过设备配对管理，不能覆盖另一台设备身份。缓存、队列、恢复日志保留本机。

配置/组件/应用入站应采用完整业务值，包含显式凭据删除；快照同步保持原策略。补齐业务配置字段、稳定偏好后同时定义校验。单轮分页在同一写入门禁保护下完成：不得暂时清掉 sync-reload 再运行下一页，也不得允许旧业务内存 flush 覆盖新数据。中断后仍保持重载保护，继续操作给出明确状态。

搜索配置归一化以 unknown 为入口，缺 provider/keys/urls 或非法字段安全回落；SettingsPage 与 SearchSettings 共用契约，保留用户已有补丁。

预计改动：incrementalAdapters/相关配置 schema、incrementalSync/client/persistence（只在有必要时）、webSearch/SettingsPage、同步设置说明、相关测试与文档。服务端协议无需改动，不新增外部依赖，不迁移或清理真实数据。

独立审查补充：新增同步 analytics 偏好需要在 initStorage 后初始化统计，并对齐 Umami 本机禁用标记；修复只触及 analytics/main 和对应无网络行为测试。
