# A3 审查与规划验证

日期：2026-10-30。代码基线27358e2，main。此文件验证本轮研究与规划产物，不代表A3运行时已交付；父任务和四个子任务均保持planning。

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

后续第一项为theme-identity。父任务只在必要子项与集成验收完成后归档，不把本轮规划完成当整个A3完成。
