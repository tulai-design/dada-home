# 快照同步供应商边界

核对日期：2026-10-28。源码基线 `8ff7043`；只读源码与官方文档研究，无真实令牌、远端或用户数据访问。用户已允许按新项目实现，不要求旧协议、旧实例或旧远端迁移适配。

## 当前问题

当前 provider 位于 `src/lib/sync.ts:293–383`，混在 React 状态、记录投影、加密和合并之中：

- `Remote.read()` 以 `text:null` 表示缺失，但 HTTP 分支还把 200 空正文归为缺失。损坏/空文件可能因此被覆盖。
- WebDAV/HTTP 仅在读到 ETag 时发 `If-Match`，首次创建无 `If-None-Match:*`；缺失或弱 ETag 时写入退为无条件覆盖，却未呈现能力边界。
- Gist JSON 直接断言、缺 `content` 当缺文件；顶层文件列表截断未判断；`raw_url` 响应不检查状态；无限制读取正文；创建回复不确认非空 ID。
- `403` 统一显示令牌错误，`429` 没有退避；没有请求/响应字节预算与有限超时。
- Gist 创建副作用回调直接改配置，容易在用户切换连接后把旧请求的 ID 写入新配置。provider 不应知道配置 store。

## 官方事实

GitHub Gist API 每文件正文返回至多 1 MB，超出通过 `truncated` 指示，完整内容可取 `raw_url`；大于 10 MB 需 git clone；顶层文件列表超过 300 项也可能截断。这是读取 API 边界，不是 Gist 总存储配额。[Gist REST 文档](https://docs.github.com/en/rest/gists/gists#truncation)

Gist PATCH 只更新指定文件，未指定文件保持；文档未列 expected revision。GitHub 明确 unsafe methods（包括 PATCH）的条件请求默认不受支持，除非对应接口另有说明。故 Gist 的读取 ETag 只能用于缓存优化，不能作为受支持 CAS 保证。重读后再写仍有竞态。[更新 Gist](https://docs.github.com/en/rest/gists/gists#update-a-gist)、[条件请求说明](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests)

GitHub 限流可以是 403 或 429：遵守 `retry-after`，或 `x-ratelimit-remaining:0` 配合 `x-ratelimit-reset`；次级限流无以上头时至少等待一分钟，再指数退避。普通 403 也可能是权限错误，不能仅按状态判定限流。官方建议串行请求与控制写频率，通用额度不应硬编码成 Gist 的吞吐保证。[限流状态](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#exceeding-the-rate-limit)、[限流处理最佳实践](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#handle-rate-limit-errors-appropriately)

HTTP `If-Match` 使用强比较，用于更新已读版本；`If-None-Match:*` 可保护首次创建；条件不满足时不执行写入，通常返回 412。弱 ETag 不能作为强版本匹配。WebDAV 同样使用这些原语避免丢失更新；具体 HTTP 服务、代理与浏览器 CORS 必须保留/暴露相关头。[RFC9110 条件请求](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1)、[WebDAV 避免丢失更新](https://www.rfc-editor.org/rfc/rfc4918.html#section-7.2)

## 最小模块接口建议

这是设计建议，父任务定稿后再实现；不是已存在接口。

```ts
type RemoteVersion =
  | {kind: 'missing'}
  | {kind: 'etag'; etag: string}
  | {kind: 'unprotected'}

type RemoteRead =
  | {text: null; version: {kind: 'missing'}}
  | {text: string; version: Exclude<RemoteVersion, {kind: 'missing'}>}

type RemoteWrite = {createdGistId?: string}
type SyncRemote = {
  read(): Promise<RemoteRead>
  write(text: string, expected: RemoteVersion): Promise<RemoteWrite>
}
```

拆出 `syncProviders.ts` 只做连接、鉴权、传输、正文预算、条件头与错误分类。配置类型可置于独立轻量文件，或以结构化 provider 参数进入；不得反向 import `sync.ts` 形成运行时循环。协议解析、可同步范围、加密口令、本地 meta、记录冲突和配置保存继续由同步协调层负责。

`missing` 仅指明确不存在：HTTP/WebDAV 的目标 404，或无 Gist ID；现有 Gist 元数据确认完整且确实缺目标文件也可以创建该文件。已有 Gist ID 的 404 是权限/不存在错误，不能自动创建替代。200 空正文仍是现有内容，交给严格协议解析拒绝。目标文件在截断文件列表中不可见时必须失败，不推断缺失。

WebDAV/HTTP 首次 PUT 发 `If-None-Match:*`；已有强 ETag 发 `If-Match`；缺失/弱 ETag 的更新默认拒绝，或有显式无保护选项并如实呈现，禁止静默降级。收到 412 后重读重算，有限次数重试；不对同一旧包盲重传。服务器忽略条件头的行为不能仅靠一次成功 PUT 证明安全，端到端契约测试要验证 stale write 确实失败。

Gist 固定声明无写比较保护。创建成功后返回 ID 给协调层，协调层只在请求时目标连接仍相同时保存。仅更新新方案指定文件，避免破坏其他文件。GET/POST/PATCH 都验证响应形状；raw 下载也必须检查状态、读取预算、超时，不把错误页作为同步正文。

## 错误和预算建议

错误携带稳定 `code`（`auth` / `rate-limit` / `conflict` / `http` / `network` / `invalid-response` / `too-large` / `unsupported-write`）和可选 `retryAt`，UI 不解析中文文本。保留必要 HTTP 状态，不把响应正文、令牌、Basic auth 或带凭据 URL放入错误文本。

退避采用失败后记录冷却截止时间并立即返回，后续自动/手动请求在截止前零网络；不通过长时间 sleep 挂住同步/备份恢复。403 只有明确限流头或官方限流错误语义才归 `rate-limit`。`Retry-After` 支持秒和 HTTP 日期；没有可信指示的次级限流使用有限指数退避。一般 401/403 不自动重试，网络写失败不冒充已保存。

建议 Gist 应用侧预算保守低于官方 raw 获取边界（例如 8 MiB UTF-8 封装后文件），明确这是搭搭的处理预算；应用源码/加密 Base64 也计入。WebDAV/HTTP 可单独设置更大预算。入站先看可信可用 Content-Length，仍按实际流读取累计字节并中止超量；出站序列化为真正发送的文本后检查。协议层还有独立解密后大小/形状校验，不能只限制外层文本。

## 最小验收

- 200 合法内容、目标 404、已有 ID 的 Gist 404、200 空正文、非法 JSON/形状、顶层截断、截断文件缺 raw_url 分别有确定结果。
- raw 500 不进入协议解析；非 UTF-8/超预算、实际字节超过 Content-Length、超时均失败，零本地/远端替换。
- 首次创建竞态发送 `If-None-Match:*`，stale update 发送强 `If-Match` 并得到 conflict；无强 ETag 禁止隐式安全声明。
- Gist 403 auth 与 403/429 限流区分；冷却期再次调用零网络，过期后重试；生成 Gist ID 只返回给调用者。
- 连接测试只 GET，无 PUT/PATCH/POST，也不保存 Gist ID；配置切换时旧请求不污染新连接配置。

本研究未承诺任意 WebDAV 服务的实际条件头支持，也未尝试验证真实供应商账号、额度或代理配置。
