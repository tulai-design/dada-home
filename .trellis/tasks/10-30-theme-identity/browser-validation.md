# 主题身份浏览器验收记录

日期：2026-10-30

脚本：`scripts/test-theme-identity-browser.mjs`。脚本为每个场景创建新的 Chromium context，拦截字体和模型请求，只使用本地 fixture；不会读取真实浏览器 profile、真实 API key 或访问外部模型。

## 基线红证据

在基线 `5a9e675` 的真实 Vite App（`DADA_QA_URL=http://127.0.0.1:5173`）运行：

```sh
DADA_PLAYWRIGHT_PATH=/Users/xiaomengdao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright \
DADA_QA_URL=http://127.0.0.1:5173 DADA_QA_FILTER=ios-1440 \
/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/node scripts/test-theme-identity-browser.mjs
```

结果：`1/6` 通过，主题身份目标按预期失败：

- iOS 派生后的根节点回落为 `data-skin=paper`，说明派生记录没有保留实现来源；此红色场景没有运行 Switch/Win98，不能用它宣称对应 renderer 也已实测。
- 写入共享 `main=#8844cc` 后实际元素颜色仍为 `rgb(0, 122, 255)`，被原 iOS 模式主色遮蔽。
- 修改浅/深色分支后仍丢失 iOS 造型；重载阶段旧 fixture 的注册表缺少动态应用配置，出现 `registry.ts normalizeConfig` 错误，待核心数据变更稳定后复核。

完整结果保存在 `/tmp/dada-theme-identity-browser/results.json`（仅本机临时证据）。

## 绿色验收结果

核心与 UI 接线完成后，使用独立端口 `http://127.0.0.1:5197` 和隔离 context 运行完整矩阵，结果 **109/109 通过**：

- `default`、`ios`、`pixel`、`switch`、`win98` 的桌面和 390px 视口派生；检查实际 DOM 颜色、skin、字体、外壳节点与窄屏无溢出。
- 同外壳变体切换时保留待办输入、应用 iframe/canonical ID/初始化次数、助手草稿和分栏状态；撤销/重做后仍保留运行 DOM。
- Switch 内容路由在变体切换后仍可恢复；Win98 最大化/最小化仍可恢复。
- 保存、重载、模板采用按精确主题 ID 往返；浅色/深色实际颜色来自页面元素。
- 审批卡在派生主题后仍保持连接，停止与允许路径分别验证。
- Switch/Win98 的 `fonts:[{family:'Noto Serif SC',role:'sans'}]` 实际元素字体栈含新字体名称；字体网络为 fixture，仅证明字体栈，不证明真实字体下载。
- Switch/Win98 清空设计后仍保留 skin/shell、必需 `switch-focus` / `win98-face` token 与外壳控件可计算样式。

脚本故障或环境问题应单独记录；未运行的场景不能标记为通过。运行完整命令：

```sh
DADA_PLAYWRIGHT_PATH=/Users/xiaomengdao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright \
DADA_QA_URL=http://127.0.0.1:5197 \
/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/node scripts/test-theme-identity-browser.mjs
```

独立 Vite 启动命令为 `/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm exec vite --host 127.0.0.1 --port 5197 --strictPort`。最终结果保存于 `/tmp/dada-theme-identity-browser/results.json`，截图包括 `switch-390-dark.png`、`win98-1440-dark.png` 与 `lifecycle-switch-split.png`。

## 验收脚本修正说明

以下修正只处理验收夹具，不是产品修复，也没有降低状态保持的断言：

- 开发入口的 `__tada` 在 App 完成动态 registry 注册前已经可用。脚本改为等待真实 `.app` 挂载，再调用 workspace；Switch 启动器和 Win98 桌面可合法不显示首页 widget，不能拿 widget 可见性当作启动条件。
- iframe 输入框拥有焦点时宿主收不到 `Meta+j`；先把焦点归还 body，再打开助手。
- 撤销/重做使用真实命令菜单，避免 Vite 的动态 import 命中另一份 store 模块实例。
- 模板保存双模式设计，当前模式仍按已有 `mode/base` 合同决定；模板采用后显式切到 dark 再验 dark 分支，主题身份与完整设计断言仍保留。
- 显式修改 sans 字体后，现有 `font-serif:var(--font-sans)` 的计算值也会改变。脚本先断言新字体实际栈，再以已确认的新设计作为后续模板/重载对比，不要求它仍等于修改前的字体。

## 既有主题回归

同一隔离 Vite `http://127.0.0.1:5197` 上运行以下脚本，环境变量与上述完整命令相同，只替换最后的脚本路径：

| 脚本 | 实际结果 |
| --- | --- |
| `scripts/test-switch-content-browser.mjs` | 通过；全部内置内容页双模式、桌面/390px/AI 分栏，热榜和书签链接、订阅筛选与阅读、待办和便签输入 |
| `scripts/test-win98-theme-browser.mjs` | 通过；66 个布局场景及桌面/开始菜单/窗口/内容交互 |
| `scripts/audit-builtin-theme-content-browser.mjs` | 通过；纸张/iOS/掌机共 132 个页面/视口/模式场景、18 组手机日历点击和回车添加，无横溢、底栏遮挡或运行异常 |

这三个原有脚本也存在首次 `goto` 后 `__tada` 先于 registry 可用的夹具竞态；Win98 脚本的 reload 也相同。仅增加 `.app` 挂载等待，保留原有全部验收断言。首次启动失败不计作产品回归；修正夹具后完整重跑得到上表结果。基础主题报告位于 `/tmp/dada-builtin-theme-content-report.json`。

Agent 原浏览器矩阵由主会话另行在 5198 端口运行并记录；本文不代替主会话对该矩阵的证据。
