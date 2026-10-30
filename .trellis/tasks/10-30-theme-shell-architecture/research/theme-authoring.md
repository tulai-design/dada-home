# Research: 主题作者与 Agent 定制接口

- Query：现有主题数据、CSS 与 AI 工具如何支撑深度主题；另存是否丢皮肤；怎样形成作者友好、可校验且可预览的定制 Interface。
- Scope：internal；不决定第三方可执行包的信任模型，不重做 App 窗口与导航全面映射。
- Date：2026-10-30。
- 基线：`27358e2`。以下事实来自真实源码与隔离执行，建议均为提案，未实现。

汇总设计补记：本文的定义引用/覆盖模型是研究候选；父任务 design.md 最终提案选择完整 ThemeSpec 快照与 origin 溯源，不采用运行时基础主题继承。skin/shell 的实现合同引用仍保留，方案取舍以父设计为准。

## Findings

### 1. 文件与既有能力

| 文件 | 职责与证据 |
| --- | --- |
| `src/lib/workspace.ts:286-311` | ThemeEntry 是可保存的颜色/字体覆盖；ThemeConfig 选 active ID、mode/base 和临时 frameOff，没有皮肤或外壳引用。 |
| `src/lib/workspace.ts:420-529` | iOS、掌机、Switch、Win98 数据与特定命名变量；主机含封面/焦点色，Win98 含桌面/窗口标题/凸凹边色。 |
| `src/lib/themes.ts:64-81` | 合成变量及输入清理；只检查键名语法、条数、长度和 `;{}`，不是 token 语义类型目录。 |
| `src/lib/themes.ts:85-106` | 读取会过滤同 ID 的内置副本，并强制注入当前内置定义。自定义只复制已知字段。 |
| `src/lib/themes.ts:145-205,231-279` | 保存与 tweak 为纯函数；save 所传分支整组替换，tweak 单分支合并，内置修改自动 fork。 |
| `src/App.tsx:313-335` | 根 html 设置 mode、按主题 ID 设置 skin、删除上一批 inline 变量，再应用字体与合成覆盖。 |
| `src/components/ThemeSettings.tsx:33-50,76-119` | 以 iOS/掌机/Switch ID 决定外框策略，以 Win98 ID 隐藏装饰设置；主题库可以切换、改名、删除。 |
| `src/main.tsx:17-27` | 全部样式由主入口静态导入，Switch 内容拆三份、Win98 内容另有文件。当前不是运行时安装样式。 |
| `src/theme.css:1635-1684` | 宿主语义变量映射至 Lobe CSS 变量；modal/drawer 有全局稳定类适配。 |
| `src/lib/tools.ts:483-592,625-641` | set/list/save/apply/delete_theme，执行领域函数后 commit；无主题属性 schema 查询、完整主题草稿或深度主题外壳工具。 |
| `src/lib/skills.ts:69-84` | design-system 从同一 Markdown 正文读入运行时技能；应保留路径和单一正文。 |
| `src/lib/templates.ts:20-30,121-137` | 模板可携带主题数据，adopt 按 ID/值查重；跨引用变化时此处需同步。 |
| `src/lib/workspaceStore.ts:118-151,178-199,295-330` | 导入/模板读取规整，commit/undo/redo 为正式提交路径。 |
| `src/lib/syncData.ts:136-157`、`src/lib/incrementalConfigSchema.ts:18-57` | 快照和增量配置共用工作空间值校验；新增主题契约不能只改 TS。 |

### 2. 已确认：另存内置主题会失去深定制皮肤，而且不是改一行 ID 即可解决

`tweakTheme` 内置分支 `src/lib/themes.ts:256-261` 新建 `{id,name,description,overrides:patch,...palettes,...传入fonts}`，没有保留当前共享 overrides 和默认字体。App 的 `data-skin` 依赖实例 `theme.id`（`src/App.tsx:319-323`），深度外壳也按主题 ID 选择。因此修改一个颜色会从 Switch/Win98 回到普通外壳，iOS 的专属控件样式也失去。

这与当前文档一致，不是偶发渲染 bug：`docs/design-system.md:65,77` 和 `src/lib/ai.ts:49` 明确警告 Agent 不要修改内置主题颜色，否则失去外壳。说明当前所谓“深度主题定制”靠禁止修改规避，尚不是作者能力。

2026-10-30 用本机 Node、TypeScript transpileModule，隔离执行真实 `workspace.ts/themes.ts/fonts.ts/errors.ts`，不读写用户存储。可重复历史探针保存在同目录 `theme-identity-probe.mjs`，执行命令如下；该脚本断言缺陷存在，不是未来应保持绿色的回归：

