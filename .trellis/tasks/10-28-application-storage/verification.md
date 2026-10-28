# AI 应用统一 IndexedDB 验收

日期：2026-10-28。基线 a16b81b，main 本轮工作树；用户允许按新模型开发。结论：通过。未使用用户真实浏览器数据、远端账户或生产同步服务。

## 交付

- App/Applet 独立 apps 仓及 canonical 类型/实例身份；8 MiB UTF-8 JSON 预算、严格 JSON 校验、引用隔离与按需加载。
- 真实读取成功后才初始化；并发单键合并、串行提交、事务确认后成功、失败保留最新待写值并可重试；屏障覆盖尚在初始化的保存。
- 两类沙盒会话隔离、重复/迟到消息保护；Applet 声明式保存回执、读取失败/保存失败/重试反馈与全局状态一致。
- 备份与恢复日志 version 2，四仓必填；reset、导出、恢复回退和完整同步覆盖应用记录。当前备份拒绝旧业务入口，原样救援导出不静默丢弃来源。
- versionchange 关闭连接并禁止旧页面再次开库/写入，提示重载。AI运行时说明、README、规范与实施地图同步。

## 实际检查

使用本机 `/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm`；build 的 PATH 同样优先本机 Node/pnpm。

| 检查 | 结果 |
| --- | --- |
| exec tsc --noEmit | 通过 |
| 完整 test | 通过；含应用仓14、App运行时6、Applet运行时10、备份17、可靠保存18、同步屏障5、提供方13、协议22、记录8 |
| build | 通过；沿用已有 virtua PURE注释、chunk体积提示，无新增构建失败 |
| test-application-storage-browser.mjs | 12/12，通过真实主App创建两类应用、16万字符中文/emoji精确读回、关闭/刷新/设置/挂载/卸载撤销、立即关窗、abort/quota、超预算、读取失败、无IDB |
| test-storage-browser.mjs | 24/24，含非空apps快照回退/中断恢复、旧键清库前拒绝、versionchange及故障提示 |
| test-sync-browser.mjs | 12/12，含两设备应用大数据往返/刷新、同名App/Applet/component隔离及应用墓碑 |
| 图表/数据表浏览器 | 两脚本全部通过，四宽双主题、窄容器、交互与真实runner状态保留 |
| application-layout-regressions.html | 5/5，真实iframe尺寸/设置变化不重置 |
| git diff --check | 通过 |

应用故障提示在320px/1100px、浅色/深色、减少动画条件下测无横向溢出；查看320px双主题截图，错误内容和重试按钮可读。浏览器在隔离Chromium上下文运行，网络只允许本地或测试拦截，不调用真实AI/远端同步。

复用：`DADA_QA_URL=http://127.0.0.1:5176`、`DADA_PLAYWRIGHT_PATH=<已安装Playwright入口>`，本地无HMR Vite。临时证据在 `/tmp/dada-application-storage-browser/`、`/tmp/dada-storage-browser/results.json`、`/tmp/dada-sync-browser/results.json`；完整检查日志 `/tmp/dada-application-storage-tests.log` 与 `/tmp/dada-application-storage-build.log`。脚本保留在仓库可重复运行。

## 独立审查

Standards：最终 PASS。发现的两项P2均关闭：显式undefined被pick省略导致删除字段，改为仅缺自有字段才省略并增加真实runner回归；新版备份夹带旧业务键导致替换后启动失败，改为清库前拒绝并验证零写入。独立复验Applet10/10、备份17/17。

Spec：PASS。身份、并发、确认、读取失败、重试最新值、预算、备份/同步/重载合同无剩余缺漏。主代理完成最终全套与真实浏览器验收，后续修改未改变范围。

## 边界

8 MiB是每实例产品预算，不承诺浏览器一定有可用配额。无旧应用值迁移/双写；当前备份不接收旧格式或旧业务入口。仍为快照同步，无跨标签同时业务编辑保证；恢复前关闭其他标签。长期聊天分页、共用增量同步服务、容量管理及父任务组合验收继续由其他子任务交付。未推送或部署。
