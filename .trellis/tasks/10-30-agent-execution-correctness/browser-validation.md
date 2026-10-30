# A1/A2 真实浏览器验证

日期：2026-10-30。入口为真实 App、真实聊天发送和审批卡片；Chromium 使用独立临时上下文，不读取用户浏览器配置、数据或模型凭据。模型侧在页面 Fetch 边界提供合成 OpenAI Chat Completions / Anthropic Messages SSE，实际执行产品 runAgent、工具、工作空间提交与 IndexedDB 聊天保存。

## 命令与结果

用本机 Node/pnpm 新启动隔离开发服务，避免长时间运行的 Vite 在源码编辑后存在不同 `?t=` 模块实例，使测试读取到另一份聊天模块状态：

```sh
PATH="/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin:$PATH" /Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm dev --host 127.0.0.1 --port 5177 --strictPort

DADA_QA_URL=http://127.0.0.1:5177 DADA_PLAYWRIGHT_PATH=/Users/xiaomengdao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright /Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/node scripts/test-agent-execution-browser.mjs

/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/node --check scripts/test-agent-execution-browser.mjs
```

浏览器 **10/10 通过**，脚本语法检查通过，无未捕获页面错误。外网请求及取数代理全部被拦截；字体等非本轮网络资源不可用不作为 Agent 执行失败。

| 行为 | OpenAI | Anthropic |
| --- | --- | --- |
| 待决删除审批点停止，卡片消失、发送恢复，轮次带 endedAt/aborted；页面保留，同批后续 add_page 不执行且模型请求只有一次 | 通过 | 通过 |
| 下一轮出现独立审批，旧 DOM 按钮不能答复新审批；当前允许后实际删除、工具成功标记与模型续答一致 | 通过 | 通过 |
| 搜索审批停止后旧“总是允许”按钮不保存授权、不打开标签页；再次审批仍等待，拒绝后产生失败工具并正常续答 | 通过 | 通过 |
| 模型流输出后点停止，轮次记录取消，迟到输出不污染回答 | 通过 | 通过 |
| rename_page 引用不存在页面，实际领域错误成为 ok:false；模型得到解释并续答，界面显示“未完成”与失败图标；刷新并从历史打开后失败标志和正文保留 | 通过 | 通过 |

首次真实 UI 回归发现对象引用无法识别经聊天 schema 复制后的审批请求；实现修正为稳定审批 ID 后，正常允许与旧审批隔离均通过上述回归。浏览器脚本没有读取 React 私有属性或手动调用审批内部闭包。

## 证据与限制

- 结构化结果：`/tmp/dada-agent-execution-browser/results.json`。
- 真实失败工具界面截图：`/tmp/dada-agent-execution-browser/openai-failed-tool.png`、`/tmp/dada-agent-execution-browser/anthropic-failed-tool.png`，不纳入仓库。
- 合成模型仅提供协议消息，不替代真实工具、聊天 UI 或持久化；本次未调用线上模型或真实搜索服务，未覆盖 Firefox/Safari、扩展运行形态或移动端布局。
- 旧元素引用上的 DOM click 只证明卸载卡片不会再操作当前 UI，不能证明任意迟到回调安全；后者由独立执行行为回归验证。
- 运行中异步工具的协作取消与取消前已提交效果保留属于隔离行为测试范围，本脚本不把停止解释为回滚。
- 重新验证源码修正后，应重启开发服务或使用新的隔离端口，再运行上述命令。
