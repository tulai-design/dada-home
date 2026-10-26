import assert from 'node:assert/strict'
import {EventEmitter, once} from 'node:events'
import {Readable} from 'node:stream'
import {gzipSync} from 'node:zlib'
import test from 'node:test'
import {createProxyServer, fetchTarget, publicAddress, safeLookup, targetUrl} from './proxy.mjs'

function upstream(replies) {
  const calls = []
  const transport = (target, options, receive) => {
    const request = new EventEmitter()
    const snapshot = {url: target.href, ...options, headers: {...options.headers}}
    calls.push(snapshot)
    request.end = () => queueMicrotask(() => {
      const reply = typeof replies === 'function' ? replies(snapshot) : replies[calls.length - 1]
      if (reply?.hang) {
        // A real socket keeps the process alive while an AbortSignal times out.
        const timer = setTimeout(() => {}, 1000)
        const abort = () => {
          clearTimeout(timer)
          request.emit('error', options.signal.reason)
        }
        if (options.signal.aborted) abort()
        else options.signal.addEventListener('abort', abort, {once: true})
        return
      }
      const response = Readable.from((reply.chunks || [reply.body ?? '']).map((chunk) => Buffer.from(chunk)))
      response.statusCode = reply.status ?? 200
      response.headers = reply.headers ?? {'content-type': 'application/json'}
      receive(response)
    })
    return request
  }
  return {calls, requests: {http: transport, https: transport}}
}

test('rejects non-public IPv4 / IPv6, including encoded IPv4 and expanded IPv6 forms', () => {
  for (const address of [
    '127.0.0.1', '10.1.2.3', '172.31.0.1', '192.168.1.1', '169.254.169.254',
    '100.100.100.200', '0.0.0.0', '224.0.0.1', '198.18.0.1', '192.0.2.1',
    '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', 'ff02::1',
    '2001:0000:1::1', '2001:0002:1::1', '2001:0db8::1', '2002:7f00:1::1', '3fff::1',
  ]) assert.equal(publicAddress(address), false, address)
  for (const address of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '2606:4700:4700::1111']) {
    assert.equal(publicAddress(address), true, address)
  }
  for (const url of [
    'http://127.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://[::1]/',
    'http://localhost/', 'http://name.internal/', 'https://user:secret@example.com/',
    'file:///etc/passwd', 'https://example.com:3000/',
  ]) assert.throws(() => targetUrl(url), {name: 'Error'}, url)
})

test('optional domain allowlist includes subdomains but never permits private targets', () => {
  assert.equal(targetUrl('https://feeds.example.com/rss#fragment', ['example.com']).href, 'https://feeds.example.com/rss')
  assert.throws(() => targetUrl('https://notexample.com/rss', ['example.com']), {status: 403})
  assert.throws(() => targetUrl('http://127.0.0.1/', ['127.0.0.1']), {status: 403})
})

test('checks all DNS answers in the actual connection lookup and rejects mixed public/private answers', async () => {
  const answers = [{address: '93.184.216.34', family: 4}, {address: '10.0.0.1', family: 4}]
  const lookup = safeLookup(async (hostname, options) => {
    assert.equal(hostname, 'feeds.example.com')
    assert.deepEqual(options, {all: true, order: 'ipv4first'})
    return answers
  })
  await assert.rejects(new Promise((resolve, reject) => lookup('feeds.example.com', {}, (error, address) => {
    if (error) reject(error)
    else resolve(address)
  })), {status: 403})
  const safe = safeLookup(async () => answers.slice(0, 1))
  assert.equal(await new Promise((resolve, reject) => safe('feeds.example.com', {}, (error, address, family) => {
    if (error) reject(error)
    else resolve(`${address}/${family}`)
  })), '93.184.216.34/4')
  assert.deepEqual(await new Promise((resolve, reject) => safe('feeds.example.com', {all: true}, (error, addresses) => {
    if (error) reject(error)
    else resolve(addresses)
  })), answers.slice(0, 1))
  // Exercise node:http's connection path too, before any local socket can be opened.
  await assert.rejects(fetchTarget('http://feeds.example.com/rss', {}, {lookup}), {status: 403})
})

test('preserves RSS / JSON bodies and upstream error status; sends only necessary headers', async () => {
  const xml = '<?xml version="1.0"?><rss><channel><title>搭搭</title></channel></rss>'
  const mock = upstream([
    {body: xml, headers: {'content-type': 'application/rss+xml; charset=utf-8', 'set-cookie': 'secret=1'}},
    {status: 429, body: '{"error":"rate limited"}', headers: {'content-type': 'application/json'}},
  ])
  const lookup = safeLookup()
  const rss = await fetchTarget('https://feeds.example.com/rss', {
    accept: 'application/xml', authorization: 'Bearer explicit-token', cookie: 'session=secret',
    'if-none-match': 'old-etag', 'if-modified-since': 'yesterday', host: 'homepage.example.com',
  }, {...mock, lookup})
  assert.equal(rss.body.toString(), xml)
  assert.equal(rss.contentType, 'application/rss+xml; charset=utf-8')
  assert.equal(rss.status, 200)
  assert.deepEqual(mock.calls[0].headers, {
    accept: 'application/xml', 'accept-encoding': 'identity', 'user-agent': 'Dada-Data-Proxy/1.0',
    authorization: 'Bearer explicit-token',
  })
  assert.equal(mock.calls[0].lookup, lookup)
  assert.equal(mock.calls[0].agent, false)
  const json = await fetchTarget('https://api.example.com/hot', {}, mock)
  assert.equal(json.status, 429)
  assert.equal(json.contentType, 'application/json')
  assert.equal(json.body.toString(), '{"error":"rate limited"}')
})

