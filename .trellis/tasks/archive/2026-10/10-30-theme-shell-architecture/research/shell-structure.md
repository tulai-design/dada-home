# Research: 深度主题的桌面外壳与内容生命周期

- Query: 如何让新增深度主题集中在自己的模块内，同时保留导航、页面、应用窗口、助手与设置的真实行为？
- Scope: internal；只审查宿主外壳、导航、窗口、设置与相关测试，不实现代码，不设计第三方执行沙盒或 Agent 工具。
- Date: 2026-10-30
- Baseline: `27358e2`；下列路径/行号为本次工作区读取的事实锚点。

## Findings

### 1. 现状：视觉主题事实上承担了三类职责

1. **视觉数据**：`src/lib/workspace.ts:282–311` 的 `ThemeEntry` 只有名字、变量、明暗和字体，`ThemeConfig` 负责 active/mode/base/frameOff，没有外壳声明。
2. **外壳和启动器**：`src/App.tsx:93–103` 持有 `switchBoard`、Win98 开关/最小化/最大化和 `openBoardSelection`。`src/App.tsx:740–765` 构造标题、导航与Win98窗口动作，`834–850` 选择桌面/标题栏/任务栏/Switch Dock。
3. **宿主内容策略**：`src/App.tsx:319–344` 从具体主题 ID 设置全局 skin，并在切主题时重置Switch/Win98状态；`346–350` 特定主题触发个人配置的头像种子写入。`ThemeSettings.tsx:34–50,76–85` 和 `SettingsPage.tsx:71,119–123,339–342` 又直接辨识主题 ID 来控制设置内容。

因此新增纯配色与新增深度桌面主题的改动面完全不同：前者走主题数据，后者需要修改 App 状态、每个导航入口、渲染、CSS、设置分支与验收。单纯把 `SwitchShell`、`Win98Shell` 改名放入一个目录，不能消除这一耦合。

### 2. 外壳已有真实差异，不必根据假想第三方插件发明接口

| 当前实现 | 导航/启动方式 | 内容呈现 | 已有局部状态 |
| --- | --- | --- | --- |
| 常规外壳（纸张/iOS/掌机） | Rail 固定首页、固定页面/应用、更多与系统操作 | 同一 canvas 内 TopBar + PageView/系统页；助手在独立分栏 | Rail 容量、焦点、滑块 |
| Switch | 封面轨道 + 圆形系统菜单；先选择、再打开；返回主屏 | 主页启动器取代 PageView，内容页使用相同宿主内容 | 选中封面、滚动/手势、电池/网络订阅 |
| Win98 | 桌面图标、开始菜单、当前任务按钮 | 桌面+单个工作区“窗口”，另保留独立应用浮窗 | 桌面选中、开始菜单、工作区窗口可见/最小化/最大化 |

证据：
- `src/components/Rail.tsx:18–29,74–80` 计算固定入口、溢出与选择；它依赖 `Page[]/GeneratedApplication[]`，本身已重复做导航投影。
- `src/components/SwitchShell.tsx:53–84` 再投影封面目录，保存选择并用 bindOpen 将主屏的当前选择反向注册给 App；`:185–203` 自行构造系统菜单。`:21–49` 正确隔离网络/电量监听，卸载清理。
- `src/components/Win98Shell.tsx:8–49` 第三份入口投影，区分固定桌面与全部开始菜单；`:58–85` 桌面选择/几何键盘导航；`:119–160` 开始菜单焦点与监听寿命。`:211–228` 标题栏只是外观+意图回调，是可以保留的小模块。
- `src/App.tsx:871–882` 显式以 `showSwitchBoard ? SwitchHome : PageView` 分支替换内容；这与Win98仅隐藏舞台不同，不能把两者当前生命周期描述成一致。

### 3. 需要分开的状态归属

**业务/宿主所有**：当前页面 ID 与失效回退、系统页路由、打开的应用 canonical ID/运行形态/返回目标、应用运行占用、助手对话/审批/忙状态、网络授权、持久化门禁、工作空间提交、页面检查的已提交DOM标记。证据为 `src/App.tsx:108–150,161–196,198–223,277–311,576–610,766–769`。外壳不应接收完整 `Workspace` 或 `ComponentHost` 来重新实现这些能力。

