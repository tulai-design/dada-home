# 开发工作日志

任务统一位于 `.trellis/tasks/`；本目录只保存人工整理的会话记录。

| 开发者 | 日志索引 |
| --- | --- |
| ROYIANS | [ROYIANS/index.md](ROYIANS/index.md) |

每位开发者有一个 index 和按需轮换的 journal-N.md；单文件最多 2000 行。日志使用中文，记录真实变更、检查结果、未完成任务；不保存密钥、原始对话或敏感请求。

使用 `python3 .trellis/scripts/add_session.py --title '标题' --summary '摘要' --no-commit` 记录。没有提交时不要捏造 SHA，规划或未提交会话可用 `--commit -`。归档和日志均不自动提交。