```sh
/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/node .trellis/tasks/10-30-theme-shell-architecture/research/theme-identity-probe.mjs
```

实际运行退出 0，确认三套内置派生和一项模板读回共 4/4 历史缺陷。核心调用为：

```js
const ws = {theme:{active:id,mode:'light',base:'light'}, themes:readThemes([])}
const result = tweakTheme(ws, {overrides:{main:'#663399'}})
```

| 输入 ID | 输出 active | fork 字段 | skin/shell |
| --- | --- | --- | --- |
| ios | custom-1 | id/name/description/overrides/light/dark | 不存在 |
| switch | custom-1 | 同上 | 不存在 |
| win98 | custom-1 | 同上 | 不存在 |

另一个需要在新 Interface 消除的歧义：`resolveThemeOverrides` 是共享→模式覆盖，复制后的 mode.main 比 overrides.main 更优先。同一探针的浅色 main 分别仍是 `#007aff/#007f7b/#000080`，而共享 patch 为 `#663399`。这不是要求改优先级，而是说明作者必须能查询有效值及来源、修改正确作用域；不能工具口头说“改主色”而不可观察生效位置。上述 fork 还会丢原共有尺寸/字体/主题专属色，仅保留新 patch；应使用明确基础定义/完整派生模型，不能简单加 skinId 后维持不完整 fork。

### 3. 已确认：主题模板往返存在选错主题的现存路径

`readTemplates` 把 snapshot.theme 放进 `migrate` 后，在 `src/lib/workspaceStore.ts:135` 用 `checked.themes.find(entry => entry.id !== DEFAULT_THEME_ID)` 取回。`readThemes` 会在自定义主题前插入 iOS，因而首个非 default 是 iOS，未按原 snapshot.theme.id 解析。

隔离执行真实 store/theme 代码、组件/存储边界为无副作用替身：输入 `snapshot.theme={id:'my-custom',name:'自定义红',description:'',overrides:{main:'#990000'}}`，输出 `readTemplates(...)[0].snapshot.theme.id === 'ios'`。这是已复现问题；没有访问真实模板、没有修代码。A3 首个纵向结果宜纳入“派生主题保存→重载→模板→恢复”回归，避免结构重构掩盖丢身份问题。

### 4. Agent 现有可编辑层与不可编辑层

- 可改：共享及双模式变量、Google Fonts 字体角色；独立的页面 CSS/组件 look、页面装饰和 Dock。set/save 会正式 commit，默认立即生效；撤销能恢复设计。
- 不可改：深度外壳结构、导航呈现、窗口标题结构、主机封面交互和内置宿主选择器。没有声明这些能力的工具或配置模型。
- 主题变量接受任意合法名称，不代表对应控件一定消费它；`list_themes` 返回字符串数据，不是允许字段/作用域/约束/实际覆盖来源目录（`src/lib/tools.ts:524-533`）。
- 页面/组件 CSS 是纯声明，`sanitizeCss` 禁止选择器、花括号、@import、@font-face 与外链 url（`src/lib/customWidget.ts:244-268`）；`PageView.tsx:45-55,75-82,130` 限定页面/组件容器。不能把这套能力宣传为能修改宿主主题 CSS。
- Dock 已有独立 CSS 编译作用域与预算，但最终样式受 `visibleDock` 的 iOS/掌机布尔参数影响（`src/lib/dock.ts:29-48`），并不等于统一主题接口。主题不应偷偷覆盖用户保存的 Dock 偏好。
- getAppearance 的 resolved 合成了基础值和数据覆盖（`src/lib/appearance.ts:51-66`），但不包含所有当前 stylesheet 专属规则/有效 Dock/尺寸和字体加载结果；它是配置资料，不是 computed-style 或视觉验收。

### 5. 推荐 Interface：主题实例身份、皮肤风格和行为外壳分开

以下为候选术语，最终命名由主设计统一，不直接改 GLOSSARY：

1. **ThemeDefinition**：不可变的可安装风格定义，描述默认 token、受控 skin 样式及 shell 引用；内置主题也是定义。归属包、定义 ID、版本与渲染能力保持独立。
2. **ThemeInstance**：工作空间内可命名、可撤销的用户方案；有自己的 instance ID、固定 definitionRef、用户 token/config 覆盖。改名、复制、改颜色不变 definition/skin/shell；不能再用 instance ID 推断渲染器。
3. **Skin**：控件/表面造型，iOS 与纸张等可以共享同一普通行为外壳；不是任意业务逻辑。一个深度主题可同时选风格及不同 Shell。
4. **Shell**：宿主提供并拥有行为实现的可替换外壳，如普通导航、主机封面、经典桌面。主题实例仅存 shellRef 和可序列化配置；不把 React function 存进 workspace。

