# Matt 方法与 Trellis 编排

状态：accepted，2026-10-27。

用户选择 Matt Pocock 技能方法，并要求参考 Tulai 的文档与 Trellis 编排。本仓库使用一套任务状态、一份领域术语、一处长期契约。Trellis 的本地流程入口是 [workflow.md](../../.trellis/workflow.md)。

| 时机 | 方法 | 写入位置 |
| --- | --- | --- |
| 归纳已确认需求 | `to-spec`：用户问题、行为、范围、测试决策 | 父任务 PRD |
| 拆分工作 | `to-tickets`：每个任务交付完整可验证行为，记录依赖 | 子任务 PRD + 元数据 |
| 术语和重要取舍 | `domain-modeling` | GLOSSARY + decisions |
| 源码约束 | `trellis-spec-bootstrap` / `trellis-before-dev` | `.trellis/spec/` |
| 实现 | `implement` + `tdd`，小步测试公开行为 | 源码、现有测试体系 |
| 审查 | `code-review`：规范轴与需求轴分别检查 | verification |
| 收尾 | Trellis 验证、规范晋升、归档、日志 | tasks / spec / workspace |

## 项目适配

- 上游技能正文保留原貌，路径、tracker、语言及权限以 AGENTS 和本地 workflow 为准。
- 已确认的三批增强方案不重新进行需求访谈；细节依据现有代码和已同意的验收目标补齐。新范围或真正影响结果的选择再询问。
- 一个子任务必须可独立展示或验证，不把 schema、UI、测试分别当三项“完成”。后续复杂子任务在激活前再补技术设计，避免现在假定全部实现细节。
- 计划中的测试入口：工具/工作空间写入与撤销、组件可观察的渲染行为。优先现有测试入口；文案修正不写实现镜像测试，UI 变化需要浏览器验证。
- 本次基线为 `d896f02d6dcb0e383db0dd7f0d5137c6f86f44b6`。未提交改动审查使用 `git diff <baseline>` 并检查未跟踪文件；不能用空的 `<baseline>...HEAD` 冒充审查。
- 审查分别记录 Standards（项目规则）与 Spec（当前任务验收）。使用多代理时明确文件所有权，审查者不能把未来任务的未实现项算作当前任务缺陷。
- archive 和 journal 不自动提交；上游 `implement` 的默认 commit 也服从当前会话授权。部署、发布、外部消息不由技能安装隐含授权。

## 可重复运行

```sh
python3 .trellis/scripts/get_context.py
python3 .trellis/scripts/get_context.py --mode phase
python3 .trellis/scripts/get_context.py --mode packages
python3 .trellis/scripts/task.py list
```

原生会话上下文不可用时，在当前 shell 显式设置唯一的 `TRELLIS_CONTEXT_ID` 后使用任务脚本，不复用其他聊天的指针。Codex hook 是否自动运行取决于用户已有配置；未启用时手动运行上述脚本即可，不修改全局配置。

## 技能来源和升级

Matt 技能来自 [mattpocock/skills](https://github.com/mattpocock/skills)，固定版本与许可见 [.agents/skills/SOURCES.md](../../.agents/skills/SOURCES.md)。这次只安装所需九个技能到项目目录；无需全局安装或改依赖。后续更新先比较上游差异，保持本文件的项目映射。

Trellis 由本机 CLI 初始化，模板版本见 `.trellis/.version`。本地修改由 `.template-hashes.json` 的上游基线识别；不要重写哈希假装未定制，也不要在更新时直接覆盖本地 workflow/spec。
