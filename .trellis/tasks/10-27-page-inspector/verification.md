# 页面检查器验收

日期：2026-10-27。审查基线：`a8a4775`，含工作区未跟踪新增文件。主分支直接开发，本轮不创建 PR、不推送或发布。

## 已交付行为

App 注册当前真实页面根节点，在 React 提交后记录页面与 workspace 身份和 revision。`inspect_page` 经 ToolHost 等待有界的两帧布局，返回可解析的 JSON；AI 修改后可以再次调用。页面 viewport 使用 clientWidth/clientHeight，content 使用 scrollWidth/scrollHeight，分栏下取左侧真实容器。

采样器检测组件外框横向溢出、实际裁切与零尺寸，并返回稳定 issue ID、组件 ID/type、selector、数值依据和修正方向。合法局部滚动与表格、隐藏 applet runner 不误报。未挂载、隐藏、无布局盒、未知页、宿主缺失、陈旧渲染与布局等待超时明确说明；未测环境为 null，iframe/Canvas 内部、对比度和审美保持未知。

只采几何与允许的宿主特效标记，不读正文、聊天、value/HTML、iframe文档或像素，不导航、不提交 workspace/history。背景 portal 不在采样范围，运行标记不证明实际帧率或成功绘制。

## 红绿与行为证据

- 公开工具初次红测因 `inspect_page` 不存在失败；接通后通过真实工具工厂执行，返回 JSON、原始取消信号和参数，所有路径 commit 次数为0。
- DOM sampler stub 返回空问题时，真实 Chromium 夹具失败“宽组件应有一条可定位问题”；实现后900px组件在640px容器内报告260px溢出，max-width修复后同一问题消失。
- 夹具包含负向裁切、零尺寸、内容宽高、合法横纵滚动与表格、iframe/Canvas未知、私密值不泄露或修改、effect标记、隐藏/空/未挂载页面，以及宿主默认/显式当前/其他已知/未知页面。
- 新增 stale-render 公开宿主回归，防止 workspace 更新但 DOM 未提交时冒充最新结果；两帧、取消与250ms超时都验证资源清理。
- 真实 provider → runAgent → dispatch → inspect_page → 宿主 → 模型结果回灌通过，仅隔离网络和无关持久化模块。
- 浏览器矩阵：320/375/768/1280px × light/dark，共8组，深色组同时设置减少动画。每组验证实际容器尺寸、稳定问题标识、溢出→修复→复查、隐藏未知与私密内容边界。
- 实际 App smoke：隔离的新Chromium context，假密钥/假网关、所有其他远程请求被拦截。真实点击Logo开分栏并发问，2次假模型请求完成工具回灌；1440px窗口内报告793×948，与.page实测一致，data-split=true；fp.workspace前后逐字相同。没有访问用户现有context或真实模型服务。

## 双轴审查

- Standards：无明确规范违背，无阻断异味。核对 refs与提交时机、取消清理、工具转发、只读与隐私、目录职责、提示词/技能/文档一致性。
- Spec：发现滚动祖先掩盖外层裁切的P2；第一次修复又将祖先空白裁切误归给80px可见组件。最终按根到组件累计可访问区间，仅按真实滚动范围和当前偏移扩展。独立Chromium复验400×200 hidden页面下的四个成对场景：500px容器+80px组件不报、500px组件报裁切、100px局部滚动承载500px组件不报、scrollTop350不报。两项均关闭，未遗留阻断。复盘见 bug-analysis.md。

## 最终检查

- 本机 pnpm `exec tsc --noEmit`：通过；最后 build也包含同一类型检查。
- 本机 pnpm `test`：全量通过，包含6组检查器工具/宿主/模型回灌回归。首次全量发现旧ask AST夹具缺少新增宿主回调，补齐只读stub后重新全量通过。
- 本机 pnpm `build`（子进程PATH优先本机bin）：通过。保留原有第三方PURE注释与大chunk告警，未新增依赖或改包管理器。
- `scripts/test-page-inspector-browser.mjs`：最终8/8通过。
- `git diff --check`、Trellis上下文validate、修改文档的本地链接检查：通过。
- 本项目没有lint脚本，未记录虚构lint结果。

浏览器复验命令：

```sh
DADA_PLAYWRIGHT_PATH=/absolute/path/to/playwright/index.js node scripts/test-page-inspector-browser.mjs
```

默认开发地址为 `http://127.0.0.1:5175`，可通过 `DADA_QA_URL` 指定；浏览器工具由调用者提供，不加入生产依赖。

## 未验证与后续

未连接真实付费模型执行自主修改，不宣称模型在任意请求下都会主动检查。没有截图、多模态、实际对比度、完整无障碍、Canvas/iframe内部或FPS验收。后续推进page-sections，再将首页组合/草稿和本检查器接入同一修正流程；父任务保持进行中。
