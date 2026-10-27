---
status: accepted
date: 2026-10-27
---

# 一套任务状态，多种工程方法

用户要求参考 Tulai 建立 Trellis 文档体系，同时使用 Matt Pocock 的技能。选择 Trellis 作为唯一任务记录，Matt 技能负责需求归纳、纵向拆分、行为测试与需求/规范双轴审查。

不并行维护 `.scratch` 和 GitHub Issues，避免三个地方出现不同进度。产品与稳定契约放 `docs/`，源码约束放 `.trellis/spec/`，未完成工作与证据放 `.trellis/tasks/`。现有 `docs/design-system.md` 由应用内 AI 直接读取，因此保留路径，只通过索引纳入体系。