**外壳局部**：启动器可见、封面/桌面选择、菜单展开/焦点、工作区窗口的装饰几何、临时拖动状态；这些不应分别作为 `switch*`/`win98*` 变量留在 App。Win98目前在 App 的最小化/关闭动作还顺带操作阅读器和应用（`src/App.tsx:751–765`），迁出时必须转成明确语义：工作区收起是否连带收起其附着面板，由通用内容容器意图约定，不能由某主题直接销毁应用。

**用户可定制且持久化的外壳配置**与**临时外壳状态**应分离：Dock位置/密度、封面尺寸、标题栏样式等是经 schema 校验的设计配置；菜单是否展开、拖动中的pointer不是可导出主题数据。不要把两者都塞进自由JSON settings。

### 4. 导航耦合应在一次通用意图处消除

`src/App.tsx:230–275` 的页面、设置、监控、市场入口都了解Win98的 reveal；页面入口还了解Switch启动器。AI open_page 的pending effect又重复这一逻辑（`:300–311`）。应用 page模式亦单独reveal（`:161–177`）。这些是新增第四种外壳会继续扩散的具体位置。

推荐（提案）：保留单一宿主导航控制器，接受页面/系统页/应用等判别联合的导航意图；校验目标后一次推进 route revision，明确应用保留策略和助手规则。外壳收到通用“目标已激活”的事实，自行收起启动器、恢复内容窗口。不要让宿主调用 `revealWin98Window`、`setSwitchBoard`，也不要为了统一而制造 `setThemeWindowOpen(name, bool)` 字符串接口。

现有行为需保留：`scripts/test-assistant-navigation.mjs:105–155` 说明设置/市场/应用导航在split中保留助手，其他形态保持现有关闭规则；页面导航不变更助手偏好。`:160–205` 说明最小化应用仍占用同一运行身份，导航保留最小化实例，避免widget/status再起第二份逻辑。这些是宿主策略，不是皮肤自由定制点。

### 5. 建议的 Module / Interface / Seam

外部只需要一个 **ShellHost Module**：输入已解析的外壳选择与配置、只读的导航投影、受控用户意图；输出围绕稳定内容舞台的chrome和布局。其内部由常规/Switch/Win98三个 **Adapter** 验证真实变化。**Seam** 放在“宿主业务状态已经投影完毕，准备绘制桌面Chrome”处，不能放在工作空间store或整个App外面。

建议外部Interface分为三组，避免复制现有App所有props：

- `model`：当前导航目标和标题、入口目录（稳定ID/语义kind/label/iconToken/pinned/current）、明暗/有限个人展示资料、assistant busy/open等只读标记。只提供外壳需要的字段；入口目录由一处纯投影生成，常规Rail/Switch/Win98再选择各自呈现子集。
- `dispatch(intent)`：`navigate(target)`、`openAssistant(preference)`、`openPalette`、`toggleColorMode`等有实际用途的判别联合；宿主校验执行。外壳局部菜单/选中/窗口几何不通过此接口反复回传App。
- `surfaces`（宿主私有契约，不是可分发JSON）：稳定业务舞台、状态条、受控浮层锚点。暴露少量布局度量/装饰插槽，外壳不能任意运行/复制这些Node。页面根ref、inspection、ApplicationHost、聊天状态和授权modal仍由宿主持有。

必要的内部Interface可由外壳controller提供 `launcher/chrome` 和受约束 `layout`（可用内容区域/窗口可见与最大化、保留区域、状态条装饰），而不是暴露几十个主题专用槽。`TopBar.tsx:10–23` 已以status插槽分离实时内容与工具；`Win98Titlebar`也已是小而清晰的绘制面，可复用其思路。

**不能仅做 `<ActiveShell>{businessContent}</ActiveShell>` 替换整棵树。** 本仓对分栏、最小化有保持DOM与运行器的明确合同，换Adapter时改变业务父节点/Portal目标可能破坏它。推荐稳定宿主舞台+可替换的同层chrome，布局靠宿主有限layout descriptor/CSS grid与尺寸规则；ShellHost内部保持业务父节点和Portal容器对象。切换外壳只替换chrome/controller，不把PageView和ApplicationHost搬入不同Adapter树里。

