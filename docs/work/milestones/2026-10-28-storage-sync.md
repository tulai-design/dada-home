# 存储与可持续同步

日期：2026-10-28。范围已讨论，当前产物为研究和实施计划；没有完成产品存储迁移或服务部署。实际状态以 [Trellis 父任务](../../../.trellis/tasks/10-28-storage-sync/prd.md)及子任务为准。

## 确认的路线

用户确认保留完整的纯本地模式，允许增加可选自建同步服务。先保证可靠保存、恢复和旧同步兼容，再提供长期聊天的增量同步，不强制注册或更换已有存储。

已有聊天与内置组件使用 IndexedDB，App/Applet 业务数据仍在 localStorage；应用的 100000 限制是 JSON 字符串长度，并非浏览器额度。当前 Gist、WebDAV、HTTP 同步按记录合并，但每次读整个快照，有变更时重写整个文件。Gist 原已支持超过正文截断范围时读取 raw_url；其 API 边界及适用判断见[官方资料研究](../../../.trellis/tasks/10-28-storage-sync/research/provider-limits.md)。

## 交付顺序

1. 可靠写入与可恢复备份，阻断存储错误变成同步删除。
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
