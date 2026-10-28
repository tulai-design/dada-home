import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdir, writeFile} from 'node:fs/promises'

const require = createRequire(import.meta.url)
const {chromium} = require(process.env.DADA_PLAYWRIGHT_PATH || 'playwright')
const base = (process.env.DADA_QA_URL || 'http://127.0.0.1:5175').replace(/\/$/, '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), '同步浏览器测试只允许本机隔离服务')
const output = process.env.DADA_SYNC_QA_OUTPUT || '/tmp/dada-sync-browser'
const filter = process.env.DADA_SYNC_QA_FILTER
const FILE = 'dada-sync-v2.json'
const browser = await chromium.launch({headless: true})
const results = []
await mkdir(output, {recursive: true})

// Shared only by new browser contexts in this process. Every remote request is
// fulfilled here; neither credentials nor public network traffic are used.
function remote({etag = true, text = null} = {}) {
  return {etag, text, revision: 0, requests: [], writes: [], failRead: null, async handle(route) {
    const request = route.request(), url = new URL(request.url()), method = request.method()
    const headers = {'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,PUT,POST,PATCH,OPTIONS', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'etag,retry-after,x-ratelimit-reset'}
    const respond = (status, body = '', extra = {}) => route.fulfill({status, body, headers: {...headers, ...extra}})
    if (method === 'OPTIONS') return respond(204)
    this.requests.push({method, url: url.href, body: request.postData(), headers: request.headers()})
    const gist = url.hostname === 'api.github.com'
    if (method === 'GET') {
      if (this.beforeRead) await this.beforeRead()
      if (this.failRead) {const error = this.failRead; this.failRead = null; return respond(error.status, error.body, error.headers)}
      if (this.text === null) return gist ? respond(200, JSON.stringify({id: 'isolated-gist', files: {}}), {'content-type': 'application/json'}) : respond(404)
      const body = gist ? JSON.stringify({id: 'isolated-gist', files: {[FILE]: {content: this.text, truncated: false}}}) : this.text
      return respond(200, body, {'content-type': 'application/json', ...(this.etag ? {etag: `"r${this.revision}"`} : {})})
    }
    if (!['PUT', 'POST', 'PATCH'].includes(method)) return respond(405)
    if (this.beforeWrite) await this.beforeWrite()
    if (this.etag && !gist) {
      if (request.headers()['if-none-match'] === '*' && this.text !== null) return respond(412)
      if (request.headers()['if-match'] && request.headers()['if-match'] !== `"r${this.revision}"`) return respond(412)
    }
    this.text = gist ? JSON.parse(request.postData()).files[FILE].content : request.postData()
    this.revision += 1
    this.writes.push(this.text)
    return gist ? respond(200, JSON.stringify({id: 'isolated-gist'}), {'content-type': 'application/json'}) : respond(204, '', this.etag ? {etag: `"r${this.revision}"`} : {})
  }}
}
async function fresh(server = remote()) {
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'})
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (['sync.example.test', 'api.github.com'].includes(url.hostname)) return server.handle(route)
    return url.origin === base && !url.pathname.startsWith('/__proxy') ? route.continue() : route.abort()
  })
  const page = await context.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${base}/tests/sync-regressions.html`, {waitUntil: 'domcontentloaded'})
  await page.waitForFunction(() => window.syncQA, {timeout: 120_000})
  await page.getByRole('button', {name: '测试连接', exact: true}).waitFor()
  return {page, context, errors}
}
async function configure(page, backend = 'http', patch = {}) {
  await page.evaluate(({backend, patch}) => {
    const {sync} = window.syncQA
    sync.writeSyncConfig({...sync.defaultSyncConfig(), auto: false, backend,
      http: {url: 'https://sync.example.test/full.json', token: 'isolated-test-token', proxy: ''},
      webdav: {url: 'https://sync.example.test/dada/', user: 'isolated-test-user', pass: 'isolated-test-pass', proxy: ''},
      gist: {token: 'isolated-test-token', id: 'isolated-gist'}, ...patch})
  }, {backend, patch})
}
async function seed(page, tag) {
  await page.evaluate(async tag => {
    const {workspace, ops, store, components, database: {db}} = window.syncQA
    const home = ops.defaultWorkspace()
    home.pages[0].name = `${tag}-页面设计`
    workspace.commit(home)
    store.writeStored('settings', {name: `${tag}-称呼`, theme: 'light', ai: {model: 'isolated-model', apiKey: `${tag}-已知密钥`, baseUrl: `https://${tag}.device.invalid`}, proxy: `${tag}-本机代理`, monitor: []})
    store.writeStored('persona', {soul: {name: '搭搭', text: `${tag}-当前性格`, aiCanEdit: true, history: [{at: 1, by: 'user', text: `${tag}-性格历史`}]}, profile: {role: `${tag}-私人画像`, interests: '', preferences: '', notes: ''}, memory: {enabled: true, items: [{id: `${tag}-memory`, text: `${tag}-累积记忆`, kind: 'fact', by: 'user', at: 1}]}})
    store.writeStored(`applet.${tag}`, {value: `${tag}-应用业务状态`})
    store.writeStored('page', `${tag}-本机当前页面`)
    components.writeData(`${tag}-component`, {text: `${tag}-组件业务数据`})
    await components.flush()
    await db.batch([
      {store: 'convs', type: 'put', value: {id: `${tag}-conversation`, title: `${tag}-聊天标题`, createdAt: 1, updatedAt: 2}},
      {store: 'turns', type: 'put', value: {id: `${tag}-turn`, convId: `${tag}-conversation`, prompt: `${tag}-聊天提问`, answer: `${tag}-聊天答案`, reasoning: '', tools: [], error: '', startedAt: 1, endedAt: 2}},
      {store: 'turns', type: 'put', value: {id: `${tag}-active`, convId: `${tag}-conversation`, prompt: `${tag}-正在生成提问`, answer: `${tag}-正在生成答案`, reasoning: '', tools: [], error: '', startedAt: 3}},
    ])
  }, tag)
}
async function sync(page, options) {return page.evaluate(options => window.syncQA.sync.syncNow(options), options)}
async function snapshot(page) {
  return page.evaluate(async () => ({local: Object.fromEntries(Object.entries(localStorage)), data: await window.syncQA.database.db.snapshot()}))
}
async function check(name, work) {
  if (filter && !name.includes(filter)) return
  const started = Date.now()
  try {await work(); results.push({name, status: 'passed', ms: Date.now() - started}); console.log(`通过：${name}`)}
  catch (error) {results.push({name, status: 'failed', error: error.stack || String(error), ms: Date.now() - started}); console.error(`失败：${name}\n${error.stack}`)}
}

