# 主题作者与独立预览

主题作者让设置面板与 Agent 使用同一个字段目录，在内存草稿中修改完整设计，通过独立文档预览后一次应用。它消费已打包的造型与外壳实现；本项不安装第三方代码，也不提供任意宿主 CSS 或 JSX。

## 数据与字段

`ThemeEntry` 继续保存实例 ID、skin、shell、origin、共享变量、浅深两套变量与字体。origin 仅用于溯源，派生复制完整设计。工作空间版本为 9，包含实际消费的 `recipes.button.radius`、`recipes.input.radius` 和 `shellConfig.coverScale`、`shellConfig.windowGap`；模板、备份与同步使用相同验证边界。包主题保留 packageRef、rendererContract 和本地字体精确引用；未知设计只保留，不进入作者修改。

唯一作者目录是 [`catalog.ts`](../../src/lib/themeAuthoring/catalog.ts)。目录约束生成表单、工具 schema 与按需说明，运行验证也消费它。作者颜色明确指定 light/dark/both，尺寸与字体栈用 shared，部件用 recipe，外壳用 shell，字体资源用 resource。修改项的 path 为变量名、`button.radius` / `input.radius`、`coverScale` / `windowGap` 或 `fonts`，不是任意对象路径。

按钮和输入框圆角为 0–24px，仅作用普通宿主控件，不承诺修改生成应用 iframe 内部或专用外壳按钮。Switch 封面比例为整数 80–120%，Win98 窗口间距为整数 4–40px；外壳参数按当前能力验证，不支持的字段整次拒绝。布局仍受窄容器与任务栏安全边界限制。

## 草稿事务

`createThemeDraft`、`updateThemeDraft`、`applyThemeDraft` 与 `discardThemeDraft` 是 UI 和 Agent 的共同入口。一次只保留一份草稿；刷新后丢弃。derive 完整派生新方案，edit 仅修改已有自定义方案。创建和修改不提交工作空间；取消不写历史。

每次修改、应用或取消都携带 draftId 与 expectedRevision。一次最多 32 项，先校验全部操作后才替换草稿；错误不留下部分修改。成功修改递增 revision，旧预览不再能证明当前版本已准备好。

应用前检查源设计指纹、选择 generation 和目录/渲染依赖。A→B→A 也属于选择变化。等待预览与字体之后再次读取草稿和最新工作空间；检查与正式 commit 之间没有异步等待。只合并目标主题和选择，保留期间无关页面、应用与业务编辑，沿用最新明暗偏好。成功产生一次可撤销提交；冲突、资源失败或停止保留正式主题，冲突失败保留草稿供查看或取消。

## 独立预览与字体

`theme-preview.html` 是 Web 和 MV3 扩展都打包的独立入口。预览不加载 App、应用运行时、工作空间初始化、同步、统计或 AI。它只展示固定的控件、卡片和外壳示例，收到的数据不包含真实待办、聊天、密钥或应用源码。

父子通信校验窗口来源、origin、随机通道、草稿 ID、revision 和请求 ID，控制消息上限 64KiB；本地字体通过独立二进制请求传递，按单项2MiB/总4MiB预算核验，仅响应当前草稿声明的精确资源。迟到回执不能覆盖新版本，包状态变化使旧检查失效。预览的 CSS、portal 与字体归自己的 document。该 iframe 运行可信的打包代码，是文档隔离，不是第三方代码安全沙盒。

字体由 document 级 lease 管理，消费者引用计数、失败/超时和取消可追踪；正式界面与预览不会相互删除字体。`fonts` 缺省使用受控默认字体，`fonts: []` 明确选择系统后备且不请求网络字体。普通自定义主题最多 4 个结构化 Google Fonts 或本地 resource 引用，不能传任意 URL。包主题显式选系统或本地字体，不继承远端默认；资源摘要决定内部 CSS family。详见[本地主题包](local-theme-packages.md)。

Google 字体准备检查样式表和实际 FontFaceSet 加载，本地字体检查包可用性、字节/摘要与 FontFace 实际解码；失败时预览以系统字继续显示并披露降级，应用当前版本被拒绝。正式主题离线仍可以系统字显示，预览失败不回写正式设计。应用前在正式 document 临时预备资源，不提前修改正式 CSS 变量；提交后由正式界面接管 lease。

## Agent 与检查范围

| 工具 | 结果 |
| --- | --- |
| describe_theme_schema | 按来源和分组发现适用字段、约束与两模式有效来源 |
| create_theme_draft | 创建完整草稿并打开作者面板 |
| get_theme_draft | 读取版本、完整设计、差异和冲突 |
| update_theme_draft | 原子修改草稿，递增版本 |
| inspect_theme_draft | 等待当前版本的资源与固定夹具几何检查 |
| finish_theme_draft | apply 一次应用，或 discard 零正式写入取消 |

纯主题工具沿用原有风险级别，不新增强制审批；用户只要求预览时 Agent 不能自行应用。工具错误保留统一失败事件，取消遵循 AbortSignal，不允许迟到提交。

`set_theme`、`save_theme` 仍提供即时局部修改与保存，也受目录验证，不是预览工具。切换已保存方案仍使用 `apply_theme`。

检查报告只说明当前固定示例、模式、尺寸下的资源与有限几何。对比度、审美、全部真实业务状态及生成应用内部都不能由该报告推断通过；还需实际截图与交互验收。完整测试和浏览器证据见对应 Trellis 任务的 verification 与 browser-validation。
