# A3 审查与规划验证

日期：2026-10-30。初始研究代码基线27358e2，main。以下保留初始研究与规划证据，当时父子任务均为planning。后续 theme-identity、shell-host 与 theme-authoring 已分别实施并记录验收；local-theme-packages 本轮完成实现并汇总最终验证，下面增加整体验收；不以初始研究证据冒充生产验证。

## 已完成的证据工作

- 阅读主题数据/纯操作/运行校验、App外壳/导航/窗口/设置、Agent工具/技能、CSS/portal/资源、应用注册/沙盒、扩展CSP、模板及备份同步。
- 三个独立研究分别输出shell-structure、theme-authoring、workshop-contract，范围与事实/提案清楚区分。
- 本机Node执行research/theme-identity-probe.mjs：iOS/Switch/Win98派生丢皮肤身份与my-custom模板读回ios，4/4历史缺陷复现。共享main写入与有效值被模式分支覆盖也在输出中体现；无用户数据/网络写入。
- 用户确认分层开放，记录ADR0005；建立主题身份、ShellHost、作者/预览、本地包四项纵向任务和blocked_by链，无生产重构。
- 已写父design/implement、四子PRD、聚焦上下文，5项task validate通过；未来子项激活前再细化自己的design/implement，不能因上下文非空就冒充可执行设计已完成。

## 审查

- Spec/可行性：作者链路、外壳结构、包与平台合同分别独立复核，0项可行动矛盾。补明确close-content与最小化语义，保留完整ThemeSpec和origin溯源，安装/启用分离。
- Standards：0项可行动偏差。独立核对中文、唯一事实来源、父子任务/依赖、planning状态及设计未冒充交付；未改运行时规范或擅自归档。

## 自动检查与限制

- git diff --check通过。
- Markdown本地引用检查122项无缺失；任务JSON/依赖、父子双向关系与planning状态检查通过。校验器按Trellis原生parent目录名和blocked_by逻辑ID分别解析，未改原生元数据结构。
- 本轮未修改src、生产配置或依赖，因此未运行产品tsc/test/build或主题浏览器矩阵；这些检查已在各子PRD和父implement中列为实施验收要求。
- 外部平台参考与限制见workshop-contract及汇总研究，不声称开发者模式等于商店可发布。

## 四阶段最终集成验收

前三项已各自完成并归档，本轮 local-theme-packages 完成最后一项纵向交付。A3 范围为深度主题身份、稳定宿主、作者预览和本地数据主题安装；在线工坊与第三方执行 runner 仍为后续。

| 阶段 | 已交付结果 | 验证来源 |
| --- | --- | --- |
| theme-identity | 完整派生保留 skin/shell，模板精确身份往返 | 子任务既有验收；本轮身份18、工具20、主题22回归 |
| shell-host | 固定业务舞台、普通/Switch/Win98统一导航与故障恢复 | 子任务既有浏览器矩阵；本轮Win98包启停跨壳8项生命周期 |
| theme-authoring | 共用目录、草稿、隔离预览、一次提交 | 子任务既有矩阵；本轮作者16、旧预览17、资源协议12、字体14 |
| local-theme-packages | 本地JSON/WOFF2安装与启停、完整导出、缺依赖保留、恢复 | 子任务 verification/browser-validation及领域17、备份27、真实存储浏览器4 |

本轮实际从包安装到个人变体、独立预览、停用回退、恢复、导出与引用保护构成跨阶段闭环；当前输入、生成应用iframe/init、助手草稿和待决审批在Win98→paper→Win98保持，停止取消原操作。模板与配置/full/增量同步保留未知合法设计，完整备份包含资源且恢复停用。

最新 `pnpm test`、`pnpm build`（含tsc/Web/MV3/ZIP）均通过；独立 Standards/Spec 均无遗留发现。最后预览迟到资源护栏定向12/原17通过并重新构建。静态生产 PWA 离线22/22、MV3 21/21通过；最终子项记录保留命令与截图，父子一并归档。未运行不存在的lint，未推送或发布。
