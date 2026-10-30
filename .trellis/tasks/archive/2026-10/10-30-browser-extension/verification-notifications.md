# 专注通知权限修复验证

日期：2026-10-30。修复通知权限遗漏，保留现有 `focus.ts` Web Notification 提醒路径。manifest 已补 `notifications` 权限，平台测试断言覆盖该权限，不改变原专注计时和隐藏页面提醒条件。

## 已运行

- `node scripts/test-extension-platform.mjs`：6/6 通过，含通知权限静态契约和新增重定向行为。
- `DADA_PLAYWRIGHT_PATH=…/playwright node scripts/test-extension-notification-browser.mjs`：通过。脚本从真实 manifest 创建临时最小 MV3 扩展，使用独立 Chromium 配置目录和当前包图标；去掉新标签页覆盖和沙盒以只验证权限，不启动用户主页。
- 点击处理器中的 `Notification.requestPermission()` 返回 granted，初始权限也是 granted；`new Notification('专注完成', …)` 的标题、正文与 tag 正确，收到原生 show 事件，没有 pageerror，随后关闭该测试通知。未 Mock Notification。

## 限制

此项证明该测试 Chromium 中通知可获准并被浏览器接受创建，不代表操作系统横幅一定可见。未检查 macOS 通知中心、勿扰模式、用户关闭浏览器通知、其他操作系统或 Edge 的展示设置；未等待完整专注周期，也没有声称系统级端到端提醒全部通过。此轮未自行重建完整包，主会话最终 build 会将新增 manifest 权限纳入交付 ZIP。