外壳可定义launcher视觉，不能任意覆盖审批、存储错误提示、授权按钮或吞掉全局快捷键。`src/App.tsx:775–776,973–983` 的持久化门禁和授权modal应继续在可信宿主层，快捷键策略在`:639–656`。

### 6. 生命周期必须写成可测合同

以下为推荐目标，不能误写成当前均已做到：

| 操作 | 目标合同 | 当前证据/差异 |
| --- | --- | --- |
| 同外壳换配色/变量/配置 | 不重挂页面、应用、助手；仅规整数据与热应用视觉；修正已不合法外壳局部选择 | 当前theme effect清旧变量，`App.tsx:313–335`；尚无外壳配置合同 |
| 更换外壳 | 仅替换外壳controller/chrome，局部菜单/拖动/焦点销毁；宿主route、页面输入、打开应用及助手继续；新外壳若显示launcher，舞台隐藏而不销毁 | 当前`App.tsx:337–344`会重置Switch/Win98；Switch分支替换PageView，不具备目标保证 |
| 启动器显示/工作区最小化 | 隐藏稳定舞台，输入与运行身份保留；隐藏时inert/aria，恢复焦点到合理入口；不重新调用应用init | Win98 CSS当前只display:none；`win98-shell.css:23–34`；最小化输入回归见测试124–141 |
| 关闭工作区内容 | 与最小化区分；应用显式close则卸载，普通页面原有行为需明确；不能让Shell自己删除业务状态 | App当前win98Close会closeApplication，`:760–765` |
| 助手drawer/full/split切换、收窄画布 | 保留对话草稿与页面；不可用split回退不覆盖用户偏好；所有布局用实际画布尺寸 | `AssistantSplitPane.tsx:5–17,29–45,82–104`固定两侧挂载；Switch CSS使用cqw/cqh |
| 应用modal最小化/最大化 | 不变canonical ID、不中断运行；重新测量可用舞台，不能盖Dock/taskbar；window chrome可换，但runtime保留 | `ApplicationWindow.tsx:19–59,93–104,126–140`隐藏而不卸载；应用内容在固定portal |
| 应用surface切换 | 本轮不额外承诺零重挂；维持现有明确持久数据保证，避免为了热切主题顺便重写应用运行生命周期 | `ApplicationHost.tsx:28–42`mode改变不同容器，WidgetBoundary key含mode |
| 外壳异常/缺失 | 外壳自身错误隔离，回落常规可操作chrome；必须能进设置/助手恢复；不销毁工作空间/应用记录 | 当前全App ErrorBoundary `App.tsx:773–774`，缺少专门Shell降级面 |

**窗口不是一个概念**：Win98工作区窗口包住当前页面/系统页，应用独立窗口有自己的拖动、最小化与运行身份。当前`ApplicationHost.tsx:42`与`ApplicationWindow.tsx:20–30`已区分；不要新建一个把所有窗口都当应用的WindowManager来混淆，A3最小改造也不需要多窗口任务系统。

### 7. 设置应暴露语义呈现能力，避免继续根据ID打补丁

当前主题专用条件散在：
- 外框/装饰是否可操作：`ThemeSettings.tsx:34–50,76–85`；
- 个人头像是否显示：`SettingsPage.tsx:71,119–123`；
- 设置页标题是通栏还是侧栏标题：`SettingsPage.tsx:339–342`。

提案：视觉配置声明可编辑字段和能力（例如frame control、launcher avatar），设置业务结构保持共享；主题需要完全不同设置布局时，读取通用SettingsModel后由已登记的设置呈现Adapter绘制，表单动作/验证继续走宿主。不要把备份/同步/AI配置数据和密钥传给第三方外壳，也不应给所有外壳一个任意 `renderSettings(ctx)` 的全权入口。第一阶段只把现有差异提炼为少量有两个以上实现的呈现能力，暂不为每个设置元素开放几十个插槽。

### 8. 最小纵向交付与后续测试

建议先交付“现有三种外壳在同一宿主Interface下保持功能，新增一个内置Adapter无需改App条件分支”：

