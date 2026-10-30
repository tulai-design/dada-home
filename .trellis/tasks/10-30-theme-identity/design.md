# 主题身份第一阶段设计

状态：已实施并通过验收，详细证据见 verification.md。日期：2026-10-30。

## 1. 最小行为缺口与边界

现在对内置主机、iOS 或 Win98 修改主色，会产生一个只存补丁的新实例；实例 ID 不再是内置 ID，App 随即丢掉原造型或外壳，且已有模式分支可能遮盖主色。另一个独立缺陷是模板读取选中第一个非 default 主题，丢失原自定义主题身份。

本切片把已有主题结构变成完整的独立设计快照，并让实例身份和实现引用分别承担职责。纯领域操作归 `themes.ts`，工作空间读取归 `workspaceStore.ts`，模板采用归 `templates.ts`，同步入站与出站归 `syncData.ts` 的共享校验。UI 与 Agent 继续走领域操作再提交；App 仅以解析出的实现引用替换已有实例 ID 判断。

不迁移全部 ThemeSpec 字段，不引入继承树、动态包、任意代码、recipes/assets/shell config 空字段、草稿 revision 或完整 ShellHost。完整稳定舞台及跨外壳切换生命周期留第二阶段。本阶段保证同外壳变体切换不触发既有主题实例 ID 驱动的窗口重置。

## 2. 身份与实现目录

保留 `ThemeEntry` 的 `id/name/description/overrides/light/dark/fonts/mode/builtin`；其中 overrides、双模式和字体合起来是完整设计快照，不再把派生记录理解为增量补丁。增加以下最小字段，实际合同如下：

```ts
type ThemeSkin = 'paper' | 'ios' | 'pixel' | 'switch' | 'win98'
type ThemeShell = 'standard' | 'switch' | 'win98'
type ThemeOrigin = {definitionId: string; version: number}
// ThemeEntry 增加：skin: ThemeSkin; shell: ThemeShell; origin?: ThemeOrigin
```

一个无 React、DOM 和存储依赖的小型目录登记合法 skin/shell 组合及外框能力：paper/ios/pixel 使用 standard，switch 使用 switch，win98 使用 win98。iOS、pixel、switch 保留现有外框开关能力，paper 延续修改 frame 变量的行为，win98 不增加新开关。目录提供运行时校验与查询，不把同一张映射表复制到 App、工具和设置。

当前只有打包内可信实现，没有外部 renderer 协议，暂不发布 `RendererRef.contractVersion` 或插件注册 API；包/外壳阶段遇到真实版本协商再增加。`origin` 只指向完整复制时的内置定义 ID 与正整数版本；内置定义从版本 1 起。来源不是运行时继承，不查源主题补缺，不随基础定义更新覆盖用户变体，也不记录任意父变体链。后续同一来源继续派生时保留原 origin。

内置主题同样显式声明 skin/shell/origin，并经过共同解析；内置 ID 只用于库身份、不可编辑权限与预设选择，不能决定造型或外壳。自定义主题的改名、调色、字体修改都不修改 skin/shell/origin。

## 3. 统一解析与有效值来源

在主题领域提供 `resolveTheme(theme, mode, preferences?)`；preferences 本阶段只接现有 `frameOff`。结果包含实例 ID、origin、实际 skin/shell、mode、有效 values、逐字段 sources、可应用的 overrides 和外框能力。来源层次为 `default`、`font`、`shared`、`light`/`dark`、`preference`；它描述有效值的最后来源，而不是主题血缘。

解析顺序沿用真实 CSS/字体合同：纸张基础参数与已打包 skin 的完整默认合同（共享、双模式、专属 token 和字体栈） → ThemeFont 角色映射 → 主题共享变量 → 当前模式变量 → frameOff 用户偏好。skin 默认值是宿主实现合同，不查询 origin，不形成定义继承；overrides 包含实际需要应用到 root 的 skin 默认值。清空实例 fonts 后不会加载来源字体，syncFonts 只读实例 fonts。把 `appearance.ts` 当前手动组合的基础值移到同一领域事实来源，`getAppearance` 与默认外观查询消费解析结果；保留可供当前调用方过渡的 `resolveThemeOverrides`，其逻辑委托同一解析规则，不再独立解释模式。

values 是宿主语义 CSS 值，允许现有 `var(...)` 等合法值；不是浏览器 computedStyle，也不宣称证明实际字体加载或视觉效果。未知 CSS token 的完整语义目录、recipe 表单及作者 schema 留第三阶段。本切片继续校验已有变量键、长度、值边界，并明确模式覆盖规则。

Dock 的已保存偏好仍属于 `workspace.dock`，解析主题不能改写它。App 调用现有 visibleDock 时改用 skin 能力；外观查询同时保留保存的 Dock 偏好与实际主题身份，不能将主题建议写回配置。

