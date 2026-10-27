# 搭搭开发工作流

本文件是项目工作流的事实来源。Trellis 管状态与上下文，Matt Pocock 技能提供工程方法。项目适配见 `docs/agents/workflow.md`；已确认的用户意图和授权持续有效。

## Phase Index

Phase 1: Plan → 归纳需求、拆分可验证任务、登记依赖与上下文。
Phase 2: Execute → 激活一个可执行子任务，小步实现并验证。
Phase 3: Finish → 双轴审查、更新规范、按授权提交、归档与日志。

- 小修复可只写 PRD；复杂任务须有 PRD、design、implement。
- 同一批准范围不重复询问开工；新范围、外部副作用或关键未决选择再澄清。
- 父任务管理目标和集成，子任务各自交付完整行为；`meta.blocked_by` 显式记录依赖。
- 规划不等于实现；没有运行的检查不能标记通过。
- 先读 AGENTS、GLOSSARY、相关 spec 和任务材料；所有任务都以本地 Trellis 为准。

[workflow-state:no_task]
读取现有任务与用户要求；复杂工作使用 Trellis。用户已要求建任务或已授权当前方案时直接建立，不重复索要相同许可。小范围解释无需任务。
[/workflow-state:no_task]

[workflow-state:task_error]
先修复当前任务的元数据或路径，不另建任务掩盖问题。保留原有字段与上下文；无法确定真实状态时向用户澄清。
[/workflow-state:task_error]

[workflow-state:planning]
归纳已确认需求到 PRD，复杂任务补 design/implement；上下文引用必须有效。依赖任务验收后才能 start。已有开工授权无需重复确认，新范围先澄清。
[/workflow-state:planning]

[workflow-state:planning-inline]
按本地 tracker 写 PRD/design/implement，核对依赖与上下文；已有开工授权后 start。上下文必须主动读取，不能假定 hook 已注入。
[/workflow-state:planning-inline]

[workflow-state:in_progress]
按当前子任务实现与验证。代码检查按项目实际命令；审查区分 Standards 与 Spec。稳定知识写回 docs/spec。提交按会话授权；通过验收才归档，日志不自动提交。
[/workflow-state:in_progress]

[workflow-state:in_progress-inline]
主动读取当前任务与 implement/check 上下文，执行小步验证和双轴审查。更新稳定规范，按会话授权提交；有验收证据后归档并记日志。
[/workflow-state:in_progress-inline]

[workflow-state:completed]
任务已验收，核对归档与日志。父任务只在全部必要子任务及集成验收通过后完成。不要把规划中的后续功能记为交付。
[/workflow-state:completed]

## Phase 1: Plan

#### 1.0 Create task

运行 `python3 .trellis/scripts/get_context.py` 和 `task.py list`。复用合适任务；用户要求建任务即是授权。使用 `task.py create --description ... --no-start` 建立父/子任务。不创建重复 GitHub Issue 或 `.scratch`。

#### 1.1 Requirement exploration

按 Matt `to-spec` 归纳当前已确认的问题、交付行为、用户故事、测试决策与范围外。按 `to-tickets` 拆完整纵向结果；每项独立可验证，依赖写入 `task.json.meta.blocked_by` 并在 PRD 引用。PRD 不堆实现路径；design 记录技术契约、兼容和回滚，implement 记录步骤与检查。

未来复杂子任务可以先有完整行为 PRD，在激活前再补 design/implement；不能因已建任务就宣称已完成设计。

#### 1.2 Research

优先读取现有代码和文档，库选择查官方资料。研究写入任务 research 或 `docs/work/research`，注明日期、来源、事实和推断。不要把库安装等同于 AI 已能调用，也不要复制另一项目的业务约束。

#### 1.3 Configure context

用 `task.py add-context <id> implement|check <path> <reason>` 登记相关规范与研究，执行 `task.py validate <id>`。上下文清单放 spec/research；源码路径放 design/implement。每个清单保持聚焦，避免所有任务都注入全部规范。

#### 1.4 Activate task

先检查 blocked_by 已验收、PRD与必要设计完整、上下文有效；沿用已获得的开工授权，运行 `task.py start <id>`。CLI 不会自动调度依赖。会话指针由原生会话 id 识别；不可用时仅为当前 shell 显式提供唯一的 TRELLIS_CONTEXT_ID。

#### 1.5 Completion criteria

本阶段完成表示任务可执行，不表示产品已交付。父任务可以作为当前编排上下文，但实际代码应归属明确子任务。

## Phase 2: Execute

#### 2.1 Implement

读 `trellis-before-dev`、当前 PRD/design/implement 和 JSONL 引用。按 Matt implement 的小步方法执行；逻辑变更沿用公开行为接口做红绿测试，文案/文档不写实现镜像测试。不要批量先写一堆假设接口的测试。

可独立的文档、实现、审查用协作代理，明确文件所有权且不回滚别人工作。当前环境没有自定义 Trellis agent 时用可用 worker/explorer，并显式传入 task 路径与规范，不能宣称不存在的自动注入已经执行。

使用本机 pnpm 的绝对路径；build 子进程 PATH 同样指向本机 Node/pnpm。没有 lint 命令。测试和类型检查选择与改动匹配的范围，最后运行必要集成检查。

#### 2.2 Quality check

按 Matt code-review 分别审查 Standards（规范）与 Spec（当前子任务验收）。未提交改动用 `git diff <baseline>` 并检查未跟踪文件；不要只检查提交间空 diff。两轴可并行，每项发现引用证据，修复后针对变化复查。

页面/组件布局变化须实际检查相关容器尺寸、双主题和减少动画；纯工具说明修改不宣称浏览器视觉效果已验证。记录已运行命令、结果与未验证范围。

#### 2.3 Rollback

实现不符先保留用户工作并修复当前子任务。若发现需求契约错误，回到其 PRD/design；若出现新范围，明确记录并澄清。不要为解决文档冲突删除现有业务能力。

## Phase 3: Finish

#### 3.2 Retrospective

重复修复同类错误时用 trellis-break-loop 分析，记录原因和预防。搭搭没有 Trellis 上游模板目录，勿执行模板镜像同步示例。

#### 3.3 Update specifications

把稳定的新契约写入 docs/specs 或 docs/decisions，精炼的源码约束写入 .trellis/spec。应用内 AI 使用的规范继续写在 docs/design-system.md。核对索引与相对链接，保留现状/目标区别。

#### 3.4 Commit

检查 dirty paths，区分本轮与用户已有改动。只有会话授权提交时才提交，推送/镜像发布使用相应授权；不能因技能默认 commit 而扩大授权。未提交时明确报告，不因此把已完成验收改写为失败。

#### 3.5 Wrap up

当前子任务验收通过后，写 verification，勾选真实通过的验收，使用 task.py archive；session_auto_commit=false。`task.py finish` 仅清理指针。用 add_session.py --no-commit 记录交付、检查和下一项。父任务在所有必要子任务通过集成验收前保持未完成。

本项目按用户要求直接在 main 工作、未创建 PR 的任务，归档使用 `task.py archive <id> --no-commit --skip-branch-validation`。这个参数仅用于明确没有 PR 的任务；有 PR 的任务继续正常核对 branch/base_branch。
