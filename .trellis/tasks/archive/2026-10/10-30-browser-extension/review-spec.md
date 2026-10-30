# 规格审查

日期：2026-10-30。基线：`b1df537`；包含当前未跟踪的新文件。审查依据：本任务 prd/design/implement、浏览器扩展契约、保留全部现有功能的用户要求。此次审查只记录问题，不修改产品实现。

## 发现

### P2 · 专注计时系统通知缺少扩展权限

- 处理状态：已修复。主会话补充 notifications；平台断言通过，真实 MV3 通知创建与 show 事件通过，见 verification-notifications.md。下文保留修复前复现。

- 位置：`browser-extension/manifest.json:8`（permissions），对应现有行为 `src/lib/focus.ts:212`、`:224`。
- 触发：在扩展中开始专注计时，离开该页面，等待结束提醒。
- 影响：现有 Web Notification 的授权与显示路径保留，但完整扩展没有声明 `notifications` 权限，无法获得系统通知授权，后台专注提醒功能失效。提示音不等于系统通知功能保留。
- 真实对照：隔离 Chromium 加载当前 manifest，`Notification.permission` 初始 default，用户点击中调用 requestPermission 返回 denied；仅临时副本添加 notifications 后，初始状态和点击返回均为 granted。未修改生产 manifest、未操作用户配置。
- 建议：增加扩展通知权限或对应的可选授权实现；覆盖专注提醒在真实扩展中的授权与触发。

### P2 · 重定向可绕过新增的来源授权门禁

- 处理状态：已修复。HTTP(S) 默认请求改为 manual 检查，遇到 opaqueredirect 明确提示最终地址；显式 manual/error 保留，包内资源不变。`test-extension-network-browser.mjs` 在真实 MV3 中仅允许 127.0.0.1，跳转到未授权 localhost 的请求数为 0；直连成功、手动模式和显式 error 也通过。平台回归 6/6。

- 位置：`src/lib/extensionNetwork.ts:107`—`:111`。
- 触发：用户已允许来源 A，请求 A 时服务返回跨来源重定向到尚未允许的 B，B 允许 CORS。
- 影响：只对初始 URL 调用 permission，随后原生 fetch 默认 follow。B 未经提示仍收到请求且响应可被读取，不满足按外部来源授权、拒绝/撤销后不继续发送到该来源的产品承诺。快照同步显式 redirect:error 已避免此问题，其余默认 fetch 路径受影响。
- 真实复现：隔离 MV3 临时副本仅授予 `http://127.0.0.1/*`，使用当前 extensionNetwork.ts 转译的实际实现，127.0.0.1 的服务重定向到 localhost，同一时刻 `chrome.permissions.contains({origins:['http://localhost/*']})` 返回 false；服务日志仍记录 localhost/data，JS 读回 `unapproved-target-response`。服务为本机合成 HTTP，仅返回 ACAO:*，没有用户数据。
- 建议：禁止未经验证的跨来源重定向并给出明确错误，或在发送下一跳前完成来源授权；补真实重定向回归，避免仅靠 Mock fetch 验证初始授权。

## 其余核对

共享应用复用、Web srcdoc 保留、扩展单次沙盒引导、source/session 校验、单实例初始化、下载/更新指引与数据来源分离、Spline 隔离执行均与已确认设计一致。此前沙盒及 Spline 的实际检查见 verification-spline.md。未执行商店审核、未逐一验证所有外部服务和 Spline 高级场景。
