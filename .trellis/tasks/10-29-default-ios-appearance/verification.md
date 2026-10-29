# 默认 iOS 外观验证

基线：3d9ce04；分支 main；日期 2026-10-29。

## 已实现

- 用 DEFAULT_APPEARANCE_THEME=IOS_THEME 区分产品默认与纸张 CSS 基底；初始化、无效/缺失选择、删除当前自定义主题回落和全局外观还原采用 iOS。
- Dock 默认 glass；纸张仍可选择，保留显式已保存配置与已有主题显示规则。
- 外观查询从真实 iOS 数据生成默认资料，其他主题当前值继续从纸张 CSS 基底解析，避免 iOS 圆角/字体泄漏。
- README、设计规范、运行时契约及 AI 提示/工具说明与设置按钮同步对齐。
- 没有改首页内容、默认图层、业务数据或存储版本，没有修改用户真实浏览器数据。

## 检查证据

- 本机 pnpm exec tsc --noEmit：实现代理、独立检查代理均报告通过。
- 相关既有脚本：test-appearance 11/11、test-theme-tools 15/15、test-themes 23/23。
- 本机 pnpm test：最终退出码 0。首次完整运行发现 storage-durability 的手写模块替身缺新导出，仅补齐 fixture；该脚本18/18通过后完整重跑通过。
- git diff --check：通过。
- Standards / Spec 独立审查：修正 LayoutSettings 的旧默认按钮文案；无本轮新增行为阻塞项。
- 未运行 build；本项目没有独立 lint 命令。

以上 pnpm 均为 /Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm；未重装依赖。

## 隔离真实浏览器

在本轮启动的 Vite 127.0.0.1:5178 上，用 Playwright 全新 context 执行真实 App；复用 browser-builtin-fixtures 路由，外部字体返回空样式，不请求真实第三方数据。结果记录 /tmp/dada-default-ios-qa.json，截图 /tmp/dada-default-ios-{1440,320}-{light,dark}.png，未提交二进制产物。

- 首次加载：theme.active=ios，data-skin=ios，data-dock=glass，get_appearance 默认资料一致且主题/Dock差异均false。
- 1440×900、320×760，light/dark四组：文档横向溢出0px，圆角12px，主题强调色分别#007aff/#0a84ff。
- 已选择纸张与bar后刷新，选择仍为default/bar。
- reset_appearance全量还原后ios/glass，保留dark与全部组件ID；再次刷新仍正确。
- pageerror为空。人工查看桌面浅色与手机深色截图；字体采用本机fallback，本轮不验证Google Fonts的远程加载可靠性。

## 范围外发现

独立检查确认 readTemplates 用第一个非纸张条目选择快照主题的风险在基线已存在，本轮未改变该逻辑；记录而不扩大本次默认外观任务。
