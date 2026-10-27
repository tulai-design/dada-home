<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

# 搭搭项目约定

- 使用中文维护产品文档、任务与工作日志；源码标识符沿用现有英文命名。
- 本仓库消费 Trellis，不是 Trellis CLI 源码仓库；不要创建 `packages/cli` 或同步上游模板。
- 先读 `docs/README.md`、`GLOSSARY.md`、相关 `.trellis/spec/` 索引和当前任务。
- `docs/design-system.md` 是应用内 AI 的运行时技能来源，保留其路径与单一正文。
- 始终使用 `/Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/pnpm`。不要使用 Codex Runtime 自带的 pnpm；其他机器先确认本机兼容版本。运行 build 时确保子进程的 PATH 同样优先本机 Node/pnpm。
- 实际可用检查是 `exec tsc --noEmit`、`test`、`build`；本项目没有独立 lint 命令，不得声称已运行 lint。
- 延续用户要求在 `main` 开发；是否提交、推送或发布遵循当前会话授权，不因技能默认行为自行推送。
- 用户已约定每轮完成并通过检查后提交本轮代码；除非后续明确要求不提交，否则收尾包含本地提交。推送、发布仍按会话单独授权。

## Agent skills

### Issue tracker

唯一任务系统是本地 Trellis：`.trellis/tasks/`。Matt 技能中的 spec/ticket 对应父任务与子任务，不再建立 `.scratch/` 或重复的 GitHub Issues。见 `docs/agents/issue-tracker.md`。

### Domain docs

单领域：术语用根目录 `GLOSSARY.md`；ADR 用 `docs/decisions/`，不另建 `docs/adr/`。见 `docs/agents/domain.md`。

### Workflow integration

Matt 技能提供需求归纳、纵向任务拆分、行为测试和双轴审查方法；Trellis 管理状态、上下文和日志。项目适配以 `.trellis/workflow.md` 和 `docs/agents/workflow.md` 为准，优先于所安装技能的默认路径、默认 tracker 和通用示例。

用户已确认的范围和开工授权持续有效，不对同一方案重复询问；存在影响范围或结果的未决问题才澄清。先把已授权内容做成可审查产物。测试接口优先沿用现有公开行为边界；若改变产品契约或引入新的外部依赖，再明确讨论。纯文案/文档修正不写字符串快照测试。
