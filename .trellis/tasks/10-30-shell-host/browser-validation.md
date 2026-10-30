# 稳定外壳宿主浏览器验收

日期：2026-10-30。前项基线：`63f6586`（主题身份），归档提交：`62db7cb`。

## 首轮红证据

脚本 `scripts/test-shell-host-browser.mjs` 使用真实 App、真实公开工具、命令菜单和键盘，所有场景新建隔离 Chromium context；模型与远端数据由 fixture 接管，不接触真实用户 profile、存储或网络。初始化先等待 `.app` 挂载，避免开发调试入口先于组件 registry 可用的竞态。

在主会话专属 Vite `http://127.0.0.1:5198` 运行：

```sh
DADA_PLAYWRIGHT_PATH=/Users/xiaomengdao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright \
DADA_QA_URL=http://127.0.0.1:5198 \
/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/node scripts/test-shell-host-browser.mjs
```

结果：**13/19 通过，6 项目标缺陷按预期红色**。

| 场景 | 实际观察 |
| --- | --- |
| 同路由依次 iOS→Switch→Win98→iOS | 三次均使原待办输入 DOM 断开，未提交输入无法靠原节点保持；应用 iframe/canonical ID/初始化一次与助手草稿三次都保持 |
| Switch 内容返回主屏 | 原输入 DOM 被销毁；再次从命令菜单打开同一“书桌”后节点未恢复，2 项失败 |
| Win98 最小化 | 原输入 DOM 保持，但没有 inert 祖先，1 项失败；同目标命令仍能恢复窗口与输入 |
| 待决审批跨三外壳 | 审批 DOM 始终保持；停止仍取消当前轮且未删除页面，全部通过 |
| 运行异常 | 无未捕获异常 |

结果文件：`/tmp/dada-shell-host-browser/results.json`，失败截图同目录。以上红结果观察的是既有公开产品行为，没有假设尚未落地的新内部 API。

## 绿色完整矩阵

核心与宿主接线稳定后，在同一独立 Vite `http://127.0.0.1:5198` 运行以上完整命令，结果 **122/122 通过**。完整控制台输出在 `/tmp/dada-shell-host-final.log`，统一结构化结果在 `/tmp/dada-shell-host-browser/results.json`。

- 首轮 6 项缺陷均绿色：同 route 跨三外壳的原输入 DOM 与未提交值保持、Switch 主屏隐藏而不销毁、Win98 最小化 inert。
- 三外壳（iOS 普通、Switch、Win98）×浅深×1440/390/320/1024 AI 分栏共 24 场景：原输入实际可编辑，无画布/文档横溢；隐藏同步 hidden/inert/aria，实际不可见；同目标命令恢复原输入节点与值。该矩阵分组结果为 81/81（包括各场景与运行异常总检查）。
- 同 route 换外壳保留真实 modal iframe、canonical ID、应用初始化次数 1、应用未保存输入、助手草稿；待决审批卡 DOM 保持，停止仍取消本轮而未执行。
- modal 与 drawer 附着应用在 Win98 标题栏真实最小化点击后隐藏，原 iframe 和输入保持；恢复后初始化次数仍 1。应用本身已经最小化时，恢复外壳不会覆盖其自身最小化事实。
- Reader 采用明确长正文夹具与 synthetic 模型流生成摘要，隐藏与恢复保留同一 Reader DOM、文章标题和摘要；隐藏时连续 Tab 六次不进入 Reader 或应用 iframe；窄分栏 Reader/应用 drawer 的实际几何均处于 canvas 和标题栏保留区。
- 新增 `tests/shell-host/{index.html,fixture.tsx}` 为内部 registry 测试入口，不增加生产测试主题、不放宽持久化 schema。使用真实 `ShellHost`/`ShellCanvas`、`ApplicationHost` 沙盒运行器、`Assistant`、`ApprovalCard` 与生产 `resolveShellTheme`；第四 Adapter 只实现并注册自身。
- 第四 Adapter 不同 hooks 数切换、监听 cleanup、重复 ID 拒绝、隐藏/同目标 revision 恢复；事件错误、NaN descriptor、超界保留区、缺失 Switch/Win98 请求、渲染错误均实际回落 paper/standard。检查根 skin/data-shell、真实画布几何、原输入/iframe/init/助手草稿/审批节点保持，恢复 UI 的设置、助手及停止入口均通过真实点击执行。此分组 14/14。
- 完整运行结束后补一条 Switch 设置 selector 回归：普通 TopBar computed display 为 none、宽设置报头可见，定向 **3/3 通过**，结果在 `/tmp/dada-shell-host-settings/results.json`。命令增加 `DADA_QA_FILTER=switch-settings-header DADA_QA_OUTPUT=/tmp/dada-shell-host-settings`。
- 正式页面检查器定向 **4/4 通过**：通过 synthetic 模型的真实 ask→`inspect_page`→下一轮模型工具结果读取 App 宿主报告；可见书桌返回 status ok、page.visible true 与非零 viewport；Win98 最小化后返回非 ok、page.visible false 和明确 not-mounted/hidden unknown。没有使用 `__tada.call` 的空 host 冒充检查。命令增加 `DADA_QA_FILTER=inspector-visibility DADA_QA_OUTPUT=/tmp/dada-shell-host-inspector`，结果在同目录 `results.json`。
- Win98 外部同目标成功激活清理开始菜单，定向 **3/3 通过**：菜单内保留焦点，数字快捷键 `2` 走宿主导航执行器重新打开当前书桌，菜单关闭、窗口继续可见；不靠点击菜单外部的 dismiss 事件掩盖 activation revision 行为。命令增加 `DADA_QA_FILTER=win98-activation-menu DADA_QA_OUTPUT=/tmp/dada-shell-host-menu`，结果在同目录 `results.json`。
- Spec 审查修正后的后台页面失效回归 **7/7 通过**：删除书桌后台页时，当前设置页与称呼输入保留原 DOM 和输入；modal/drawer/page 三种活动应用均保留原 iframe、canonical ID、初始化次数 1 和未提交输入；真正正在显示书桌且无活动应用时，删除后成功回退首页。命令增加 `DADA_QA_FILTER=background-page-removal DADA_QA_OUTPUT=/tmp/dada-shell-host-page-removal`，结果在同目录 `results.json`。此定向运行在该导航修正落盘后的 fresh contexts，不以较早完整运行代替验证。