test('checks each redirect and removes Authorization when origin changes', async () => {
  const mock = upstream([
    {status: 302, headers: {location: '/canonical'}},
    {status: 307, headers: {location: 'https://other.example.com/feed'}},
    {body: '<rss/>', headers: {'content-type': 'text/xml'}},
  ])
  await fetchTarget('https://feeds.example.com/rss', {authorization: 'Bearer explicit-token'}, mock)
  assert.equal(mock.calls[1].headers.authorization, 'Bearer explicit-token')
  assert.equal(mock.calls[2].headers.authorization, undefined)
  const blocked = upstream([{status: 302, headers: {location: 'http://169.254.169.254/latest/meta-data/'}}])
  await assert.rejects(fetchTarget('https://feeds.example.com/rss', {}, blocked), {status: 403})
  assert.equal(blocked.calls.length, 1)
  const loop = upstream(() => ({status: 302, headers: {location: '/again'}}))
  await assert.rejects(fetchTarget('https://feeds.example.com/rss', {}, loop), {status: 502})
  assert.equal(loop.calls.length, 5)
})

test('enforces a total timeout, declared / streaming body limit, and rejects empty 304 responses', async () => {
  await assert.rejects(fetchTarget('https://feeds.example.com/rss', {}, {
    ...upstream([{hang: true}]), timeoutMs: 15,
  }), {status: 504})
  await assert.rejects(fetchTarget('https://feeds.example.com/rss', {}, {
    ...upstream([{headers: {'content-length': '100'}, body: 'large'}]), maxBytes: 4,
  }), {status: 413})
  await assert.rejects(fetchTarget('https://feeds.example.com/rss', {}, {
    ...upstream([{chunks: ['123', '456']}]), maxBytes: 4,
  }), {status: 413})
  await assert.rejects(fetchTarget('https://feeds.example.com/rss', {}, upstream([{status: 304}])), {status: 502})
})

test('HTTP endpoints return JSON errors, safe response headers and raw upstream data without SPA fallback', async (context) => {
  const mock = upstream(() => ({body: '<rss><channel/></rss>', headers: {'content-type': 'text/xml', 'set-cookie': 'secret=1'}}))
  const server = createProxyServer(mock)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  context.after(() => new Promise((resolve) => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  for (const [path, options, expected] of [
    ['/__proxy', {}, 400],
    ['/__proxy?url=http://127.0.0.1/', {}, 403],
    ['/__proxy?url=https://feeds.example.com/rss', {method: 'POST'}, 405],
    ['/__proxy?url=https://feeds.example.com/rss', {headers: {origin: 'https://evil.example.com'}}, 403],
    ['/__proxy?url=https://feeds.example.com/rss', {headers: {'sec-fetch-site': 'cross-site'}}, 403],
    ['/__proxy/missing', {}, 404],
  ]) {
    const response = await fetch(`${base}${path}`, options)
    assert.equal(response.status, expected, path)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.match(response.headers.get('content-type'), /application\/json/)
    assert.equal(typeof (await response.json()).error, 'string')
  }
  const response = await fetch(`${base}/__proxy?url=https://feeds.example.com/rss`, {headers: {
    cookie: 'session=secret', authorization: 'Bearer explicit-token', 'if-none-match': 'old-etag',
  }})
  assert.equal(response.status, 200)
  assert.equal(await response.text(), '<rss><channel/></rss>')
  assert.equal(response.headers.get('content-type'), 'text/xml')
  assert.equal(response.headers.get('set-cookie'), null)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('content-security-policy'), "sandbox; default-src 'none'")
  assert.equal(mock.calls[0].headers.authorization, 'Bearer explicit-token')
  assert.equal(mock.calls[0].headers.cookie, undefined)
  assert.equal(mock.calls[0].headers['if-none-match'], undefined)
  assert.equal((await fetch(`${base}/healthz`)).status, 200)
})

test('retains content encoding when an upstream ignores Accept-Encoding: identity', async (context) => {
  const body = '<rss><channel><title>encoded feed</title></channel></rss>'
  const mock = upstream(() => ({chunks: [gzipSync(body)], headers: {'content-type': 'application/xml', 'content-encoding': 'gzip'}}))
  const server = createProxyServer(mock)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  context.after(() => new Promise((resolve) => server.close(resolve)))
  const response = await fetch(`http://127.0.0.1:${server.address().port}/__proxy?url=https://feeds.example.com/rss`)
  assert.equal(response.headers.get('content-encoding'), 'gzip')
  assert.equal(await response.text(), body)
})
