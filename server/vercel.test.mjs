import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {once} from 'node:events'
import {readFile} from 'node:fs/promises'
import test from 'node:test'
import proxy from '../api/proxy.mjs'
import health from '../api/health.mjs'

async function serving(handler, run) {
  const server = createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {await run(`http://127.0.0.1:${server.address().port}`)} finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}

test('Vercel adapter serves JSON failures at both rewritten and direct API URLs', async () => {
  await serving(proxy, async base => {
    for (const pathname of ['/__proxy', '/api/proxy']) {
      const missing = await fetch(base + pathname)
      assert.equal(missing.status, 400)
      assert.match((await missing.json()).error, /缺少目标/)
      assert.equal(missing.headers.get('cache-control'), 'no-store')
      assert.match(missing.headers.get('content-security-policy'), /sandbox/)
      const privateTarget = await fetch(base + pathname + '?url=http%3A%2F%2F127.0.0.1%2F')
      assert.equal(privateTarget.status, 403)
      assert.match((await privateTarget.json()).error, /私有网络/)
    }
  })
})

test('Vercel adapter rejects writes and cross-site requests before target fetch', async () => {
  await serving(proxy, async base => {
    const write = await fetch(base + '/__proxy?url=https://example.com', {method: 'POST', body: 'do-not-forward'})
    assert.equal(write.status, 405)
    assert.equal(write.headers.get('allow'), 'GET')
    assert.match((await write.json()).error, /独立代理/)
    const crossSite = await fetch(base + '/__proxy?url=https://example.com', {headers: {'sec-fetch-site': 'cross-site'}})
    assert.equal(crossSite.status, 403)
    const origin = await fetch(base + '/api/proxy?url=https://example.com', {headers: {origin: 'https://other.example'}})
    assert.equal(origin.status, 403)
  })
})

test('Vercel health function invokes the same proxy handler without opening a persistent server', async () => {
  await serving(health, async base => {
    const result = await fetch(base + '/healthz')
    assert.equal(result.status, 200)
    assert.equal(await result.text(), 'ok\n')
    assert.equal(result.headers.get('cache-control'), 'no-store')
  })
})

test('Vercel routing reserves proxy, health, API and asset failures ahead of SPA fallback', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'))
  const route = pathname => {
    for (const entry of config.routes) {
      if (entry.handle) continue // 文件命中由平台 filesystem 处理，本测试只核对缺失路径。
      if (new RegExp(`^(?:${entry.src})$`).test(pathname)) return entry.dest ?? entry.status
    }
  }
  assert.equal(route('/__proxy'), '/api/proxy')
  assert.equal(route('/__proxy/'), '/api/proxy')
  assert.equal(route('/healthz'), '/api/health')
  assert.equal(route('/api/missing'), 404)
  assert.equal(route('/assets/missing.js'), 404)
  assert.equal(route('/brand/missing'), 404)
  assert.equal(route('/dada-extension.zip'), 404, '不存在的下载文件不能变成 HTML')
  assert.equal(route('/some-page'), '/index.html')
  assert.ok(config.routes.findIndex(entry => entry.handle === 'filesystem') < config.routes.findIndex(entry => entry.status === 404))
})
