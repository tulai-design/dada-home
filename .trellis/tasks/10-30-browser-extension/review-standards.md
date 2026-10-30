# Standards 最终审查

日期：2026-10-30。固定基点 `b1df537`；审查 `git diff b1df537` 以及当前任务新增、尚未跟踪的实现、测试和文档。此审查不修改产品代码，不代替主会话最终全量检查。

## 结论

当前复核未发现尚未修复的规范阻塞项。检查依据为根目录 AGENTS.md、`.trellis/spec/frontend/index.md`、`state-management.md`、`quality-guidelines.md`、`.trellis/spec/ai/tools-and-apps.md` 及 `docs/specs/browser-extension.md`。

审查期间发现 `scripts/test-extension-platform.mjs` 末尾仍断言只有一个 sandbox 页，新增 Spline 后会导致完整测试失败。已通知主会话，沙盒代理改为验证两个声明页及 CSP 隔离约束；本次重新运行该脚本已通过，不列为未决问题。

## 边界复核

- `src/main.tsx:91` 与 `src/lib/extensionWorkspace.ts:6`：完整应用仅在持有 Web Lock 后动态导入并初始化，等待页面不调用存储初始化或自动同步。入口静态依赖中的存储模块仅建立空状态/监听，不预读业务数据；接续页首次持锁后读取最新持久化。无锁时显示启动错误，不使用过期心跳抢写。
- `src/lib/extensionNetwork.ts:30`：权限请求在用户点击调用栈内发起；同来源合并只共享浏览器授权，单个请求取消不取消其他等待请求。拒绝、异常、超时通过原调用的失败路径反馈。`src/lib/platform.ts` 将预授权接口与 React/权限界面解耦，Web 不安装适配。
- `src/lib/rss.ts:34`、`src/widgets/app.tsx:183`、`src/lib/syncProviders.ts:140`、`src/lib/incrementalClient.ts:146`、`src/lib/syncService.ts:83`：等待扩展授权发生在业务/SDK 网络计时之前。应用原有域名授权仍先校验，纯本地同步绑定/冲突操作不额外申请网络权限。
- `browser-extension/background.js:4`：原生书签与工作空间消息限定本扩展发送者；工作空间定位使用 session 存储记录并再次检查目标 URL，后台休眠重启后不会依据标签顺序误认等待页。manifest 不增加 tabs/history/网页内容读取权限。
- `src/lib/extensionSandbox.ts:5`、`browser-extension/sandbox.js:6`：扩展走 manifest 隔离页，Web 保留 srcdoc；bootstrap 只接受直接父窗口的一次初始化。原 App/Applet source/session、写入确认、域名校验继续沿用；重新建立运行会话时更换 iframe。
- `browser-extension/manifest.json:38` 与 `browser-extension/sandbox.html:5`：普通扩展宿主不允许 unsafe-eval，两个 sandbox 都无 allow-same-origin；生成应用页进一步收紧 connect/frame 等策略，Spline runtime/Worker 放在独立隔离页。Spline 错误发送到现有特效错误边界。
- `src/lib/extensionCloseGuard.ts:14`：只在排队/在途写入或阻塞保存故障时提示并启动保存屏障，已提交同步/数据库重载门禁不当作未保存；不提前释放工作空间锁，不把 beforeunload 当作可 await 事务。
- `scripts/build-extension.mjs:11`：共享主页构建与独立 Spline IIFE 均产出本地代码；包内 config 为空，过滤顶层下载 ZIP，不复制用户存储。扩展模式排除 PWA，网页保留 PWA；`vite.config.ts:122` 已包含动态 App 的静态同步依赖预缓存。

## 本次运行

- `node scripts/test-extension-platform.mjs`：5/5。
- `node scripts/test-extension-background.mjs`：4/4。
- `node scripts/test-extension-workspace.mjs`：3/3。
- `node scripts/test-extension-close-guard.mjs`：4/4。
- `git diff --check b1df537`：通过。

没有运行或声称运行 lint。最终完整 test、TypeScript、Web/扩展 build 和完整浏览器验收由主会话汇总；此前本代理实现阶段的定向测试结果不等同于本次重新运行全部检查。

## 残余验证范围

原生可选权限确认弹窗的真实批准操作仍需人工验证；成功网络链路的临时预授权夹具不能替代该确认。Spline 已有公开简单场景与画布 resize 的真实 MV3 证据，但高级物理/Draco/Gaussian 资源没有逐项实测。强制关闭、浏览器崩溃或系统终止不能保证异步保存完成；现有文档已如实说明。未进行 Edge 专项执行或商店审核，不能将 Chromium 验证表述为这些检查已通过。