## 4. 修改与保存合同

### 内置派生及新建

`tweakTheme` 修改内置时先完整深复制共享值、两模式、字体、mode、skin/shell/origin，再合并补丁，生成独立 ID 和自定义名称，去掉 builtin。未修改字段完整保留，内置对象不变。当前明暗、base 与 frameOff 保留，派生不是重新激活主题。

`saveTheme` 更新已存在自定义主题时保留身份字段；新建时以当前主题完整快照作为默认来源，再应用显式保存字段；可用 `from?: string` 按 ID 或名称选择来源。更新已有主题时传 `from` 直接拒绝，避免含混地重选实现。这样 UI 的“另存”和 Agent 起名保存都不会丢失造型。共享 overrides 显式给出时仍按 save 原有整组替换规则处理；未给出时保留复制值。显式 light/dark 整组替换，未传保留；fonts 显式数组整组替换，空数组清除。新增完整设计作者接口留第三阶段，不在本切片开放任意 renderer 组合修改工具。

### 模式与遮盖

保留现有 API 的实际约定：overrides 中 bg/bg2/bg3/text/text2/text3/text4/border/rule 是当前模式快捷输入；mode 可同时指定目标明暗。`overrides.main` 是工具已公开的共享主色；其他共享参数同样作用两模式。仅修改深色应显式传 dark。

为防止共享输入被旧分支遮盖：对本次显式写入的共享 key，移除两模式同 key，再叠加本次显式 light/dark。显式模式输入的优先级最高。显式字体输入按 role 清除该角色旧共享和模式 `font-*` 遮盖，本次显式共享/模式变量仍优先；无 role 只加载字体。例如 `{overrides:{main:'#663399'},dark:{main:'#aa77cc'}}` 最终浅色用共享紫色，深色用显式浅紫。当前模式快捷颜色只更新当前分支，不影响另一模式。该规则同时适用于 save 与 tweak，并在工具说明及回读结果中公开。

save 的显式分支替换与 tweak 的分支合并继续区分；null 保持已有清空语义。`tweakTheme({overrides:null})` 清除自定义变量、双模式和字体，但保留实例、skin/shell/origin；有效值回到这些实现的宿主默认值，不重新执行来源继承。若同时传清空和其他设计补丁，以现有清空优先合同处理并在说明中明确。

所有参数先完成校验，再生成结果；没有部分修改、commit、存储或 toast 副作用。删除活动自定义主题回到产品默认 iOS；外观还原继续回到 iOS 与玻璃 Dock，保留内容和主题库。显式 apply 继续清掉当前一次性的 frameOff，编辑/派生当前方案不清偏好。

## 5. 读取、模板与同步

主题入口接受 unknown，并共享一个主题条目校验函数，覆盖标识、文本、变量、字体、mode、builtin、skin/shell 组合与 origin 形状。新合同的设计快照必须带合法实现引用；不通过实例 ID 推断自定义主题 skin，不新增旧格式桥接或双写。现有宽松本地读取可按既有策略跳过损坏条目，但不自行清空真实存储；同步、备份和显式导入在正式写入前严格拒绝损坏输入，不能先过滤再报告成功。

`readTemplates` 使用快照原 theme.id 在规整后的库中精确查找；不能选首个非 default。模板快照与完整主题库使用同一校验。采用模板时，查重需要比较完整设计、skin/shell/origin/mode 与名称；对象键顺序不能改变语义。冲突 ID 可生成后缀，但保留原设计和实现来源；库满不得悄悄应用错误主题。

`syncData.validateRecord(config:workspace)` 严格校验 themes 与模板内 snapshot.theme，包括实现组合和字体；快照的出入站、备份恢复与增量配置均复用此合同。`incrementalConfigSchema` 已委托 validateRecord，优先补共享边界及往返测试；只有真实遗漏才改包装模块，避免重复校验器。

现有旧缺陷探针 `research/theme-identity-probe.mjs` 保留为历史证据，它断言旧缺陷存在，不作为绿色回归，也不为掩盖结果而改写。

## 6. 接线与交接

核心实现负责 workspace 类型/内置快照、主题领域解析与操作、主题读取、模板、外观查询、同步校验和非 UI 行为测试。App/Settings/tools 实现方消费 `resolveTheme` 与目录能力：dataset.skin、switchOn、win98On、visibleDock、frame 支持及窗口初始化 effect 均不再基于实例 ID。窗口初始化 effect 仅依赖 shell 改变，同 shell 换色不重置已打开桌面窗口。

App、工具、设置、CSS、长期文档和浏览器测试由主会话协调的其他实现范围承担；核心实现者不抢改。产品代码开工前由主会话审读本文与 implement.md 并激活任务。所有实现共用工作区，不能回滚他人修改，子代理不提交。
