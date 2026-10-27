# 取数服务规范

搭搭没有独立业务数据库后端。本层范围是 Node 取数代理、开发接入和静态部署。先读 [取数代理](data-proxy.md)；协议与 AI 核心包修改归 [AI 规范](../ai/tools-and-apps.md)。

质量入口为 [server/proxy.test.mjs](../../../server/proxy.test.mjs)，集成变更同时核对 Vite、Docker/nginx 和 PWA 的路径行为。
