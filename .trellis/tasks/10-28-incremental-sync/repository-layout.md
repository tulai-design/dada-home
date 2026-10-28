# 共用同步服务仓库与接入计划

日期：2026-10-28。状态：planning；本文件确定建议的归属与实施顺序，不代替尚未完成的协议design，也不宣称服务或SDK已实现。对应[架构提案](../../../docs/decisions/0004-shared-sync-repository.md)。

## 本轮范围

问题是共用服务代码放在哪里、与两个产品怎样协作。当前两端没有接入可部署的共同增量服务。服务必须能够独立测试和发布，产品继续拥有本地数据和业务规则。

本轮只读核对组织仓库和aifenjing关键端口，写仓库归属、发布边界与实施拆分；不修改产品运行时代码、不创建远端仓库或发布依赖。GitHub仓库名建议`tulai-design/sync`，本地目录建议`/Users/xiaomengdao/WebstormProjects/tulai-sync`；名称和可见性是待定的仓库创建信息。

## 仓库结构建议

```text
tulai-design/sync                  # 拟建独立仓库
  apps/server/                    # 服务、持久化和管理命令
  packages/protocol/              # 协议类型、输入校验、错误与能力声明
  packages/client/                # 无产品依赖的轻量传输SDK
  tests/contract/                 # 两种无关应用投影、重试/隔离/冲突
  deploy/                         # Docker、持久卷、备份恢复
  docs/                           # 服务协议唯一正文、运维与版本说明
  .trellis/                       # 服务自身的开发任务与规范

tulai-design/dada-home            # 当前仓库
  本地队列、搭搭投影、入站事务、同步设置与冲突UI

tulai-design/momoki               # 本地目录 aifenjing
  ProductStore接入、完整业务投影、媒体恢复与冲突UI
```

这是单个独立仓库中的模块划分，不表示需要三个服务、三个仓库或三个进程。包是否发布及具体包名在首个可工作的跨仓闭环中确定，避免空SDK先发版。

## 接口职责

| 通用服务/协议/SDK | 产品客户端 |
| --- | --- |
| appId + spaceId隔离、设备令牌及撤销 | 用户选择同步空间、连接设置、设备本地凭据保管 |
| 记录版本、mutation去重、原子提交、变更游标 | 业务ID映射、可同步字段、稳定mutation生成与持久outbox |
| 明确冲突回执和可恢复版本 | 关联业务记录怎样恢复、冲突选择界面、应用前版本守卫 |
| 有界对象上传下载、完整性/引用检查 | 工具正文或媒体对象拆分、原生文件prepare/claim、离线可用性判断 |
| 协议错误、取消、同operation重试与状态查询 | 本地数据与入站cursor事务、队列保留、错误展示和重连调度 |

共享SDK不建立第二套业务库，不接受任意本机路径，不按产品表过滤秘密，不因收到运行历史就执行工具或任务。加密数据格式与密钥轮换也必须进入协议设计；访问令牌和加密口令仍分离。

## 源码核对

- 搭搭`server/start.mjs`及`.trellis/spec/backend/data-proxy.md`是静态服务/取数边界；`src/lib/sync.ts`是整包快照流程，不能仅换URL当作增量服务客户端。
- 搭搭`src/lib/storageCommit.ts`、`db.ts`和`store.ts`分别涉及恢复屏障、IndexedDB事务和小配置写入。接入设计必须说明业务写入与outbox如何一致；localStorage与IndexedDB没有共同事务。
- aifenjing `packages/studio/src/platform/product/store.ts`在启动选择本地owner；同步应用应通过其业务事务，而非服务直接操作Dexie/SQLite文件。
- aifenjing `packages/studio/src/app/workflows/syncProvider.ts`已有不可变对象、manifest/head CAS原则，但类型依赖该产品的CheckpointManifest/WorkspaceId；不能原样搬到通用SDK。
- aifenjing `packages/studio/src/app/workflows/checkpoint.ts`仍是`momoki.protocol-fixture.v1`、partial project/media投影；`.trellis/spec/frontend/checkpoint-protocol.md`明确缺少完整生产codec、真实鉴权和native落盘验收。本轮只读复核，不声称已经具备完整同步产品。
- GitHub CLI本次列出的组织仓库有`dada-home`、`momoki`、`ai-platform`等，未见`sync`；远端状态仅代表本次读取。

上述入口的详细研究见[跨项目存储与服务研究](../10-28-storage-sync/research/shared-service.md)。其中旧兼容/迁移建议已被用户后续“无需旧实例兼容”的授权取代，不在新服务引入旧协议桥。

## 可验证的实施顺序

1. **协议与服务仓库基线**：确定仓库创建信息，建立独立文档/Trellis与最小模块；补齐服务协议design、运行时/数据库驱动依据、批次及对象预算、鉴权初始化和错误码。先让两个合成应用经真实HTTP写入/读回并证明隔离。
2. **可靠增量纵向闭环**：持久化版本/去重回执/变更日志、分页引导、引用发布、设备撤销；模拟丢响应、重启、并发更新、删除/修改冲突，证明原子性与可恢复性。
3. **搭搭客户端接入**：本地写入/outbox一致、入站事务/cursor、离线重试、服务配置与冲突入口；沿用完整配置/应用/聊天投影，拆大工具正文，不把UI加载范围当数据范围。完成两个隔离浏览器实测新增一轮的请求/字节。
4. **发布与部署验收**：固定SDK/镜像版本，持久卷备份恢复、客户端加密/轮换、同机编排及独立域名场景，确认代理与PWA缓存边界。此阶段验收不等于未经授权实际发布或部署。
5. **aifenjing产品接入任务**：在其仓库实现完整portable codec、ProductStore事务和三类媒体载体，分别验证浏览器/桌面。当前子任务只以两种合成投影证明服务通用性；aifenjing产品验收单独记录。

服务可独立发布，两个产品可逐步升级；不同产品的更新不能要求用户同时升级全部项目。服务协议未知版本必须明确拒绝。完整存储父任务仍为4/6，当前增量服务子任务保持planning，协议设计和实现未完成。
