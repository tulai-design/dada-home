# 共用同步服务仓库与接入计划

日期：2026-10-28。状态：planning；仓库归属已落实，本文件记录职责与后续实施顺序，当前记录、对象与设备服务已实现，SDK与客户端加密基础已实现，产品接入与部署尚未完成。对应[架构决策](../../../docs/decisions/0004-shared-sync-repository.md)。

## 本轮范围

问题是共用服务代码放在哪里、与两个产品怎样协作。当前两端没有接入可部署的共同增量服务。服务必须能够独立测试和发布，产品继续拥有本地数据和业务规则。

用户授权用 gh 后，已创建 [tulai-design/sync](https://github.com/tulai-design/sync) 私有仓库，本地目录 `/Users/xiaomengdao/WebstormProjects/tulai-sync`，默认开发分支 main。初始化内容为README、AGENTS、忽略规则和架构说明，服务自身Trellis和HTTP记录协议现已建立，已交付首个记录同步基础：设备范围鉴权、SQLite原子版本提交、幂等回执、冲突候选与固定水位分页；后续对象与设备阶段又交付有界分块上传/续传、完整性引用、限权配对/即时撤销、离线恢复身份重置。SDK包及客户端加密基础已完成本地验收；产品接入和镜像部署尚未完成。初始文档提交 `40b7799` 已推送到服务仓库 `main`，远端创建和提交均经 gh/Git 确认。

## 仓库结构建议

```text
tulai-design/sync                  # 已建独立仓库；下列模块布局待实现
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
- GitHub CLI创建前核对组织已有`dada-home`、`momoki`、`ai-platform`等，确认无`sync`后按用户授权创建私有仓库；本轮没有改动其他仓库的可见性或发布配置。

上述入口的详细研究见[跨项目存储与服务研究](../10-28-storage-sync/research/shared-service.md)。其中旧兼容/迁移建议已被用户后续“无需旧实例兼容”的授权取代，不在新服务引入旧协议桥。

## 可验证的实施顺序

1. **协议与服务仓库基线**：已建立Trellis、Node内置HTTP/SQLite模块、协议与运行时研究；两个合成应用经真实HTTP写入/读取、作用域隔离、幂等/冲突、重启及固定水位分页通过。首批协议限制记录请求256KiB、单payload128KiB；后续对象阶段已交付1MiB分块/256MiB单对象预算与动态配对设备管理。
2. **可靠增量纵向闭环**：持久化版本/去重回执/变更日志、分页引导、引用发布、设备撤销；模拟丢响应、重启、并发更新、删除/修改冲突，证明原子性与可恢复性。
3. **搭搭客户端接入**：本地写入/outbox一致、入站事务/cursor、离线重试、服务配置与冲突入口；沿用完整配置/应用/聊天投影，拆大工具正文，不把UI加载范围当数据范围。完成两个隔离浏览器实测新增一轮的请求/字节。
4. **发布与部署验收**：固定SDK/镜像版本，持久卷备份恢复、客户端加密/轮换、同机编排及独立域名场景，确认代理与PWA缓存边界。此阶段验收不等于未经授权实际发布或部署。
5. **aifenjing产品接入任务**：在其仓库实现完整portable codec、ProductStore事务和三类媒体载体，分别验证浏览器/桌面。当前子任务只以两种合成投影证明服务通用性；aifenjing产品验收单独记录。

服务可独立发布，两个产品可逐步升级；不同产品的更新不能要求用户同时升级全部项目。服务协议未知版本必须明确拒绝。完整存储父任务仍为4/6，本仓客户端增量同步子任务保持planning，服务记录、对象与设备协议已实现，SDK/客户端加密基础已实现，部署与本仓客户端设计和接入尚未完成。

服务代码与协议事实来源为本地 `/Users/xiaomengdao/WebstormProjects/tulai-sync`，对应服务任务 `10-28-http-record-sync`；此处只记录集成进度，不复制协议正文。首批39项测试通过（存储18、HTTP15、跨进程6），1000条合成历史引导响应620617字节，新增记录请求212/增量响应452字节；不代表产品已接入或生产部署性能。

服务本轮本地提交：`6e226f0`实现与流程、`031a9b7`归档验收；尚未推送。验收在服务仓库`.trellis/tasks/archive/2026-10/10-28-http-record-sync/verification.md`。


对象与设备阶段（2026-10-28）：真实存储、HTTP及进程测试合计76项通过，包含多块重启续传、缺对象整批拒绝、scope/owner隔离、配对与过期/撤销、请求读体途中撤销、备份历史/候选引用闭包。新增离线恢复命令复制到新文件并旋转cursor身份；静态历史设备ID/摘要归属持久保留，禁止退休身份转给新设备。空/未初始化备份拒绝，不当作成功空库。

本阶段服务任务为`10-28-objects-devices`，验收文件归档后在`.trellis/tasks/archive/2026-10/10-28-objects-devices/verification.md`。当前服务父任务完成2/4；下一步为通用SDK/客户端加密和搭搭真实适配。当前仅合成服务验证，未接入两个产品、未做256MiB满容量性能或生产部署验收。本轮服务本地提交为`6ed7caa`（对象/设备/恢复实现）、`5adefd8`（任务归档与日志），未推送或发布。


SDK与加密基础阶段（2026-10-28）：独立服务新增@tulai-design/sync-sdk@0.1.0（尚未发布），HTTP严格校验、有限重试/取消/状态查询/分页、对象续传与暂存下载；原生WebCrypto记录/对象加密、口令包装keyring、追加key轮换保留历史读取。111/111测试、21模块语法及公开类型消费通过；真实浏览器验证Node/Browser双向密文、>1MiB对象与真实HTTP，隔离pack消费者导入与类型检查通过。

这轮源码核对确认搭搭没有真实持久outbox/serverRevision/cursor/inbox仓；当前sync.ts仍整包快照。服务父client任务保留“真实Dada outbox/入站事务”未验收，仅归档SDK子任务，服务主阶段仍2/4。下一步在搭搭为应用数据建立业务+outbox原子保存、版本/入站cursor事务及对象映射；配置跨localStorage/IDB和聊天正文另按实际边界接入，不能仅替换provider URL。研究位于服务父task/research/dada-integration.md。

本轮服务本地提交：`a6c8f92`（SDK/加密实现）、`783e8af`（SDK子任务归档）。验收在服务仓库`.trellis/tasks/archive/2026-10/10-28-sdk-crypto/verification.md`，未推送/发布。