运行解析必须返回同一份 **ResolvedTheme**：包含 instance/definition/skin/shell 身份、当前 mode、双模式有效 token、每个值来源、受支持配置及有效 Dock/overlay policy；UI、Agent、外观查询、截图夹具与渲染共用。不要让每个调用方再重复 `if id==='win98'` 或重新合成默认值。

基础定义使用固定版本引用，并在导出/导入定义资源与依赖模型明确前不假装引用即可跨机器工作。首阶段是打包内置可信定义，自定义实例保留直接基础引用；不需要多层主题继承树、动态 prototype 或任意 mixin。缺失引用须保留用户原记录与明确不可用状态，不能静默扔掉主题后以默认值冒充导入成功。

### 6. Schema 是作者、UI、Agent 和校验的一份事实来源

建议一个 catalog 定义语义字段类型、范围/枚举、默认值、mode 规则、用途和能力适用范围，生成工具 JSON schema、表单、读回说明和运行时 validator。至少包含：

| 层 | 示例能力，不要求全部首期实现 |
| --- | --- |
| 基础语义 token | canvas/surface/raised/input/text/secondary/disabled/border/divider/accent/focus/selection/danger；字体角色、字号、行高、间距、圆角、边线、阴影、动效与减少动画策略。 |
| 组件 recipe | button/input/list/card/tab、hover/pressed/focus/disabled 状态；Lobe 映射统一隐藏在宿主 adapter，不让 Agent 写 `.lobe-*` 深层选择器。 |
| 外壳配置 | 仅当前 Shell 声明的导航密度、封面比例、任务栏/标题栏样式、Dock呈现、支持的窗口装饰与背景策略；不直接给 setBusy/openSettings 等宿主状态函数。 |
| 主题专属扩展 | Switch 的封面/焦点与 Win98 的 bevel/title 语义，应由对应定义公开，不让主工具说明全文穷举所有未来主题变量。 |
| 资源 | 受控字体/位图引用、来源/字节预算/失败后备；CSS 文本不能绕过资源管理直接联网。 |

颜色、尺寸、字体和枚举需要真实类型验证；未知 token、拼错属性、非法范围与不支持 capability 明确拒绝，且不能部分写。共享/双模式优先级固定并可读回，schema 要说明“同时改两模式主色”的真实 patch 方式。不要以 `Record<string,string>` 或 CSS 语法通过充当语义校验，更不能只写长系统提示约束模型。

### 7. 建议作者操作链：发现→派生→修改→预览→应用

候选能力不等于需要照搬八个新工具；应先实现一个深模块，再给 UI/Agent 窄的 Adapter：

- `describeTheme(ref)` 读身份、双模式有效值及来源，`describeThemeDefinition` 按需读 schema/capabilities/限制。
- `createThemeDraft({from, name})` 派生但不改正式主题；保留定义/皮肤/外壳及用户明暗偏好。
- `patchThemeDraft({draftId, expectedRevision, patch})` 按 schema 合并/删除操作；模式 scope 显式，非法整次拒绝。
- `inspectThemeDraft` 返回数据完整性和有限几何，不能说已确认颜色可读或全部应用视觉。
- `applyThemeDraft` 检查基础实例 revision、定义版本与当前能力；冲突保留草稿，成功仅一次 commit，保留页面、应用目录/身份、业务数据、窗口输入、用户无关设置。cancel不写正式状态或历史；不能 undo 回滚网络副作用。

首期可先做“派生已安装主题并调整token/已声明参数”，而不是要求 Agent 生成任意全局 CSS 或运行器。现有首页草稿的 id/revision/冲突模式可借鉴（`homepageDraft.ts:25-46,92-104`），但它只预览静态首页布局，不能直接复用为全主题预览并声称隔离足够。

### 8. CSS、portal、资源与预览的约束

**当前事实：** active mode/skin/variables 写在 documentElement，保证脱离内容树的 Lobe 弹层也继承当前值；ApplicationWindow 则 portal 到 canvas 容器（`ApplicationWindow.tsx:94-140`），ApplicationHost 有独立遮罩 portal（`ApplicationHost.tsx:39`）。styles/theme 加载顺序与全局稳定类决定覆盖，Switch 内容 selector 已深入组件内语义类（如 `switch-collections.css:2-260`）。

