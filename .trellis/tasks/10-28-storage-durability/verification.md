# 验收记录

日期：2026-10-28。基线 `7991440`；直接在 main 开发。测试使用内存替身、全新 Chromium context 和本机临时服务，阻断外部请求，不使用用户真实存储或同步配置。

## 质量门禁

- `/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm test`：全部通过。新持久化 18/18、备份 14/14、存储/同步隔离 4/4 已接入现有完整测试链。
- `/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm exec tsc --noEmit`：通过。
- `PATH="/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin:$PATH" /Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm build`：通过，生成 PWA。构建仍有大体积 chunk 提示，本轮不做打包优化。
- `git diff --check`：通过；项目无独立 lint 命令。
- Standards/Spec 交叉审查完成；问题、修复与限定边界见 review.md。
- HTML App 桥接补测：真实 AppBlock message 入口验证后台 `set` 在恢复期间/回退失败后拒绝且不改原值，恢复后正常写入。加入现有 `test-app-runtime.mjs`，4/4 通过；没有改变应用存储位置和容量。

## 浏览器证据

真实 Chromium 脚本 `scripts/test-storage-browser.mjs` 的最后全套 23/23 通过。入口为 `tests/storage-regressions.html` 和真实 App；用干净 Vite module graph、关闭 HMR，避免并行修改污染隔离测试。

复用命令：

```sh
DADA_QA_URL=http://127.0.0.1:5175 DADA_PLAYWRIGHT_PATH=/Users/xiaomengdao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright /Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/node scripts/test-storage-browser.mjs
```

Playwright 由本机现有工具提供，未增加项目依赖。其他环境应设置其实际 `DADA_PLAYWRIGHT_PATH`。脚本只接受 localhost/回环地址，新建隔离上下文，外部网络和公共取数代理被阻断。

- 真实 IDB 读写异常与事务 abort 不冒充成功，多仓 batch 整批回退；批次内后续请求同步抛错时不产生未处理的 Promise 拒绝。
- 组件 put/delete/重入 flush、失败重试与重载保留最终值；聊天流式写后立即导出、会话快速切换保持原归属。
- 旧聊天无 API、事务失败、读回失败不删除来源；重试不重复迁移。坏 JSON、缺字段和重复 ID 原文保留；其他合法组件仍可迁移。
- 坏备份替换前零变更，恢复、回退再失败保留日志，重载或同页权限恢复后回退原 IDB/配置；主 App 维持编辑门禁。
- 升级 blocked、关闭旧连接后重试、versionchange 重开验证通过；无 IDB 启动错误可恢复 API 后重新读取。
- 设置页真实点击导出并下载，用产品解析入口验证包含按钮点击前未刷盘的最新组件、配置和已有聊天。
- 启动救援真实下载保留损坏旧原文，标识为 `dada-local-rescue`；严格备份解析拒绝将其作为完整备份，读取失败不下载空文件。
- 320/375/768/1440 宽度 × 浅色/深色的保存失败提示无横溢、按钮可命中，重试成功后原输入节点及内容保留；先旧警告后 quota 时优先显示保存错误。目视核对 320 浅色、1440 深色及启动页截图。

基线回归证明：`DADA_STORAGE_QA_BASELINE_DB=7991440` 在相同隔离浏览器替换真实旧 db 模块，严格读写测试为红；不 checkout 共享产品文件。额外旧聊天重复 ID/缺字段用例修复前红、修复后绿。

本机临时输出 `/tmp/dada-storage-browser-final/results.json`、截图和构建/测试日志仅作本次佐证，长期可复用证据以仓库脚本为准。

## 验收结论与范围

PRD 六项验收已覆盖。256 MiB 是整包 JSON 处理预算；恢复要求 Web Locks，已开其他业务标签需先关闭；导出不锁流式回答，不宣称跨引擎原子快照。损坏配置原样导出用于救援，需修复后再导入。

仅交付本地可靠性子任务；AI 应用存储迁移/容量、聊天分页、Gist 配置范围、v1 协议并发和独立共用同步服务均保持父任务后续，不以本验收代替。
