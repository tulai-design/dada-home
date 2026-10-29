# 掌机主题实施

## 顺序

1. 在 `src/lib/workspace.ts` 增加 `PIXEL_THEME` / `PIXEL_THEME_ID`，四色和共享尺寸按 `design.md`。
2. `src/lib/themes.ts` 的 `readThemes` 注入该预设，并忽略存储里的同 id 副本。内置项放在 iOS 之后，避免打乱现有「第 2 条是 iOS」的测试。
3. `src/App.tsx` 按主题 id 开关 `data-skin="pixel"`。
4. `src/lib/dock.ts` 的 `visibleDock`：掌机启用且存储预设为 `glass` 时显示 `solid`，不写存储；`bar` 保持。
5. `src/theme.css` 写 `:root[data-skin='pixel']`：纸纹和波纹、顶栏色带、搜索框、卡片、分段控件、设置分组、手机顶栏隐藏与内容滚到 Dock 下。手机规则放在 `max-width: 760px`，设置单栏标题放在 `max-width: 860px`，和 iOS 的断点一致。
6. `src/assistant-split.css` 里窄分栏的设置标题使用同一套掌机材料。
7. 像素字：选定可商用字体后放进仓库，只在皮肤里 `@font-face`。第一版可以先用拉丁像素字加无衬线中文，字库子集作为同一任务里的后续步，不单独拆主题。
8. `src/lib/ai.ts` 补切换说明。
9. 更新 `scripts/test-themes.mjs`：注入、不可改删、旧副本被覆盖。若有 Dock 测试，补上「掌机不把玻璃写进存储」。

## 检查

使用 `/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm`。

- `exec tsc --noEmit`
- 主题与 Dock 相关测试
- `build`
- 浏览器：浅色和深色下看首页、设置列表、设置详情；手机宽度看系统顶栏隐藏和内容滚过 Dock；切回纸张和 iOS，确认红框、毛玻璃和白卡片还在。

## 风险

- `readThemes` 的注入顺序会碰到 `scripts/test-themes.mjs` 里 `loaded[1]` 必须是 iOS 的断言。新预设不要插到它前面。
- 手机设置的顶栏和 Dock 叠放要抄 iOS 已验证的结构，选择器必须带 `data-skin='pixel'`，避免纸张页也被拉高或藏起顶栏。
- 像素字体文件若过大，先子集，不把整库中文打进首屏。
