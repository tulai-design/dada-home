# 同步协议与配置范围验收

日期：2026-10-28；基线 `8ff7043`，在 `main` 实现。范围按当前用户授权采用新 v2 格式，无旧实例或同步协议兼容要求。未触碰真实远端、用户令牌或浏览器数据。

## 交付结论

本子任务通过；存储父任务尚未完成。Gist 固定配置范围，WebDAV/HTTP 完整业务快照，严格版本/记录/关联/加密校验、逻辑版本、可恢复入站提交、网络错误与范围提示均已实现。自动同步只上传，完整拉取由用户触发，成功后只读待明确刷新。App/Applet 搬库扩容、聊天分页、共用增量服务和 S3 不在本轮交付。

## 已执行检查

全部使用本机 pnpm，build 子进程 PATH 优先本机 Node/pnpm：

| 检查 | 结果 |
| --- | --- |
| `pnpm test` | 完整现有 Node 回归及新增同步脚本通过，退出码 0 |
| `pnpm exec tsc --noEmit` | 通过 |
| `pnpm build` | 通过；保留现有大 chunk 提示，未做打包优化 |
| `test-sync-providers.mjs` | 13/13：条件写、缺失/错误、Gist raw、UTF-8预算、限流冷却、超时与只读代理 |
| `test-sync-protocol.mjs` | 21/21：公开同步/连接入口、scope、版本/哈希/关联、策略轮换、竞态/重试/重载、资源身份与排队 |
| `test-sync-records.mjs` | 7/7：白名单、私密字段保留、墓碑残留、坏空配置、当前模型与不同应用身份 |
| `test-storage-durability.mjs` | 18/18 |
| `test-storage-backup.mjs` | 16/16，含新 LS-only 日志回退和启动恢复 |
| `test-storage-sync-guard.mjs` | 4/4 |
| `test-sync-browser.mjs` | 11/11，真实 IndexedDB、真实设置及 App，隔离双客户端与模拟网络 |
| `test-storage-browser.mjs` | 23/23，恢复提取后的真实事务、故障、重载、救援和原备份行为 |
| `git diff --check`、任务上下文 validate、相关文档链接检查 | 通过 |

项目没有 lint 命令，未运行或记录 lint。完整 Node 与构建日志为 `/tmp/dada-sync-tests-final.log`、`/tmp/dada-sync-build-final.log`。浏览器证据为 `/tmp/dada-sync-browser-final/results.json`、`/tmp/dada-storage-browser-sync-final/results.json`；临时路径便于本机会话审查，长期复验使用仓库脚本。

浏览器通过指定 `DADA_PLAYWRIGHT_PATH` 使用现有测试工具，不增加依赖。在 `127.0.0.1:5176` 启动 `hmr:false, watch:null` 的专用 Vite，冻结模块后复跑；每个用例使用全新 context，仅共享进程内模拟远端，阻断其他外网。同步最终复跑包含真实首页工作空间经设置按钮上传、首次 PUT 等待新编辑后重载重试。320/375/768/1440 × 明暗主题测量无横溢并检查键盘；实际查看 320 浅色、320 深色安全区和桌面截图。存储 23 项在最后 URL 规范化及空配置校验调整前执行通过；这些调整及最终 persona 私有残留校验后重跑完整 Node/类型/构建，未重复不受影响的存储浏览器套件。

## 审查与修复证据

- Standards：独立 Trellis check 审查完整 `git diff 8ff7043` 与新增文件，PASS；unknown 输入、职责/依赖、宿主主题、公共行为测试和范围文档无新确定规范问题。
- Spec：独立审查发现并已关闭数据覆盖风险：手动刷新前旧缓存可写、提交中切连接、凭据轮换重建基线、首次 PUT 后重试丢新编辑、等价 URL 重建基线。最终协议 21 项独立复验，PASS。见 [提交审查](research/storage-commit-review.md)、[协调审查](research/sync-coordination-review.md)。
- 根会话补充配置墓碑残留与坏配置的区分：保留本机授权/连接不复活配置，损坏空工作空间等不能伪装成删除。独立窄审补获“配置删除后的私有画像/记忆切换完整范围被拒”问题，完整 persona codec 现允许经完整校验的仅私有内容状态，不补回已删性格，也不丢私有业务。配置删除→完整采样→再配置采样，密钥开/关两种均通过。

## 产品边界

- `dada-sync-v2.json` 是快照协议，不是增量同步服务。不读旧文件，不自动删除旧 Gist 内容。
- Gist 没有 CAS；WebDAV/HTTP 仅强 ETag 条件更新提供相应保护。每份业务容器作为一条记录，不承诺逐项合并或多个活跃标签页协作。
- Gist 8 MiB、普通快照 64 MiB 是 UTF-8 正文处理预算，含加密/包装开销，不是浏览器容量或供应商配额。字节统计不含 HTTP 头和实际压缩网卡流量。
- 密钥排除仅覆盖已知字段，源码/自由文本仍可能含敏感内容；关闭密钥同步不能擦除供应商历史。
- 未执行真实账号或真实 WebDAV/CORS 部署验证；本轮没有推送、镜像工作流或服务部署。