代表截图重截时等待命令面板淡出结束，避免残影；Switch 与 Win98 两个定向场景各 **5/5 通过**，干净截图分别位于 `/tmp/dada-shell-host-clean-switch/matrix-switch-dark-320.png`、`/tmp/dada-shell-host-clean-win98/matrix-win98-dark-split.png`。第四 Adapter 截图为 `/tmp/dada-shell-host-browser/fourth-adapter-fallback.png`。

## 验收修正与实际缺陷

- 新实现允许跨壳初始显示启动器/桌面，附着应用合法隐藏。运行器状态断言使用 attached/`includeHidden`，同时保留原 iframe DOM、初始化次数和输入值；隐藏是否真的不可见另行断言，不将“可见等待超时”当成丢运行状态。
- 首次旧短文章夹具被产品的摘要正文长度策略拒绝；Reader 场景改用足够长的明确 RSS 正文，再验证真实摘要，不绕过产品策略。
- 真实 Drawer 曾覆盖 Win98 标题栏，脚本保留真实点击而未 force。宿主修正通用 `--shell-*` 保留区 inset 后，同一点击与隐藏/恢复通过。窄分栏另测抽屉 max-width 边界。
- 一次运行期间 HMR 导致原 DOM 被替换，冻结后 fresh context 重跑跨壳 13/13 与最终全量 122/122 均通过；未弱化节点身份检查。

真实正常路由变化、显式关闭和应用 surface 变化仍按已有生命周期，不扩大零重挂承诺。页面检查器隐藏拒绝通过上方真实 Agent 定向场景验收。

## MV3

主会话最终 build 成功后，使用真实 `dist-extension` 运行已有扩展浏览器回归，**14/14 通过，退出码 0，errors=[]、cspErrors=[]**。

```sh
DADA_PLAYWRIGHT_PATH=/Users/xiaomengdao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright \
DADA_EXTENSION_QA_OUTPUT=/tmp/dada-shell-host-mv3 \
/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/node scripts/test-extension-browser.mjs
```

结果：`/tmp/dada-shell-host-mv3/results.json`；控制台输出：`/tmp/dada-shell-host-mv3.log`。真实临时 Chromium profile 加载扩展，验证完整 ZIP/manifest、默认 iOS/玻璃 Dock、App/Applet 外部 ESM 与交互/重载保存、主题热切换、窄屏浅深、未授权网络拒绝、原生书签桥、双标签独占与接续、安装更新指引、独立窗口设置热更新、真实设置导出/网站恢复/PWA 离线、宿主流式模型请求。测试仅使用合成应用、本机服务和临时 profile，不访问用户真实模型和浏览器数据。

MV3 此回归覆盖构建与现有扩展实际功能；内部第四 Adapter/故障注入仅在上述 Web 测试 harness 验证，不宣称生产扩展中存在可安装的测试主题或开放任意代码加载。
