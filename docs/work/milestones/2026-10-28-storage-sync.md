# 存储与可持续同步

日期：2026-10-28。本地可靠保存子任务已通过验收；AI 应用迁移与服务仍是后续，未部署。实际状态以 [Trellis 父任务](../../../.trellis/tasks/10-28-storage-sync/prd.md)及子任务为准。

## 确认的路线

用户确认保留完整的纯本地模式，允许增加可选自建同步服务。先保证可靠保存、恢复和旧同步兼容，再提供长期聊天的增量同步，不强制注册或更换已有存储。

后续进一步确认服务要供搭搭与 aifenjing 共用：通用记录版本/不可变对象归服务，业务投影与本地应用归各客户端，见[跨项目审查](../../../.trellis/tasks/10-28-storage-sync/research/shared-service.md)。Gist 收敛为配置同步；WebDAV 可以保留全部数据，S3 技术上也可承载全量但尚未接入。完整范围不意味着每次都重传所有历史。

已有聊天与内置组件使用 IndexedDB，App/Applet 业务数据仍在 localStorage；应用的 100000 限制是 JSON 字符串长度，并非浏览器额度。当前 Gist、WebDAV、HTTP 同步按记录合并，但每次读整个快照，有变更时重写整个文件。Gist 原已支持超过正文截断范围时读取 raw_url；其 API 边界及适用判断见[官方资料研究](../../../.trellis/tasks/10-28-storage-sync/research/provider-limits.md)。

## 交付顺序

1. **已交付**：可靠写入与可恢复备份，阻断存储读取/保存错误变成同步删除；含旧数据迁移保护、可见失败与重试。
2. 既有同步的协议、加密策略、并发与供应商错误处理。
3. AI 应用迁入 IndexedDB，保持应用和旧同步记录身份。
4. 聊天分页与工具大内容按需读取，保留完整历史。
5. 可选自建同步服务与客户端：游标、幂等、离线重试和冲突恢复。
6. 分类容量、同步范围、导出和清理管理。

依赖和验收在[实施地图](../../../.trellis/tasks/10-28-storage-sync/implement.md)维护；架构边界见[设计方向](../../../.trellis/tasks/10-28-storage-sync/design.md)。不把「创建任务」写成「功能已交付」。

## 研究证据

- [本地持久化](../../../.trellis/tasks/10-28-storage-sync/research/local-storage.md)：失败确认、队列、迁移与备份。
- [聊天增长](../../../.trellis/tasks/10-28-storage-sync/research/chat-growth.md)：上下文与长期历史的区别、工具正文和加载成本。
- [现有同步](../../../.trellis/tasks/10-28-storage-sync/research/sync.md)：整包传输、入站竞态、加密策略与旧协议兼容。

研究夹具只转译真实模块并使用内存存储和模拟网络；复现缺陷不是修复验收。没有使用用户真实数据或远端账号。

上一轮 [AI 搭建增强](2026-10-27-ai-builder.md)的 9 个子任务已交付，父任务组合验收仍待完成，保持独立跟踪。

本地可靠性本轮检查：完整 Node 回归、类型检查、生产构建通过；隔离 Chromium 覆盖真实事务/升级、迁移、重载、恢复回退及四宽双主题提示。具体复用入口和边界见 [可靠保存验收](../../../.trellis/tasks/10-28-storage-durability/verification.md)；构建有 chunk 体积提示，未在本轮做打包优化。
