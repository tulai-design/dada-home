# 任务系统：本地 Trellis

状态：accepted，2026-10-27。用户指定建立 Trellis 任务；本文件适配 Matt Pocock 技能的 tracker 协议。

## 映射

| 技能中的概念 | 本项目位置 |
| --- | --- |
| spec / parent issue | `.trellis/tasks/<parent>/prd.md` |
| ticket / sub-issue | 一个独立子任务目录及其 `prd.md` |
| technical design | 当前任务的 `design.md` |
| execution plan | 当前任务的 `implement.md` |
| blocking edges | `task.json.meta.blocked_by`（任务 id 数组），PRD 中的同名引用 |
| review evidence | 当前任务的 `verification.md` |
| research | `docs/work/research/` 的稳定报告，或任务自己的 `research/` |

父子关系不等于执行依赖。`blocked_by` 是本项目约定，Trellis CLI 不自动执行依赖调度；开始前必须检查前置任务是否已验收。任务 id 在归档前后保持不变，解析时同时查活动目录和 `archive/`。

## 生命周期

- `planning`：已建立，尚未进入执行；复杂任务补齐 design/implement 后才能 start。
- `in_progress`：已经开始；完成代码但未通过验收仍保持此状态。
- `completed`：验收有证据，使用 `task.py archive` 完成归档。
- `task.py finish` 只清除会话指针，不代表完成。

未安装 `triage` 技能，不创建一套重复的 triage label。所谓 ready-for-agent 是“需求已确认、前置完成、上下文有效”的工作条件，不冒充 Trellis 原生状态。

## 操作

```sh
python3 .trellis/scripts/task.py create '标题' --slug feature --description '用户价值与范围' --no-start
python3 .trellis/scripts/task.py create '子任务标题' --slug feature-slice --description '独立可验收结果' --parent <parent-id> --no-start
python3 .trellis/scripts/task.py add-context <id> implement <spec-path> '需要读取的原因'
python3 .trellis/scripts/task.py add-context <id> check <spec-path> '审查依据'
python3 .trellis/scripts/task.py validate <id>
python3 .trellis/scripts/task.py start <id>
python3 .trellis/scripts/task.py current --source
python3 .trellis/scripts/task.py archive <id>
```

Matt 技能要求 publish/fetch ticket 时，使用上述本地文件和脚本。不要顺带创建 GitHub Issue、发送消息或开启另一个 Codex chat。`session_auto_commit: false` 防止日志与归档自动提交；提交和发布按会话授权处理。

本项目按用户要求直接在 main 工作、未创建 PR 的任务，归档使用 `task.py archive <id> --no-commit --skip-branch-validation`。这个参数仅用于明确没有 PR 的任务；有 PR 的任务继续正常核对 branch/base_branch。