1. 抽出导航目标、入口投影与通用动作；先让现有Rail/Switch/Win98消费同一模型，保留不同筛选语义。没有新外观，先验证导航不退化。
2. 建稳定ShellHost舞台和三个内置Adapter；迁移局部状态与chrome、消除App按theme.id的行为分支；主题数据引用已登记shell，明确同shell变体与换shell的生命周期。
3. 把settings的现有ID分支转换为有限能力；保留统一业务表单与持久化操作。新shell通过目录接入，重复ID/缺失实现失败清楚。
4. 用一个很小的第四个测试Adapter（仅测试fixture，无新产品主题）证明接入只需目录/实现，而无需App/SettingsPage增加条件；再做实际深度主题开发。这里的fixture用于验证Seam，不是需要发布的功能。

第一阶段不引入远端包加载、全局任意CSS、第三方React执行或新多窗口系统。它为下一阶段数据主题打包、Agent可编辑配置和创意工坊依赖/隔离提供稳定宿主，而不是把未验证插件协议塞进ShellHost。

建议验收矩阵：
- 三Adapter × 页面/设置/市场/监控/应用入口：目标、选中、标题、更多/开始菜单一致，删除当前目标有合法回退。
- 浅深 × 1440、390、320及窄AI分栏：末项可达、任务栏可命中、应用浮窗不盖保留区域；减弱动画可用。
- 未提交todo/设置/聊天草稿：同shell配置、换shell、launcher、工作区最小化/恢复、应用最大化/恢复分别检查DOM身份与文本。
- 运行器 init计数/请求计数/持久化身份：换shell不会启动第二份实例，状态条紧凑与页面小组件仍遵循activeApplicationIds。
- 审批中切主题、Agent执行中切主题：停止/允许仍可用，审批与持久化门禁不被外壳重挂影响；沿用A1/A2行为。
- 删除/撤销主题，缺失/出错shell：安全fallback后可进入设置/助手，保存的数据原样保留，不默默删除引用。
- 热切前后旧监听、pointer capture、定时器、电量异步返回、CSS变量和全局dataset均清理。
- 页面检查准确识别launcher遮挡/舞台隐藏：不能因为PageView仍挂载就报告可测；参考`App.tsx:286–294`现有DOM登记。

## Files Found

- `src/App.tsx`：业务协调、主题应用、外壳状态与渲染当前集中点。
- `src/components/Rail.tsx`：常规导航投影、容量与交互。
- `src/components/SwitchShell.tsx`：封面启动器、菜单、主机状态与局部输入。
- `src/components/Win98Shell.tsx`：桌面、开始菜单、任务栏与工作区标题栏。
- `src/components/ApplicationHost.tsx`、`ApplicationWindow.tsx`：应用surface、稳定独立窗口与几何管理。
- `src/components/AssistantSplitPane.tsx`、`ChatAssistant.tsx`、`Assistant.tsx`：分栏与对话订阅、输入/焦点。
- `src/components/ThemeSettings.tsx`、`SettingsPage.tsx`：当前ID专用设置分支。
- `src/win98-shell.css`、`switch-shell.css`、`theme.css`：外壳布置、隐藏、容器查询与宿主控件皮肤。
- `scripts/test-win98-theme-browser.mjs`、`test-switch-theme-browser.mjs`、`test-assistant-navigation.mjs`：现有可复用真实行为与生命周期验证入口。

## Related Specs

- `.trellis/spec/frontend/component-guidelines.md`：实际容器、宿主标题栏职责和语义变量。
- `.trellis/spec/frontend/hook-guidelines.md`：监听/异步/计时器清理，尺寸变化不得重跑init。
- `.trellis/spec/frontend/state-management.md`：workspace提交、应用身份与业务数据分离。
- `.trellis/workflow.md`：研究提案与已实现合同区分，后续以完整纵向结果验收。

## External References

本子题为源码结构审查，未使用外部资料或推断浏览器平台新能力；插件分发与扩展限制由其他研究子题负责。

## Caveats / Not Found

- 本文未运行浏览器或新增测试；引用的是现有脚本断言，不等于本轮已重新验收。
- 尚未发现可供第三方注册的shell目录或稳定shell合同；所列Interface是提案。
- 当前代码通过CSS维持Win98最小化页面，而Switch启动器替换PageView；“任意换壳保持全部临时输入”是建议新增合同，不能写为已交付。
- 基线仅用于证据，文件可能被其他并行研究更新；本代理只写本文件，不改产品、规范、任务状态或Git。
