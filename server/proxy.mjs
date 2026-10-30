import {createServer, request as requestHttp} from 'node:http'
import {request as requestHttps} from 'node:https'
import {lookup as dnsLookup} from 'node:dns/promises'
import {isIP} from 'node:net'

export const PROXY_PORT = 8787
const REDIRECTS = new Set([301, 302, 303, 307, 308])

export class ProxyError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/** Public unicast addresses only, including DNS results and every redirect target. */
export function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number)
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    )
  }
  if (isIP(address) !== 6) return false
  // Exclude IPv4-mapped, local, multicast, documentation and transition ranges.
  const lower = new URL(`http://[${address}]/`).hostname.slice(1, -1)
  const [first, second] = lower.split(':').map((part) => Number.parseInt(part || '0', 16))
  return first >= 0x2000 && first <= 0x3fff &&
    !(first === 0x2001 && (second <= 0x01ff || second === 0x0db8)) &&
    first !== 0x2002 && first !== 0x3ffe && first !== 0x3fff
}

const normalizedHost = (hostname) => hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')

export function targetUrl(raw, allowedHosts = []) {
  let target
  try {
    target = new URL(raw)
  } catch {
    throw new ProxyError(400, '目标地址不是有效网址。')
  }
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
    throw new ProxyError(400, '只支持不含用户名和密码的 HTTP / HTTPS 地址。')
  }
  if (target.port && target.port !== '80' && target.port !== '443') {
    throw new ProxyError(403, '取数代理只允许访问 HTTP / HTTPS 标准端口。')
  }
  const host = normalizedHost(target.hostname)
  if (!host || !host.includes('.') && !isIP(host) ||
    /(?:^|\.)(?:localhost|local|internal|home|lan)$/.test(host) ||
    isIP(host) && !publicAddress(host)) {
    throw new ProxyError(403, '取数代理不允许访问本机或私有网络。')
  }
  if (allowedHosts.length && !allowedHosts.some((item) => host === item || host.endsWith(`.${item}`))) {
    throw new ProxyError(403, '这个域名未在站点取数代理的允许列表中。')
  }
  target.hash = ''
  return target
}

/** Validate the actual connection lookup, rather than validating then resolving again. */
export function safeLookup(resolve = dnsLookup) {
  return (hostname, options, callback) => {
    resolve(hostname, {all: true, order: 'ipv4first'}).then((addresses) => {
      if (!addresses.length || addresses.some(({address}) => !publicAddress(address))) {
        callback(new ProxyError(403, '目标域名解析到了本机或私有网络。'))
        return
      }
      if (options.all) callback(null, addresses)
      else callback(null, addresses[0].address, addresses[0].family)
    }, callback)
  }
}

function oneRequest(target, headers, signal, maxBytes, lookup, requests) {
  return new Promise((resolve, reject) => {
    const transport = target.protocol === 'https:' ? requests.https : requests.http
    const request = transport(target, {
      method: 'GET', headers, signal, lookup, agent: false, autoSelectFamily: false,
    }, (response) => {
      const status = response.statusCode ?? 502
      if (REDIRECTS.has(status) && response.headers.location) {
        response.destroy()
        resolve({status, location: response.headers.location})
        return
      }
      if (Number(response.headers['content-length']) > maxBytes) {
        response.destroy()
        reject(new ProxyError(413, '取数结果过大，超过代理允许的大小。'))
        return
      }
      let size = 0
      const chunks = []
      response.on('data', (chunk) => {
        size += chunk.length
        if (size > maxBytes) {
          response.destroy(new ProxyError(413, '取数结果过大，超过代理允许的大小。'))
        } else chunks.push(chunk)
      })
      response.on('error', reject)
      response.on('end', () => resolve({
        status, contentType: response.headers['content-type'], contentEncoding: response.headers['content-encoding'],
        body: Buffer.concat(chunks),
      }))
    })
    request.on('error', reject)
    request.end()
  })
}

