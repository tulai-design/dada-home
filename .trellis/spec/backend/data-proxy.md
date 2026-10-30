# 取数代理与部署边界

默认代理配置在 [defaults.ts](../../../src/lib/defaults.ts)，形如 `/__proxy?url={url}`。[vite.config.ts](../../../vite.config.ts) 提供开发接入；生产由 [server/proxy.mjs](../../../server/proxy.mjs) 与 [server/start.mjs](../../../server/start.mjs) 启动的 Node/nginx 组合处理。Vercel 的 [api/proxy.mjs](../../../api/proxy.mjs) 复用同一 `createProxyHandler`，根 [vercel.json](../../../vercel.json) 将 `/__proxy` 与 `/healthz` 指向函数；它不启动常驻 Node Server。独立 [worker/proxy.ts](../../../worker/proxy.ts) 是另一部署入口，不能只修改一处后宣称所有部署形态都已修复。

修改 Node 代理时保留以下合同：

- 仅接受 HTTP/HTTPS 标准端口和不含用户信息的目标 URL；校验域名、实际连接 DNS 结果及每个重定向目标，拒绝本机/私有网络。
- 仅 GET 取数，写同步有独立路径。Cookie 不随请求透传；显式 Authorization 跨源重定向时移除。
- 有超时、响应体积和重定向次数边界，异常返回中文可解释错误；取消与超时保持区分。
- 上游 304 没有可用正文时不能当取数成功，现有行为返回代理错误。
- 响应使用 `no-store` 和 sandbox CSP，避免直接访问代理 HTML 获得宿主同源执行能力。

不要通过关闭这些校验来解决某个订阅源报错。使用 [proxy.test.mjs](../../../server/proxy.test.mjs) 注入网络依赖验证失败/重定向等行为，避免测试依赖真实外网。

代理与健康检查路径不得落入 SPA HTML 或 PWA 页面缓存。相关规则位于 [vite.config.ts](../../../vite.config.ts)、[docker/nginx.conf](../../../docker/nginx.conf)；部署变更也要核对 [Dockerfile](../../../Dockerfile)。

Vercel 函数保持默认来源/方法校验，正文上限为4 MiB（常驻服务5 MiB），为平台响应限制留余量。路由先保留API/健康检查，再查文件；缺失API和静态资源不能回退首页。`server/vercel.test.mjs` 覆盖实际Node请求适配，部署后的平台路由与额度仍需实际检查。构建扩展ZIP通过 `scripts/zip-directory.mjs` 使用Node/zlib生成，不依赖构建机器的zip二进制。
