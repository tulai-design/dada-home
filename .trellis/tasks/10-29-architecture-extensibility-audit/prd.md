# 架构扩展性评估

## Goal

从现有代码评估主题、Agent、应用和宿主架构的扩展性，形成有证据、有优先级的中文评估报告；本轮不重构业务代码。

## Requirements

- 阅读实际源码，评估主题、Agent、应用、状态与存储的职责和依赖。
- 以新增配色主题、桌面皮肤、Agent 能力和应用形态为具体扩展场景，说明改动会集中还是扩散。
- 区分当前优势、已存在的问题和未来需求才触发的设计工作；每项主要判断给出源码证据。
- 输出中文评估报告、分阶段建议及验证边界；建议不代表已经接受或实现。
- 本轮只修改评估文档与任务记录，沿用 main，不改业务实现、不推送。

## Acceptance Criteria

- [x] 形成包含总体判断、架构关系、扩展场景、优先问题和演进顺序的中文报告。
- [x] 主要结论能回溯到本次基线的真实源码；对具体执行风险进行隔离复现或明确标注静态推断。
- [x] 核对文档链接、源码行号与 diff，记录检查及未验证范围。
- [ ] 将报告加入文档入口，完成本地提交与本任务归档记录。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