export async function fetchTarget(raw, incomingHeaders = {}, {
  allowedHosts = [], timeoutMs = 15_000, maxBytes = 5 * 1024 * 1024,
  lookup = safeLookup(), requests = {http: requestHttp, https: requestHttps},
  signal: callerSignal,
} = {}) {
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = callerSignal ? AbortSignal.any([timeout, callerSignal]) : timeout
  let target = targetUrl(raw, allowedHosts)
  const headers = {
    accept: incomingHeaders.accept || '*/*',
    'accept-encoding': 'identity',
    'user-agent': 'Dada-Data-Proxy/1.0',
  }
  // Explicit credentials supplied by the application are allowed; browser cookies never are.
  if (incomingHeaders.authorization) headers.authorization = incomingHeaders.authorization
  try {
    for (let redirects = 0; redirects <= 4; redirects += 1) {
      signal.throwIfAborted()
      const response = await oneRequest(target, headers, signal, maxBytes, lookup, requests)
      if (response.location) {
        const next = targetUrl(new URL(response.location, target).href, allowedHosts)
        if (next.origin !== target.origin) delete headers.authorization
        target = next
        continue
      }
      if (response.status === 304) throw new ProxyError(502, '上游返回了无法使用的缓存响应，请稍后重试。')
      return response
    }
    throw new ProxyError(502, '上游重定向次数过多。')
  } catch (error) {
    if (error instanceof ProxyError) throw error
    if (timeout.aborted) throw new ProxyError(504, '取数超时，请稍后重试或检查源站。')
    if (callerSignal?.aborted) throw new ProxyError(499, '请求已取消。')
    throw new ProxyError(502, '无法连接数据源，请检查地址或稍后重试。')
  }
}

export function createProxyHandler({allowedHosts = (process.env.PROXY_ALLOWED_HOSTS ?? '').split(',').map(normalizedHost).filter(Boolean), ...options} = {}) {
  let active = 0
  return async (request, response) => {
    response.setHeader('cache-control', 'no-store')
    response.setHeader('x-content-type-options', 'nosniff')
    // Direct navigation to proxied HTML must never execute with the homepage's origin.
    response.setHeader('content-security-policy', "sandbox; default-src 'none'")
    const fail = (status, message) => {
      if (response.destroyed || response.writableEnded) return
      response.writeHead(status, {'content-type': 'application/json; charset=utf-8'})
      response.end(JSON.stringify({error: message}))
    }
    let route
    try {
      route = new URL(request.url ?? '/', 'http://proxy.local')
    } catch {
      return fail(400, '请求地址无效。')
    }
    if (route.pathname === '/healthz' && request.method === 'GET') {
      response.writeHead(200, {'content-type': 'text/plain; charset=utf-8'})
      response.end('ok\n')
      return
    }
    if (route.pathname !== '/__proxy') return fail(404, '没有这个接口。')
    if (request.method !== 'GET') {
      response.setHeader('allow', 'GET')
      return fail(405, '站点取数代理仅支持 GET；同步写入请配置独立代理。')
    }
    if (request.headers['sec-fetch-site'] === 'cross-site') return fail(403, '仅允许本站发起取数。')
    if (request.headers.origin) {
      try {
        if (new URL(request.headers.origin).host !== request.headers.host) return fail(403, '仅允许本站发起取数。')
      } catch {
        return fail(403, '请求来源无效。')
      }
    }
    const raw = route.searchParams.get('url')
    if (!raw) return fail(400, '缺少目标地址 url。')
    if (raw.length > 8192) return fail(414, '目标地址过长。')
    if (active >= 24) return fail(503, '取数请求较多，请稍后重试。')
    const controller = new AbortController()
    response.on('close', () => controller.abort())
    active += 1
    try {
      const result = await fetchTarget(raw, request.headers, {...options, allowedHosts, signal: controller.signal})
      if (!response.destroyed) {
        const headers = {'content-type': result.contentType || 'application/octet-stream'}
        // Some sources ignore Accept-Encoding: identity; browsers still need the encoding to decode them.
        if (result.contentEncoding) headers['content-encoding'] = result.contentEncoding
        response.writeHead(result.status, headers)
        response.end(result.body)
      }
    } catch (error) {
      fail(error.status || 502, error.message)
    } finally {
      active -= 1
    }
  }
}

export function createProxyServer(options = {}) {
  return createServer({headersTimeout: 10_000, requestTimeout: 20_000}, createProxyHandler(options))
}
