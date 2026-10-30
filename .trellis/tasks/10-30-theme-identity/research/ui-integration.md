# UI 身份与派生接线研究

日期：2026-10-30；基线：5a9e675。

## 已确认调用边界

- App.tsx 原按 theme.id 设置 dataset.skin、Switch/Win98 结构、Dock 呈现及头像初始化。改为统一 resolveTheme 的 skin/shell；主题实例 ID 仅保留在库选择与命令菜单。
- App.tsx 的 [theme.id] effect 会把 Switch 内容退回启动器、把 Win98 已打开/最小化/最大化状态清零。依赖改为 shell，保证同外壳换色和另存不重置。
- AppearanceSettings 的外框开关原仅识别内置ID；改消费 capabilities.frame。Win98 不显示外框/装饰组，派生后仍保持该呈现。
- SidebarSettings 原按实例ID决定玻璃/像素Dock与Win98任务栏说明；改为 skin/shell。SettingsPage 的主机设置布局使用 shell。
- tools.ts 的 save_theme 需要新增 from 参数并传领域函数；list_themes 展示 skin/shell/origin、双模式有效值及来源；共享main覆盖的描述与真实合并规则一致。
- ai.ts 有两处“另存丢外壳”禁令，修复后应删除，并说明完整派生与显式来源。长期运行时设计规范由主会话同步。
- pageInspector 只记录明暗，无实例ID判断，本切片不增加报告协议。Dock纯函数接现有布尔参数即可，无需改变公开函数。

## 验证

真实工具测试补充五内置派生身份、主色/来源读回、显式来源另存以及更新来源拒绝不提交；生命周期由独立真实App浏览器回归观察输入/DOM/应用初始化与窗口状态，不以源码字符串断言代替。

## 本轮接线与检查记录

- App 根样式与 skin/shell 判断接入 resolveTheme，CSS 变量只消费统一 overrides，不再本地合并字体与 frameOff。
- 新增工具回归在旧实现运行时，派生记录缺少身份且列表未披露身份，产生红色结果；接线后等待核心接口稳定再重跑。
- 已独立通过 test-assistant-layout.mjs 6/6、test-assistant-navigation.mjs 13/13、test-application-window.mjs 8/8。这些检查几何与导航，不代替真实浏览器生命周期验收。
- 首次 tsc 因核心类型与 resolveTheme 尚未写入而失败，待稳定后重跑；未将其记录为通过。
- 核心接口落盘后，`pnpm exec tsc --noEmit` 通过；`test-theme-tools.mjs` 17/17 通过，包含五内置派生、共享主色有效值与来源、显式 from、非法 from 及更新来源拒绝不提交。初次工具运行明确得到 `skin: undefined` 与预期 `paper` 不符，之后转绿。
- UI 导入检查：SettingsPage 的备份读取与确认委托 storage.ts readBackup/importBackup；工具模板操作仅来自既有库和内置预设。备份严格校验由主会话在 storage.ts 补齐。
- Switch focus/封面和 Win98 标题仍使用已有独立 token；main 不自动重写这些语义。本轮未改 CSS。
