import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** 转发这些请求头；其余一律丢弃，避免把浏览器的 cookie 带到目标站。 */
const FORWARD_HEADERS = ['authorization', 'content-type', 'accept']

/**
 * 开发期 CORS 代理：/__proxy?url=<encoded>
 * 纯前端页面直接请求 RSS / 监控接口会被浏览器拦住，开发时由这里转一手。
 * 生产构建后请把设置里的「取数代理」指向你自己的转发服务。
 */
function devProxy(): Plugin {
  return {
    name: 'first-page-dev-proxy',
    configureServer(server) {
      server.middlewares.use('/__proxy', async (req: IncomingMessage, res: ServerResponse) => {
        const raw = req.url ?? ''
        const target = new URL(raw, 'http://localhost').searchParams.get('url')
        res.setHeader('access-control-allow-origin', '*')
        res.setHeader('access-control-allow-headers', '*')
        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.end()
          return
        }
        if (!target) {
          res.statusCode = 400
          res.end('missing url')
          return
        }
        let parsed: URL
        try {
          parsed = new URL(target)
        } catch {
          res.statusCode = 400
          res.end('bad url')
          return
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          res.statusCode = 400
          res.end('only http(s)')
          return
        }

        const headers: Record<string, string> = {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36',
          accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json;q=0.9, */*;q=0.8',
        }
        for (const name of FORWARD_HEADERS) {
          const value = req.headers[name]
          if (typeof value === 'string' && value) headers[name] = value
        }

        let body: BodyInit | undefined
        if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          body = Buffer.concat(chunks) as unknown as BodyInit
        }

        try {
          const upstream = await fetch(parsed, {
            method: req.method ?? 'GET',
            headers,
            body,
            redirect: 'follow',
            signal: AbortSignal.timeout(15000),
          })
          const payload = Buffer.from(await upstream.arrayBuffer())
          res.statusCode = upstream.status
          const type = upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8'
          res.setHeader('content-type', type)
          if (type.includes('application/json')) res.setHeader('cache-control', 'no-store')
          res.end(payload)
        } catch (err) {
          res.statusCode = 502
          res.end(err instanceof Error ? err.message : 'upstream failed')
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), devProxy()],
  server: { port: 5173, host: true },
})
