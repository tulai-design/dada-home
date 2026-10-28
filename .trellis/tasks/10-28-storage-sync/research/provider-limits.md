# 存储与供应商官方边界

核对日期：2026-10-28。这是文档研究，不是使用用户 Gist 的真实容量测试。

## Gist：能保留兼容，不作为长期完整聊天库的主要增量通道

[GitHub Gists REST 文档](https://docs.github.com/en/rest/gists/gists)说明：单文件 API 正文至多返回 1MB，超出由 `truncated` 标记，完整内容可走 `raw_url`；超过 10MB 的文件需克隆 Gist。文件列表超过 300 项也会截断。这是 API 获取边界，**不是「Gist 只能存 1MB」**。当前客户端已经走 raw_url，但没有 git clone 能力。把每个会话改成一个 Gist 文件也会引入列表/请求管理边界，不能视为无限扩容。

[GitHub REST 限流](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)列出一般个人令牌 5000 请求/小时，以及内容写入通常不超过 80 次/分钟、500 次/小时的次级限制，部分接口更低且可能变化；不能把这些通用值当作 Gist 的保证吞吐量。当前可见页每 3 分钟轮询不必然触限，整包体积和并发正确性是更直接的问题。[官方最佳实践](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)要求按 Retry-After/重置时间退避，并建议串行请求与条件读取。

[Gist 概念](https://docs.github.com/en/get-started/writing-on-github/editing-and-sharing-content-with-gists/creating-gists)：Gist 是 Git 仓库，有历史版本；secret 仅不公开检索，不等于只有令牌持有人可读。因此上传聊天的保密性不能只依靠 secret 标签；加密与访问令牌是不同责任。当前模式的口令变化和脱敏错误见 [同步报告](sync.md)。新快照删掉字段不会自动抹除既有历史版本。

工程推断：若原始同步包为 20MB，有一条 1KB 改动且需要上传，当前实现仍读取整个包并重写整个包；这只是算法规模示例，不是用户数据实测。加密后体积还受封装影响。换到 WebDAV 但继续同一协议也没有改变这一点。

## IndexedDB：已有使用，100KB 不是浏览器额度

[MDN 存储配额文档](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)说明：IndexedDB 适合大结构化数据，额度由浏览器按来源管理；`navigator.storage.estimate()` 返回估算，`persist()` 可以申请持久模式但未必获准，额度不足仍会抛 `QuotaExceededError`。不能承诺固定几百 MB 或任意大小都能保存。

现有 100000 是源码中的 JSON 字符串长度限制；它属于应用宿主策略，与以上浏览器额度不同。新容量界面应分别展示业务序列化字节、浏览器来源总估算和远端能力，不能混成一个数。

## 可选自建服务的初步选择

用户确认允许可选自建服务，仍完整支持纯本地。[SQLite 官方适用场景](https://sqlite.org/whentouse.html)包含单机应用服务底层数据库；多写者需要排队，不适合多机直接共用网络文件锁。建议首期单人多设备由 HTTP 服务访问本机 SQLite 持久卷，不让客户端同步数据库文件。这里是选型方向，不是已经确认驱动版本或部署完成；服务任务须核对实际镜像 Node 版本，当前运行镜像通过 apk 安装 Node，并未等于构建阶段 node:22。

| 方案 | 本项目建议职责 | 仍需承担的工作 |
| --- | --- | --- |
| 纯本地 IndexedDB + 文件备份 | 完整默认路线 | 写入确认、恢复、容量和历史分页 |
| Gist v1 | 小规模兼容同步/快照 | 大包读取边界、限流、加密与并发限制提示 |
| WebDAV / HTTP v1 | 已有自有存储兼容路线 | 整包成本、条件写能力、首次创建和错误处理 |
| 可选自建 v2 | 长期聊天和应用数据增量同步 | 变更游标、认证、幂等、冲突、持久卷和可恢复部署 |

本轮不接入用户远端，不测实际配额，不主动更换供应商，不默认删除旧快照。
