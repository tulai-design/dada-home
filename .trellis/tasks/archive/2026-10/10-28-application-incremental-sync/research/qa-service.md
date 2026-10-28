# Research: 双 origin 应用增量同步验收服务

- Query: 如何用真实 Tulai Sync HTTP/SQLite、两个随机 loopback origin 和可统计请求支撑浏览器回归？
- Scope: mixed；只读接口研究，不编辑启动脚本、不执行浏览器自动化。
- Date: 2026-10-28

## Findings

### 入口与建议配置契约

服务源码支持直接导入 `openStore` 和 `createSyncServer`。从环境 `TULAI_SYNC_REPO` 或明确默认 `/Users/xiaomengdao/WebstormProjects/tulai-sync` 解析路径，用 `pathToFileURL` 导入 `apps/server/store.mjs` / `http.mjs`，不导入会读取用户配置的 main.mjs。`mkdtemp` 创建临时目录，数据库独立为该目录内 `sync.sqlite`。

真实服务配置为 `createSyncServer({store,devices:[{id:'device-a',token:tokenA,scopes:[scope]},{id:'device-b',token:tokenB,scopes:[scope]}]})`，`listen(0,'127.0.0.1')`。每次 runId、scope、token、keyring 全部生成，只服务本次合成数据。两设备共享 scope/keyring，但 token 独立。SDK `createKeyring(scope)` 可从 Dada 当前固定包的 crypto 入口导入。

推荐两个 Node HTTP server 负责随机端口，分别挂 Vite middlewareMode 服务测试文件。`configFile:false` 防止加载本仓 Vite 配置中的 `host:true`、固定5173端口、通用远端代理和 PWA 插件。仅代理 `/__sync/` 到临时真实服务并删除此前缀，保持 query、方法和 body；不提供通用 URL 转发。

**本机已确认陷阱**：已安装 Vite 7.3.7 中，`createServer({server:{host:'127.0.0.1',port:0,strictPort:true,hmr:false}}).listen()` 实际绑定 **5173**。源码 startServer 将 falsy port 0 回落默认端口。因此不要靠 Vite 的 `port:0` 获取隔离 origin，应让自己的 `node:http` server `listen(0)`，再挂载 `vite.middlewares`。探针无浏览器、未读取用户业务数据，启动后已关闭服务。

本机探针结果：

```json
{"requestedPort":0,"actualPort":5173,"resolvedUrls":{"local":["http://127.0.0.1:5173/"],"network":[]}}
```

每端 `GET /__qa/config` 返回以下固定字段：

```text
{
  runId,
  scope: {appId:'dada-qa', spaceId:runId},
  deviceId:'device-a' | 'device-b',
  token,
  keyring,
  baseUrl:ownOrigin+'/__sync',
  origin:ownOrigin,
  peerOrigin
}
```

为该合成配置返回 JSON、Cache-Control:no-store；不在启动日志输出 token/keyring。主入口 `/tests/application-sync-regressions.html`，worker 可在 peerOrigin 载入 `/tests/application-sync-worker.html`；postMessage 必须使用并验证具体 peerOrigin 和 runId，而不是 `*`。

### 统计契约

`GET /__qa/stats` 建议返回累积计数，测试比较前后 delta，不依赖清零：

```text
{runId,requests,commits,commitBodyBytes,
 objectCreates,objectChunkPuts,objectChunkBytes,objectCompletes,
 objectGets,objectChunkGets,totalRequestBodyBytes}
```

这里 `commits` 是请求次数，不是成功 revision 数；可另设 committedResponses/conflictResponses，不能将 HTTP 重试次数当服务重复持久化证据。通过原操作回执/变更日志证明幂等。仅计 `/__sync` 转发请求，不统计 config/stats/Vite资源。监听流只累加实际 chunk.length，不保存请求 body 或 Authorization，不把 token/keyring/应用正文写日志。

为避免将请求流提前读成 flowing 而丢失数据，计数最好在真正转发链中通过 Transform 同时计数并 pipe；不能先 await 读完整 body 再代理，也不能异步建立代理前随意添加 data 监听消耗流。

故障注入优先由浏览器端 fetchImpl 进行：commit 请求先 await 真实 fetch 并读完响应，再合成抛出网络错误，可确定服务已经提交；对象失败和 offline 同理。首批不需要公开 /__qa/fault 路由。

### 生命周期

所有启动步骤置于统一 try/finally，部分启动失败也关闭已经打开的资源。SIGINT/SIGTERM 使用幂等关闭函数：先停止两个入口/Vite，再关闭真实服务并等待请求结束，最后 store.close 和删除本次 mkdtemp 目录。不得删除固定 data 路径或原服务仓内容。随机 origin 仍可能留有浏览器 IndexedDB，本次 runId 与真实浏览器清理步骤需由主测试控制。

## Files Found / Code Patterns

- `scripts/test-application-storage-browser.mjs`：既有真实 IndexedDB 行为与保存/失败回归；本次不复用其固定 origin 操作真实用户库。
- `vite.config.ts`：正常应用开发配置，包含通用代理/PWA/固定 host，QA 应显式隔离配置。
- `/Users/xiaomengdao/WebstormProjects/tulai-sync/apps/server/store.mjs:80`：`openStore({filename,now})`，显式临时库入口。
- `/Users/xiaomengdao/WebstormProjects/tulai-sync/apps/server/http.mjs:72`：`createSyncServer({store,devices})`，返回 Node HTTP server，不自行读取凭据文件。
- `node_modules/vite/dist/node/chunks/config.js:25903`：安装版 startServer 的 port fallback；需由 Node listen(0) 实现随机端口。
- `package.json`：固定 tarball SDK，Vite 安装版实际为7.3.7；不增加测试服务运行时依赖。

## External References

Context7 查询 `/vitejs/vite` 后核对官方 API 语义；版本特定 port=0 行为以本机7.3.7源码和探针为证据，不拿 main 文档冒称固定版本实现。

- [Vite JavaScript API](https://vite.dev/guide/api-javascript)：createServer、middlewareMode 与中间件。
- [Vite server options](https://vite.dev/config/server-options)：proxy rewrite、host、strictPort。
- [Vite plugin API configureServer](https://vite.dev/guide/api-plugin#configureserver)：配置前置 middleware 的生命周期。

## Related Specs

- `.trellis/tasks/10-28-application-incremental-sync/prd.md` / `design.md`：两个隔离 origin、真实数据库与真实 HTTP、合成数据、统计增量请求/字节。
- `.trellis/spec/frontend/quality-guidelines.md`：真实浏览器证据、精确工具链、不虚构检查通过。
- `AGENTS.md`：源码所有权、产品数据不清空、仅授权本轮内容。

## Caveats / Not Found

启动器由主代理实现，本研究未编辑 `scripts/serve-application-sync-qa.mjs`。端口探针只能证明本机 Vite 行为，完整代理计数、清理和双 origin IndexedDB 仍需启动器及浏览器实际验收。
