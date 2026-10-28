# Standards 审查

日期：2026-10-28。基线：`9315c033e46e11e05c6a47277aaa168ea6f3f0bc`。审查命令为 `git diff 9315c03`，另完整读取所有未跟踪的 `.trellis/tasks/10-28-*` 与 `docs/work/milestones/2026-10-28-storage-sync.md`；基线之后无新提交。仅审查研究/规划，不把尚未实现的产品能力算作本轮缺陷。

最终结论：**Standards 通过，未解决发现 0 项，无阻塞。初查两处研究事实文案已修正并复核。**规范依据为 AGENTS.md、`.trellis/workflow.md`、`docs/README.md`、`docs/agents/workflow.md`、`docs/agents/issue-tracker.md`、`docs/agents/domain.md` 及前端状态/类型/质量规范。

## 已修正发现

1. **[P2，已修正] 不应将默认文件名描述成所有后端的固定契约。** `research/sync.md:22` 原写“所有后端使用 dada-sync.json”。实际 HTTP 原样使用配置 URL（`src/lib/sync.ts:359–360`）；WebDAV 对显式 `.json` 地址也原样使用（`:308–310`）；只有 Gist 固定读取 `FILE`（`:339`）。依据 `.trellis/workflow.md` Phase 1.2 的“注明来源、事实和推断”，原引用常量不足以支持全称判断。现已准确分别描述 Gist、WebDAV 默认/显式地址和 HTTP 配置 URL，并补充源码行号。
2. **[P2，已修正] 将零网络承诺限定到同步请求。** `research/sync.md:122` 原写“纯本地模式不配置服务就不会联网”，扩大成整个产品不联网，与 `README.md:105` 明示的 AI、搜索、订阅、天气等网络功能冲突。依据 `docs/README.md` 的单一事实来源和 `docs/agents/domain.md` 的现状/目标区分，现已改为未启用同步时不发送同步请求，其他网络功能仍按各自配置工作。

## 已核对

- 7 个任务均为 planning；父子关系一致，依赖可解析且无环；实施地图与元数据一致。复杂子任务明确在激活前补 design/implement，没有把父设计冒充已定稿服务协议。
- 14 份 JSONL 路径全部存在且各清单无重复；研究/规划中 47 个本地 Markdown 链接有效。依赖清单继续由 task.json 维护，父实施地图提供阅读入口。
- 中文文档、稳定术语、任务与长期文档分工符合项目规则；运行时设计规范正文未复制。研究建议均标注未实现，正式顺序以父 PRD/design/implement 为准；原 AI 搭建父任务组合验收未误归档。
- 复查新增 `docs/product/product-brief.md` 能力地图和 `docs/specs/README.md`：已交付的分区/草稿、图表/数据表、特效约束与有限 DOM 检查按既有证据更新，仍保留父任务组合验收未完成；新存储/服务仅标为规划。没有把本轮研究伪写为迁移完成。
- 两份探针只读、转译真实源码；存储是内存替身、fetch 被形参替身覆盖、凭据为夹具占位值；没有浏览器连接、真实配置读取或网络调用。未加入产品 test 脚本。
- 本次重新执行 `local-storage-probes.mjs` 与 `sync-probes.mjs`，分别复现 7 项与 11 项现状。脚本和报告明确说明 **18 项现状复现不是修复验收通过**；没有要求纯规划修改运行产品测试、tsc、build 或不存在的 lint。
- 本地模式与可选服务、发布另行授权、不迁移真实数据、不改真实连接的边界清楚；没有发现新依赖安装、产品代码实现或发布动作。

以上两项修正已核对原代码与最新文案，不要求新增字符串测试。没有额外 Fowler 启发式发现：两个探针保留各自隔离装配具有验证目的，不建议为研究夹具引入通用存储抽象。
