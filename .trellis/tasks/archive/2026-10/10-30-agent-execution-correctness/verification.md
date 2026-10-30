# A1/A2 验证记录

日期：2026-10-30。实施基线：`bd9fcc4`，分支：`main`。本轮只交付 Agent 执行正确性，不实现评估的 A3–A7。

## 交付与验收

| 验收 | 结果与证据 |
| --- | --- |
| AC1 取消与审批 | 通过。新增 `scripts/test-agent-execution.mjs` 28 项覆盖预先取消、请求中取消、待决审批、迟到允许/总是允许、同批工具边界、AbortError、监听清理和信号传递；协议回归 11 项通过。 |
| AC2 失败语义 | 通过。真实主工具及站点、生活、搜索目录的领域失败、参数失败、用户拒绝与未知异常产生 `ok:false`，解释回传模型；空查询和含失败字样的正常文本保持成功。原有直接工具测试改为校验异常，未靠中文前缀推断状态。 |
| AC3 真实 App | 通过。独立 Chromium 使用 OpenAI/Anthropic 合成 SSE 共 10/10，真实发送、审批、停止、下一轮、工具失败与刷新历史链路均通过。详见 `browser-validation.md`。 |
| AC4 项目检查 | 通过。本机 pnpm 类型检查、完整 test、Web/PWA/扩展 build 均退出 0，`git diff --check` 通过。项目无 lint 命令。 |
| AC5 文档与收尾 | 通过。已更新 AI 工具规范、前端质量入口、运行时契约及原架构评估实施状态；实现已提交为 `3289280`，当前任务已归档并记录日志。双轴审查见下。 |

真实 App 回调回归 `scripts/test-assistant-flows.mjs` 使用实际聊天 schema 规整审批数据，确认对象被重建后当前审批仍可答复、旧 ID/旧 resolver 不影响新审批。发送锁在在途工具结束前保留，取消前已完成副作用保留；异步地名、热榜与书签导入提交前，以及书签推送下一批前均检查取消。

## 检查命令

```sh
/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm exec tsc --noEmit
/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm test
PATH="/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin:$PATH" /Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm build
git diff --check
```

最终日志：`/tmp/dada-a12-tsc.log`、`/tmp/dada-a12-tests.log`、`/tmp/dada-a12-build.log`。构建保留现有大 chunk 提示，本轮没有增加依赖或调整打包策略。

完整测试初轮揭示旧导航测试仍预期失败字符串，随后改为异常断言；另一处页面检查夹具用 `undefined` 绕过必传上下文类型，改为无宿主的 `{}`，保留原不可测报告断言。修正后完整测试通过，没有新增生产兼容分支。

## 双轴审查

基于 `git diff bd9fcc4` 和未跟踪文件独立审查，避免使用提交间空差异。

- Standards：0 项硬偏差，0 项需处理质量建议。核对取消监听、审批身份跨 schema 保留、写入边界和异常传播；审查者另跑类型检查、28 项执行回归及 App 回调回归通过。
- Spec：0 项可行动缺陷。核对 R1–R5，确认取消边界、旧审批/输出隔离、工具结束前发送锁、失败事件与续答一致；无 A3–A7 越界实现。审查者另跑执行回归、App 回调回归、类型检查与差异检查通过。

## 边界

测试不调用线上模型、真实搜索服务或用户数据；真实浏览器仅 Chromium Web 运行形态，不代表 Safari/Firefox、扩展实际运行或移动端视觉验收。已发送扩展请求没有撤销协议，部分只读网络请求须等结束后才释放锁；停止不意味着回滚。`open_search` 保留 noopener，并诚实说明已请求浏览器打开，不能用其正常返回的 null 判定弹窗失败。

原归档缺陷探针保留为历史证据，其断言用于证明修复前缺陷，未改造成新验收或删除。
