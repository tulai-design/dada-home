/**
 * 第一页 · 取数转发 Worker
 *
 * 纯前端页面直接抓 RSS / Beszel / Coolify 会被浏览器的跨域策略拦住。
 * 把这份文件部署成 Cloudflare Worker（或任何支持 fetch 的运行时），
 * 然后在「设置 → 取数代理」里填：https://<你的域名>/?url={url}
 *
 * 安全约定：
 * - 只转发 http(s) 目标；
 * - 丢掉浏览器带来的 cookie，只透传 authorization / content-type；
 * - 可选地限制允许访问的主机（ALLOW_HOSTS）。
 *
 * 部署：wrangler deploy worker/proxy.ts --name first-page-proxy
 */

const ALLOW_HOSTS: string[] = [
  // 例如 'feeds.example.com', 'beszel.example.com'
]

const FORWARD_HEADERS = ['authorization', 'content-type', 'accept']

export default {
  async fetch(request: Request): Promise<Response> {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-max-age': '86400',
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    const target = new URL(request.url).searchParams.get('url')
    if (!target) return new Response('missing url', { status: 400, headers: cors })

    let parsed: URL
    try {
      parsed = new URL(target)
    } catch {
      return new Response('bad url', { status: 400, headers: cors })
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return new Response('only http(s)', { status: 400, headers: cors })
    }
    if (ALLOW_HOSTS.length && !ALLOW_HOSTS.some((h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`))) {
      return new Response('host not allowed', { status: 403, headers: cors })
    }

    const headers = new Headers({
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36',
      accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json;q=0.9, */*;q=0.8',
    })
    for (const name of FORWARD_HEADERS) {
      const value = request.headers.get(name)
      if (value) headers.set(name, value)
    }

    const init: RequestInit = { method: request.method, headers, redirect: 'follow' }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = await request.arrayBuffer()
    }

    try {
      const upstream = await fetch(parsed, init)
      const out = new Headers(cors)
      out.set('content-type', upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8')
      out.set('cache-control', 'no-store')
      return new Response(upstream.body, { status: upstream.status, headers: out })
    } catch (err) {
      return new Response(err instanceof Error ? err.message : 'upstream failed', { status: 502, headers: cors })
    }
  },
}