try {
  for (const backend of ['http', 'webdav']) await check(`${backend}：两个隔离设备传输配置和完整业务，拉取后只读直到刷新`, async () => {
    const server = remote(), a = await fresh(server), b = await fresh(server)
    try {
      await configure(a.page, backend); await configure(b.page, backend)
      await seed(a.page, 'device-a'); await seed(b.page, 'device-b')
      const sent = await sync(a.page), received = await sync(b.page)
      assert.equal(sent.protection, 'conditional'); assert.equal(received.needsReload, true)
      assert.ok(sent.uploadedBytes > 0); assert.ok(received.downloadedBytes > 0)
      assert.ok(server.requests.some(request => request.headers['if-none-match'] === '*'))
      assert.ok(server.requests.some(request => request.headers['if-match'] === '"r1"'))
      const wire = JSON.parse(server.text)
      assert.equal(wire.version, 2); assert.equal(wire.scope, 'full')
      for (const marker of ['device-a-组件业务数据', 'device-a-应用业务状态', 'device-a-聊天答案', 'device-a-私人画像', 'device-a-累积记忆']) assert.ok(server.text.includes(marker), marker)
      for (const marker of ['device-a-正在生成答案', 'device-a-已知密钥', 'device-a-本机代理', 'device-a.device.invalid', 'device-a-本机当前页面']) assert.ok(!server.text.includes(marker), marker)
      const pulled = await snapshot(b.page)
      assert.ok(pulled.data.kv.some(row => row.k === 'device-a-component' && row.v.text === 'device-a-组件业务数据'))
      assert.ok(pulled.data.kv.some(row => row.k === 'device-b-component'))
      assert.ok(pulled.data.turns.some(turn => turn.id === 'device-a-turn' && turn.answer === 'device-a-聊天答案'))
      const settings = JSON.parse(pulled.local['fp.settings'])
      assert.equal(settings.name, 'device-a-称呼'); assert.equal(settings.ai.apiKey, 'device-b-已知密钥'); assert.equal(settings.ai.baseUrl, 'https://device-b.device.invalid')
      assert.equal(pulled.local['fp.page'], '"device-b-本机当前页面"')
      assert.equal(await b.page.evaluate(() => window.syncQA.workspace.getWorkspace().pages[0].name), 'device-b-页面设计', '没有自动重载或替换内存编辑状态')
      assert.equal(await b.page.getByRole('button', {name: '立即同步', exact: true}).isDisabled(), true)
      assert.equal(await b.page.getByRole('button', {name: '测试连接', exact: true}).isDisabled(), false)
      await b.page.getByRole('alert', {name: '同步数据待加载'}).waitFor()
      const gate = await b.page.evaluate(() => {
        const {components, store, workspace} = window.syncQA
        const attempts = [() => components.writeData('rejected-edit', '不能覆盖'), () => store.writeStored('settings', {name: '不能覆盖'}), () => workspace.commit(workspace.getWorkspace())]
        return attempts.map(work => {try {work(); return false} catch {return true}})
      })
      assert.deepEqual(gate, [true, true, true])
      const address = b.page.getByLabel(backend === 'http' ? '地址' : '目录或文件地址', {exact: true})
      const savedAddress = await address.inputValue()
      await address.fill('https://sync.example.test/rejected-target.json')
      assert.equal(await address.inputValue(), savedAddress, '同步设置的保存门禁错误被界面接住')
      await b.page.getByRole('button', {name: '测试连接', exact: true}).click()
      await b.page.getByText(/连接成功，云端有/).waitFor()
      assert.deepEqual(await snapshot(b.page), pulled)
      await b.page.getByRole('alert', {name: '同步数据待加载'}).getByRole('button', {name: '重新加载'}).click()
      await b.page.waitForFunction(() => window.syncQA)
      assert.equal(await b.page.evaluate(() => window.syncQA.workspace.getWorkspace().pages[0].name), 'device-a-页面设计')
      await b.page.evaluate(async () => {window.syncQA.components.writeData('after-reload', {saved: true}); await window.syncQA.components.flush()})
      assert.ok((await snapshot(b.page)).data.kv.some(row => row.k === 'after-reload'))
      assert.deepEqual([...a.errors, ...b.errors], [])
    } finally {await a.context.close(); await b.context.close()}
  })

  await check('Gist：两个设备只传配置，私人画像、记忆和聊天不进快照', async () => {
    const server = remote(), a = await fresh(server), b = await fresh(server)
    try {
      await configure(a.page, 'gist'); await configure(b.page, 'gist')
      await seed(a.page, 'device-a'); await seed(b.page, 'device-b')
      const sent = await sync(a.page); const received = await sync(b.page)
      assert.equal(sent.protection, 'unprotected'); assert.equal(received.needsReload, true)
      const wire = JSON.parse(server.text)
      assert.equal(wire.scope, 'configuration')
      assert.ok(Object.keys(wire.records).every(key => key.startsWith('config:')))
      assert.ok(server.text.includes('device-a-页面设计')); assert.ok(server.text.includes('device-a-当前性格'))
      for (const marker of ['组件业务数据', '应用业务状态', '聊天答案', '私人画像', '累积记忆', '性格历史', '已知密钥']) assert.ok(!server.text.includes(marker), marker)
      const pulled = await snapshot(b.page), persona = JSON.parse(pulled.local['fp.persona'])
      assert.equal(persona.soul.text, 'device-a-当前性格')
      assert.equal(persona.profile.role, 'device-b-私人画像'); assert.equal(persona.memory.items[0].text, 'device-b-累积记忆'); assert.equal(persona.soul.history[0].text, 'device-b-性格历史')
      assert.equal(pulled.data.kv.length, 1); assert.equal(pulled.data.turns.length, 2)
      assert.ok(pulled.data.turns.every(turn => turn.convId === 'device-b-conversation'))
      assert.ok(server.requests.filter(request => request.method === 'PATCH').every(request => !request.headers['if-match']))
      assert.deepEqual([...a.errors, ...b.errors], [])
    } finally {await a.context.close(); await b.context.close()}
  })

  await check('设置按钮：测试只读、键盘执行同步、正文收发和无ETag保护说明', async () => {
    const server = remote({etag: false}), app = await fresh(server)
    try {
      await configure(app.page); await seed(app.page, 'settings')
      await app.page.getByRole('button', {name: '测试连接', exact: true}).click()
      await app.page.getByText('连接成功，云端还没有数据。', {exact: true}).waitFor()
      assert.equal(server.writes.length, 0)
      const action = app.page.getByRole('button', {name: '立即同步', exact: true})
      await action.focus(); await app.page.keyboard.press('Enter')
      await app.page.getByText('本次正文收发', {exact: true}).waitFor()
      assert.equal(server.writes.length, 1)
      // A missing file can be conditionally created. The next GET proves that
      // this existing endpoint supplies no ETag for protecting updates.
      await action.click()
      await app.page.getByText('无并发写入保护；避免多台设备同时同步。', {exact: true}).waitFor()
      assert.ok(await app.page.getByText('无并发写入保护；避免多台设备同时同步。', {exact: true}).isVisible())
      assert.deepEqual(app.errors, [])
    } finally {await app.context.close()}
  })

  await check('真实网络等待期间编辑：同步拒绝且保留最新本机输入和数据库', async () => {
    const server = remote(), a = await fresh(server), b = await fresh(server)
    try {
      await configure(a.page); await seed(a.page, 'device-a'); await sync(a.page)
      await configure(b.page); await seed(b.page, 'device-b')
      const remoteBefore = server.text
      let admit, release
      const entered = new Promise(resolve => {admit = resolve})
      const gate = new Promise(resolve => {release = resolve})
      server.beforeRead = async () => {admit(); await gate}
      const running = sync(b.page).then(value => ({value}), error => ({error: error.message}))
      await entered
      await b.page.evaluate(async () => {
        window.syncQA.components.writeData('device-b-component', {text: '等待网络时刚输入的新内容'})
        await window.syncQA.components.flush()
      })
      release()
      const result = await running
      assert.match(result.error, /本机数据有新变化/)
      assert.equal(server.text, remoteBefore)
      const local = await snapshot(b.page)
      assert.equal(local.data.kv.find(row => row.k === 'device-b-component').v.text, '等待网络时刚输入的新内容')
      assert.equal(await b.page.evaluate(() => window.syncQA.components.readData('device-b-component', null).text), '等待网络时刚输入的新内容')
      assert.deepEqual([...a.errors, ...b.errors], [])
    } finally {await a.context.close(); await b.context.close()}
  })

  await check('真实App同步设置：当前工作空间通过新协议验证并由按钮写入隔离远端', async () => {
    const server = remote(), app = await fresh(server)
    try {
      await configure(app.page)
      await app.page.goto(`${base}/`, {waitUntil: 'domcontentloaded'})
      await app.page.locator('.canvas').waitFor()
      await app.page.evaluate(async () => {const workspace = await import('/src/lib/workspaceStore.ts'); workspace.commit(structuredClone(workspace.getWorkspace()))})
      await app.page.getByRole('navigation', {name: '侧边导航'}).getByRole('button', {name: '设置', exact: true}).click()
      await app.page.locator('.ios-side .ios-row').filter({has: app.page.locator('.ios-row-label').getByText('同步', {exact: true})}).click()
      await app.page.getByRole('button', {name: '测试连接', exact: true}).click()
      await app.page.getByText('连接成功，云端还没有数据。', {exact: true}).waitFor()
      assert.equal(server.writes.length, 0)
      await app.page.getByRole('button', {name: '立即同步', exact: true}).click()
      await app.page.getByText('本次正文收发', {exact: true}).waitFor()
      const wire = JSON.parse(server.text)
      assert.equal(wire.version, 2)
      assert.ok(wire.records['config:workspace'].value.pages.some(page => page.id === 'home'))
      assert.deepEqual(app.errors, [])
    } finally {await app.context.close()}
  })

  await check('首次PUT期间编辑：失败后刷新重试上传新值，不以旧云端覆盖新输入', async () => {
    const server = remote(), app = await fresh(server)
    try {
      await configure(app.page); await seed(app.page, 'first-upload')
      let admit, release
      const entered = new Promise(resolve => {admit = resolve})
      const gate = new Promise(resolve => {release = resolve})
      server.beforeWrite = async () => {admit(); await gate}
      const running = sync(app.page).then(value => ({value}), error => ({error: error.message}))
      await entered
      await app.page.evaluate(async () => {
        window.syncQA.components.writeData('first-upload-component', {text: '首次PUT在途的新输入'})
        await window.syncQA.components.flush()
      })
      release()
      const result = await running
      assert.match(result.error, /本机数据有新变化/)
      assert.ok(server.text.includes('first-upload-组件业务数据'))
      assert.equal((await snapshot(app.page)).data.kv.find(row => row.k === 'first-upload-component').v.text, '首次PUT在途的新输入')
      delete server.beforeWrite
      await app.page.reload(); await app.page.waitForFunction(() => window.syncQA)
      await sync(app.page)
      assert.equal((await snapshot(app.page)).data.kv.find(row => row.k === 'first-upload-component').v.text, '首次PUT在途的新输入')
      assert.equal(JSON.parse(server.text).records['component:first-upload-component'].value.text, '首次PUT在途的新输入')
      assert.deepEqual(app.errors, [])
    } finally {await app.context.close()}
  })

  await check('限流：显示冷却并禁用两种请求，切换目标解除旧连接状态', async () => {
    const server = remote(), app = await fresh(server)
    try {
      await configure(app.page)
      server.failRead = {status: 429, body: 'rate limited', headers: {'retry-after': '60'}}
      await app.page.getByRole('button', {name: '测试连接', exact: true}).click()
      await app.page.getByText('等待限流解除', {exact: true}).waitFor()
      assert.equal(await app.page.getByRole('button', {name: '测试连接', exact: true}).isDisabled(), true)
      assert.equal(await app.page.getByRole('button', {name: '立即同步', exact: true}).isDisabled(), true)
      const requests = server.requests.length
      await app.page.waitForTimeout(50)
      assert.equal(server.requests.length, requests)
      await app.page.getByRole('button', {name: 'WebDAV'}).click()
      assert.equal(await app.page.getByRole('button', {name: '测试连接', exact: true}).isDisabled(), false)
      assert.equal(await app.page.getByText('等待限流解除', {exact: true}).count(), 0)
      assert.deepEqual(app.errors, [])
    } finally {await app.context.close()}
  })

  await check('连接验证：拒绝旧协议且不写本地或云端，未创建Gist不声称验证令牌', async () => {
    const server = remote({text: JSON.stringify({app: 'dada-sync', version: 1, records: {}})}), app = await fresh(server)
    try {
      await configure(app.page); await seed(app.page, 'validation')
      const before = await snapshot(app.page)
      await app.page.getByRole('button', {name: '测试连接', exact: true}).click()
      await app.page.getByRole('alert').filter({hasText: '云端同步数据的格式'}).waitFor()
      assert.equal(server.writes.length, 0); assert.deepEqual(await snapshot(app.page), before)
      await configure(app.page, 'gist', {gist: {id: '', token: 'isolated-test-token'}})
      const requests = server.requests.length
      await app.page.getByRole('button', {name: '测试连接', exact: true}).click()
      await app.page.getByText('尚未创建 Gist，首次同步时创建；此检查没有验证令牌。', {exact: true}).waitFor()
      assert.equal(server.requests.length, requests); assert.deepEqual(app.errors, [])
    } finally {await app.context.close()}
  })

  await check('轮换与移除加密：原口令只存本次内存，成功后清空', async () => {
    const server = remote(), app = await fresh(server)
    try {
      await configure(app.page, 'http', {passphrase: 'old-isolated-passphrase'})
      await seed(app.page, 'encrypted'); await sync(app.page)
      assert.equal(JSON.parse(server.text).app, 'dada-sync-encrypted')
      await app.page.getByLabel('加密口令', {exact: true}).fill('new-isolated-passphrase')
      await app.page.getByRole('switch', {name: '更换或移除口令', exact: true}).click()
      await app.page.getByLabel('原云端口令', {exact: true}).fill('old-isolated-passphrase')
      assert.ok(!(await snapshot(app.page)).local['fp.sync.config'].includes('old-isolated-passphrase'))
      await app.page.getByRole('button', {name: '立即同步', exact: true}).click()
      await app.page.getByLabel('原云端口令', {exact: true}).waitFor({state: 'detached'})
      assert.equal(JSON.parse(server.text).app, 'dada-sync-encrypted')
      await app.page.getByRole('button', {name: '测试连接', exact: true}).click()
      await app.page.getByText(/连接成功，云端有/).waitFor()
      await app.page.getByLabel('加密口令', {exact: true}).fill('')
      await app.page.getByRole('switch', {name: '更换或移除口令', exact: true}).click()
      await app.page.getByLabel('原云端口令', {exact: true}).fill('new-isolated-passphrase')
      await app.page.getByRole('button', {name: '立即同步', exact: true}).click()
      await app.page.getByLabel('原云端口令', {exact: true}).waitFor({state: 'detached'})
      assert.equal(JSON.parse(server.text).app, 'dada-sync')
      assert.equal(JSON.parse((await snapshot(app.page)).local['fp.sync.config']).passphrase, '')
      assert.deepEqual(app.errors, [])
    } finally {await app.context.close()}
  })

  await check('响应式设置：320/375/768/1440双主题无横溢，输入和开关可聚焦', async () => {
    const app = await fresh()
    try {
      await configure(app.page, 'webdav')
      const colors = []
      for (const mode of ['light', 'dark']) {
        await app.page.evaluate(mode => {document.documentElement.dataset.theme = mode}, mode)
        for (const width of [320, 375, 768, 1440]) {
          await app.page.setViewportSize({width, height: 900})
          const geometry = await app.page.evaluate(() => ({windowWidth: innerWidth, width: document.documentElement.scrollWidth,
            overflow: [...document.querySelectorAll('input,button,[role="switch"],.ios-group')].map(element => {const rect = element.getBoundingClientRect(); return {left: rect.left, right: rect.right}}).filter(rect => rect.left < -1 || rect.right > innerWidth + 1), background: getComputedStyle(document.body).backgroundColor}))
          assert.equal(geometry.width, geometry.windowWidth, `${mode}/${width} document`)
          assert.deepEqual(geometry.overflow, [], `${mode}/${width} controls`)
          const password = app.page.getByLabel('密码', {exact: true})
          await password.focus(); assert.equal(await password.evaluate(input => input === document.activeElement), true)
          const automatic = app.page.getByRole('switch', {name: '自动同步', exact: true})
          await automatic.focus(); assert.equal(await automatic.evaluate(input => input === document.activeElement), true)
          if (width === 320 || width === 1440) {
            await app.page.locator('main').evaluate(main => {main.scrollTop = 0})
            await app.page.screenshot({path: `${output}/sync-${mode}-${width}.png`, fullPage: true})
            await app.page.getByLabel('加密口令', {exact: true}).scrollIntoViewIfNeeded()
            await app.page.screenshot({path: `${output}/sync-security-${mode}-${width}.png`, fullPage: true})
          }
          if (width === 320) colors.push(geometry.background)
        }
      }
      assert.notEqual(colors[0], colors[1]); assert.deepEqual(app.errors, [])
    } finally {await app.context.close()}
  })
} finally {
  await browser.close()
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2))
}
const failed = results.filter(result => result.status === 'failed')
console.log(`${results.length - failed.length}/${results.length} 项同步浏览器验证通过；产物 ${output}`)
if (failed.length) process.exitCode = 1