**提案：** 运行时 ThemeScope 同时拥有内容根和专属 portal root，主题 CSS 限制在对应 scope/skin namespace，弹层渲染必须有明确容器归属；UI 库 adapter 在宿主内集中处理。若首期正式主题仍用 html root，应承认同 DOM 中第二份主题预览无法靠切 html dataset 隔离，不要预览时污染正式页。可以先用隔离文档运行宿主静态预览框架及测试夹具，含按钮/输入/设置/对话/窗口状态，不启动第二套业务存储、AI和同步。

不能只给每条 CSS selector 加前缀就称安全：`@keyframes`、字体名、CSS 自定义属性、外链请求、fixed overlay、z-index 和 portal 都有跨范围问题。可信内置 skin 可用受控静态样式；未来工坊 CSS 需要解析、命名空间、资源预算和被消费的稳定 part/slot 合同，不能暴露随机库 DOM 为公共接口。CSS scope 是封装，不等同任意代码隔离；完整第三方信任模型由单独研究决定。

字体已有结构化来源及清理（`fonts.ts:25-47,64-88`），但主题切换不仅依赖 theme.fonts：`styles.css:6`、`theme.css:9` 仍有全局 Google Fonts @import。资源模块需要统一归属、去重与最后引用释放，处理离线/404/迟到失败且不污染下一主题；首期不扩大为任意字体 URL。默认fallback可用，不能字体未就绪就宣称目标视觉完成。

### 9. 最小垂直交付与验收

第一切片建议：**在 iOS/Switch/Win98 基础上改名派生并修改明确的视觉参数，原外壳/皮肤与用户内容保持，保存重载/撤销/导出/模板往返可靠。** 它直接解决已经确认的 Agent 限制，并强制主题实例与定义身份分离；同时以3种真实实现证明接口，而非为假想插件新增空抽象。

后续再接完整作者草稿/主题隔离预览和受控深度配置；最后才把同一契约包装成工坊安装包和分发。新主题开发改动应收敛到 definition + skin stylesheet + 需要时的 Shell 实现 + 自身契约/视觉夹具；不能每加一套继续改 App/ThemeSettings/主提示/同步各自枚举。

必需回归：

1. 派生所有内置主题保留 definition/skin/shell、共有默认值、字体与双模式；在当前/另一模式 patch 有效且来源可读。
2. 另存/改名/切明暗不重置外壳状态；仅换主题颜色不卸载应用或丢输入；换 Shell 的生命周期另立明确合同。
3. 当前配置/历史/备份/模板/增量同步走同一运行校验，往返保持语义身份；包含上述 `my-custom→ios` 缺陷的红绿测试。
4. 非法/未知字段、缺失引用、资源失败、过期草稿全拒绝或明确不可用；无部分提交，用户原数据保留。
5. 双模式、窄屏/桌面/助手分栏，系统设置、输入各状态、toast/modal/drawer、窗口/任务栏、App/Applet主题更新；主题连续 A→B→A 无inline/CSS/字体/监听残留。
6. 独立主题预览不启动实际业务副作用；新旧portal/样式/资源不会相互覆盖。有限DOM检查与真实截图验收分开记录。

## Related Specs

已读 AGENTS、任务 PRD、`.trellis/workflow.md`、`.trellis/spec/ai/tools-and-apps.md`、frontend component/state-management/type-safety 规范。保留既有纯领域操作→commit/history、输入 unknown 校验、受控UI与App/Applet沙盒，以及 design-system 单一运行时正文。

## External References

本篇仅研究内部实现，没有采用新的库或依赖，没有据此声称外部浏览器/扩展加载方案已验证。第三方包执行、CSP、远程代码、跨平台分发与许可证约束由主会话/工坊研究另行核对官方资料。

## Caveats / Not Found

- 本轮为设计研究，只写本文件，没有产品改动、测试文件、提交或任务状态变更。
- 两个隔离探针执行了真实领域实现，外围为无副作用替身；不是 UI 截图或线上数据复现。
- 未找到统一 ThemeDefinition/Shell/capability catalog 或整主题预览协议；上述类型、工具名和模块均为提案。
- 模板主题误选已证实，建议在主题身份切片一并修复；本轮不借审查授权修改生产。
- 未对全部业务组件逐项视觉审查，报告不宣称 token schema 一建立即可覆盖所有控件造型。
