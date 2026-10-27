# 技术设计

通过本机 Trellis CLI 初始化单仓与 Codex 支持，使用项目内技能安装器固定 Matt 上游版本。AGENTS、docs/agents 和 .trellis/workflow 记录适配；保留上游技能正文与许可。任务唯一位置为 .trellis/tasks；本地 meta.blocked_by 是可审查依赖约定，不修改 Trellis 脚本实现调度。

文档参考 Tulai 的职责划分，源码规范由真实搭搭代码整理。docs/design-system.md 继续被 src/lib/skills.ts 直接读取。父任务覆盖增强路线，当前文档子任务和指引子任务独立验收；其他子任务仅规划，不伪造实施状态。

不复制 Tulai 的账户、业务约束和全局配置。session_auto_commit=false；脚本使用原生会话上下文或明确的本地会话标识。回滚仅涉及新增工程文档及配置，不修改工作空间数据。
