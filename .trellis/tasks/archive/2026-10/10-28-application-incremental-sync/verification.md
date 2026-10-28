# 验收

日期：2026-10-28。基线：e56ee5c。范围为真实应用业务的程序接入；配置、聊天、设置入口、后台自动同步及部署不在本子任务交付内。

## 质量命令

均使用指定本机 pnpm 路径，PATH 优先本机 Node。沿现有仓库 packageManager=10.20.0（本机入口输出该版本）与 node_modules，不切换或重装既有依赖树；未运行 Codex Runtime pnpm。

- `pnpm exec tsc --noEmit`：通过。
- `pnpm test`：完整通过；新增 codec 6、controller 7、store 10，共23项；应用保存16、备份恢复20、旧快照协议23等既有检查同时通过。
- `pnpm build`：通过（包含类型检查、Vite与PWA构建）。既有依赖 PURE annotation 与大chunk警告仍在；无 lint 脚本，未声称 lint 通过。
- `git diff --check`：通过。

## 真实浏览器与 HTTP

使用 `scripts/serve-application-sync-qa.mjs`，真实 Tulai Sync HTTP/SQLite 与真实 Dada 模块/IndexedDB；两个随机 loopback origin，每个独立设备令牌，共用临时空间与密钥。浏览器通过 CUA 打开回归页并点击运行，没有真实用户数据、远端账户或生产服务器参与。最终10组全部通过：

1. 首次绑定前的应用种子、约2.13MB分块对象、90层嵌套、长中文/emoji/孤立surrogate ID、已知凭据过滤。
2. 第二次新增只产生1次commit、27字节加密对象正文；离线保存后重建页面恢复持久队列。
3. 服务器已提交但响应被丢弃后，查询原operation；期间新编辑最终保留，恢复阶段只再提交新版本1次。
4. 同记录冲突保留双方，显式保留本地后双端收敛。
5. 删除/修改冲突保留双方；逻辑墓碑与空对象put不同。
6. 下载中断不推进cursor；下载期间编辑成为本地候选，与远端同时保留。
7. 真实IDB入站事务abort后业务、版本和cursor一起回滚，重试接收成功。
8. 第三个同源iframe持有旧缓存，保存CAS拒绝，另一标签新值未被覆盖。
9. 活动同步绑定期间非apps/配置提交失败、回滚也失败，保留恢复日志；恢复重试成功且不改apps。
10. 本地保存事务abort后业务与意图一起回滚；活动绑定拒绝apps整包恢复，解绑后恢复与纯本地保存可继续。

最终统计：179个API请求、15次commit尝试（含冲突）、14个对象创建/完成、16次上传分块、对象上传正文2,131,277字节、commit正文23,946字节、总请求正文2,157,104字节。只统计Fetch对应正文，不含HTTP头或压缩后的网卡流量。

截图：`/tmp/dada-application-sync-verified.png`。可重复入口为 `tests/application-sync-regressions.html`；每次启动使用新的临时空间/origin。未运行旧完整 `test-storage-browser.mjs`；其两处手造恢复日志更新为v4，新的真实恢复用例覆盖本次边界。

## 双轴审查

Standards：交叉代理审查非自己实现的存储和controller/codec。发现并修复：冲突解决仅守卫本地generation会允许旧选择覆盖新远端，现同时守卫remoteRevision；inspect读取旧epoch档案，现按索引读目标epoch。复核通过。

Spec：独立代理发现非apps失败回滚全仓误触活动apps绑定，现恢复日志v4仅记录实际触及仓，新增单元和真实恢复回归。最终报告见 `research/spec-review.md`。这类恢复日志为本机内部格式，备份格式仍v3；遵循用户允许全新测试模型，不添加旧日志兼容桥。

Docker依赖安装层增加vendor复制，CI与构建镜像使用Node24.11.0以匹配SDK声明；不触发线上workflow。本机 Docker daemon 不可连接，未执行镜像构建；已检查 Docker install 层的本地包路径与 CI Node 版本，不能将此写成 Docker 验收通过。

固定SDK来自独立仓库a6c8f92，tarball摘要见vendor/README；没有服务/SDK源码变更，没有发布npm、推送或部署。
