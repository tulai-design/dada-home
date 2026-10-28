# 实施顺序

2026-10-28：前轮完成源码审查、官方边界核对和任务拆分；本轮已完成 storage-durability 并通过验收，后续子任务未实施。用户进一步要求搭搭与 aifenjing 共用独立同步服务，后续服务按通用对象/版本模型设计。未迁移用户真实数据或部署服务。

| 顺序 | 子任务 | 可观察交付 | 依赖 |
| --- | --- | --- | --- |
| 1 | [storage-durability](../10-28-storage-durability/prd.md) | 已交付：保存失败可见并可重试、并发不回退、备份完整可恢复 | 无 |
| 2 | [sync-v1-hardening](../10-28-sync-v1-hardening/prd.md) | 现有同步不把故障当删除，策略变更确实重写，坏包不覆盖 | 1 |
| 3 | [application-storage](../10-28-application-storage/prd.md) | AI 应用安全迁入 IndexedDB，原应用和旧设备同步继续可用 | 1、2 |
| 4 | [chat-history-storage](../10-28-chat-history-storage/prd.md) | 大会话分页，明细按需读取，完整历史仍可恢复 | 1；可与 2/3 独立推进 |
| 5 | [incremental-sync](../10-28-incremental-sync/prd.md) | 可选服务+客户端两设备增量闭环，离线/冲突可恢复 | 2、3、4 |
| 6 | [storage-management](../10-28-storage-management/prd.md) | 容量、同步范围、清理/导出和迁移状态可管理 | 3、4、5 |

## 执行边界

每个复杂子任务激活前补其 design/implement、读取并验证 jsonl；父设计只约定职责，不冒充完整实现方案。遵循已获授权推进，不重复询问已确认的本地优先+可选共用服务路线。具体新依赖与部署变更须有选型依据；发布仍单独授权。Gist 仅配置范围在 v1 子任务实施，WebDAV保留全数据；S3已有技术可行性依据但不声称仓库已支持。

源码入口：`src/lib/db.ts`、`componentData.ts`、`chat.ts`、`storage.ts`、`sync.ts`，应用宿主 `src/widgets/app.tsx` / `applet.tsx`，同步 UI `src/components/SyncSettings.tsx`。服务阶段再读 `server/start.mjs`、Docker/nginx/compose/Vite/PWA。应用迁移仍须沿用新保存屏障和错误状态，并覆盖兼容身份、容量与回退，不能只更换 API 就宣称迁移完成。

## 检查

- 先把研究中的隔离故障复现转为公开行为回归，再改实现；模拟 quota、事务 abort、网络中断/重试和并发两设备，不使用用户真实数据。
- 本地保存使用真实 IndexedDB 浏览器隔离上下文验证；内存替身不能代替实际事务、升级、重载证据。
- 迁移覆盖两类应用旧数据、混合旧/新记录、半迁移、卸载保留、旧备份、v1 远端旧 ID 与同源旧标签页。
- 服务和客户端必须一条纵向链路验证：认证→首次引导→离线改动→重连增量→冲突→重启→恢复；数据使用合成大历史，记录实际传输字节。
- 产品代码改动后运行对应脚本、完整 `test`、`exec tsc --noEmit` 和必要 `build`；使用本机 pnpm，项目无 lint。UI 另验手机/分栏、双主题和键盘。
- 每项双轴审查并记录证据，通过后本地提交；不凭子任务完成数直接归档父任务。

## 组合验收

父任务最终覆盖：旧应用数据→可靠迁移→本地编辑→立即导出/恢复→Gist或WebDAV兼容→选择新服务→两设备离线新增/修改/删除→重连→关闭服务继续使用→清理范围确认。验证格式、权限、加密、失败反馈和容量显示一致。

原 `10-27-ai-builder` 保留待办组合验收，不在本次存储研究中误归档。
