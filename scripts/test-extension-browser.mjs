import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {execFileSync} from 'node:child_process'
import {mkdtemp, mkdir, readFile, writeFile, rm, cp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer} from 'node:http'

// 真正加载构建产物；只使用临时浏览器配置、合成应用和本机模型服务。
const require = createRequire(import.meta.url)
const {chromium} = require(process.env.DADA_PLAYWRIGHT_PATH || 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const extension = path.resolve(process.env.DADA_EXTENSION_DIR || path.join(root, 'dist-extension'))
const output = process.env.DADA_EXTENSION_QA_OUTPUT || '/tmp/dada-extension-browser'
const backupPath = path.join(output, 'extension-backup.json')
const profile = await mkdtemp(path.join(tmpdir(), 'dada-extension-browser-'))
const temporaryPaths = [profile]
await mkdir(output, {recursive: true})
const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'))
const results = [], errors = [], cspErrors = [], requests = [], browserLog = []
let context, activePage, websiteContext, dataRequests = 0
const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': '*'})
    res.end()
    return
  }
  if (req.url === '/v1/chat/completions') {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    res.writeHead(200, {'content-type': 'text/event-stream', 'access-control-allow-origin': '*'})
    for (const content of ['扩展流式', '响应成功']) res.write(`data: ${JSON.stringify({id: 'extension-qa', choices: [{index: 0, delta: {content}, finish_reason: null}]})}\n\n`)
    res.end(`data: ${JSON.stringify({id: 'extension-qa', choices: [{index: 0, delta: {}, finish_reason: 'stop'}]})}\n\ndata: [DONE]\n\n`)
    return
  }
  if (req.url === '/data') {
    dataRequests++
    res.writeHead(200, {'content-type': 'application/json', 'access-control-allow-origin': '*'})
    res.end(JSON.stringify({ok: true, source: 'local-extension-qa'}))
    return
  }
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    const file = path.resolve(root, 'dist', '.' + (pathname === '/' ? '/index.html' : pathname))
    assert.ok(file.startsWith(path.join(root, 'dist') + path.sep))
    const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.zip': 'application/zip'}
    const body = await readFile(file)
    res.writeHead(200, {'content-type': types[path.extname(file)] || 'application/octet-stream'})
    res.end(body)
  } catch {res.writeHead(404); res.end('Not found')}
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const apiBase = `http://127.0.0.1:${server.address().port}`
const moduleUrl = 'https://esm.sh/dada-extension-qa.mjs'

async function test(name, run) {
  const start = Date.now()
  try {await run(); results.push({name, status: 'passed', ms: Date.now() - start}); console.log(`通过：${name}`)}
  catch (error) {results.push({name, status: 'failed', error: error.stack ?? String(error), ms: Date.now() - start}); throw error}
}
function watch(page) {
  page.on('response', response => {if (response.status() >= 400 || response.url().includes('dada-extension-qa')) browserLog.push({url: response.url(), status: response.status()})})
  page.on('requestfailed', request => browserLog.push({url: request.url(), failure: request.failure()?.errorText}))
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error') browserLog.push({url: page.url(), console: message.text()})
    if (message.type() === 'error' && /Content Security Policy|Refused to (?:execute|load|frame)|violates.*(?:script|frame)-src/i.test(message.text())) cspErrors.push(message.text())
  })
  return page
}
const waitApp = page => page.locator('.app').waitFor({timeout: 30000})
const applet = page => page.locator('.widget[data-id="qa-applet"]')
const appFrame = page => page.locator('.widget[data-id="qa-app"]').frameLocator('iframe.app-frame')
const countText = count => `QA Applet 次数 ${count} 双倍 ${count * 2}`
async function waitState(page, count) {
  await applet(page).getByText(new RegExp(countText(count))).waitFor({timeout: 15000})
  await appFrame(page).locator('#qa-state').filter({hasText: `QA App 次数 ${count} 双倍 ${count * 2}`}).waitFor({timeout: 15000})
}
async function appData(page, kind, id) {
  return page.evaluate(({kind, id}) => new Promise((resolve, reject) => {
    const request = indexedDB.open('dada')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction('apps', 'readonly'), get = tx.objectStore('apps').get(`${kind}:${id}`)
      get.onsuccess = () => resolve(get.result?.v)
      get.onerror = () => reject(get.error)
      tx.oncomplete = () => db.close()
    }
  }), {kind, id})
}
async function jump(page, label) {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
  await page.locator('.cmdk-row').filter({has: page.locator('.cmdk-label', {hasText: label})}).first().click()
}

try {
  await test('完整 ZIP 根目录、manifest 与沙盒入口齐备，未递归打包下载文件', async () => {
    assert.equal(manifest.manifest_version, 3)
    assert.equal(manifest.chrome_url_overrides.newtab, 'index.html')
    assert.ok(manifest.sandbox.pages.includes('sandbox.html'))
    const entries = execFileSync('unzip', ['-Z1', path.join(root, 'public/dada-extension.zip')], {encoding: 'utf8'}).trim().split('\n')
    for (const file of ['manifest.json', 'index.html', 'sandbox.html', 'sandbox.js', 'background.js']) assert.ok(entries.includes(file), file)
    assert.equal(entries.some(file => /\.zip$/i.test(file)), false)
    assert.equal(entries.some(file => /^(?:node_modules|src|\.git)\//.test(file)), false)
  })
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: process.env.DADA_EXTENSION_HEADED !== '1',
    viewport: {width: 1440, height: 900}, reducedMotion: 'reduce', acceptDownloads: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  })
  await context.route('**/*', route => {
    const url = route.request().url()
    if (url === moduleUrl) return route.fulfill({contentType: 'text/javascript', headers: {'access-control-allow-origin': '*'}, body: 'export const double=value=>value*2;'} )
    if (url.startsWith(apiBase + '/')) return route.continue()
    if (/^https:\/\/fonts\.googleapis\.com\//.test(url)) return route.fulfill({contentType: 'text/css', body: ''})
    if (/^https?:/.test(url)) return route.abort()
    return route.continue()
  })
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', {timeout: 15000})
  const extensionId = new URL(worker.url()).host
  const newtabUrl = `chrome-extension://${extensionId}/index.html`
  activePage = watch(await context.newPage())
  await test('真实新标签页加载完整应用，默认 iOS 与玻璃 Dock，无网页 PWA 注册', async () => {
    // chrome://newtab 本身通常保留虚拟 URL，但文档来自扩展。
    await activePage.goto('chrome://newtab', {waitUntil: 'domcontentloaded'})
    await waitApp(activePage)
    assert.equal(await activePage.evaluate(() => location.protocol), 'chrome-extension:')
    const state = await activePage.evaluate(async () => ({
      skin: document.documentElement.dataset.skin,
      mode: document.documentElement.dataset.theme,
      dock: document.querySelector('[data-dock]')?.getAttribute('data-dock'),
      pwa: (await navigator.serviceWorker.getRegistrations()).map(item => item.active?.scriptURL ?? ''),
      scripts: [...document.scripts].map(script => script.src),
    }))
    assert.equal(state.skin, 'ios')
    assert.equal(state.mode, 'light')
    assert.equal(state.dock, 'glass')
    assert.equal(state.scripts.some(src => /umami|workbox|registerSW/.test(src)), false)
    assert.equal(state.pwa.some(src => /(?:^|\/)sw\.js$|workbox/.test(src)), false)
    await activePage.screenshot({path: path.join(output, 'default-ios-glass.png')})
  })

  await test('真实隔离 App/Applet 加载外部 ESM、交互并持久保存，重载后读回', async () => {
    const app = {
      id: 'qa-app', type: 'app', title: '扩展 App 验收', span: 'half',
      config: {
        html: '<button id="qa-increment">App 递增</button><output id="qa-state"></output>', css: '', height: 200,
        js: `import {double} from '${moduleUrl}';let n=await tada.store.get('count')??0;const show=()=>document.getElementById('qa-state').textContent='QA App 次数 '+n+' 双倍 '+double(n)+' 深色 '+tada.dark+' 设置 '+tada.settings.label+' 形态 '+tada.surface;document.getElementById('qa-increment').onclick=async()=>{await tada.store.set('count',++n);show()};addEventListener('tada:themechange',show);addEventListener('tada:settingschange',show);show();`,
      },
    }
    const small = {
      id: 'qa-applet', type: 'applet', title: '扩展 Applet 验收', span: 'half',
      config: {height: 200, source: `import {double} from '${moduleUrl}';applet({state:{count:0},persist:['count'],view(s,ctx){return ui.Stack({},[ui.Text({text:'QA Applet 次数 '+s.count+' 双倍 '+double(s.count)+' 深色 '+ctx.dark+' 设置 '+ctx.settings.label+' 形态 '+ctx.surface}),ui.Button({label:'Applet 递增',onClick(){s.count++}})])}})`},
    }
    const workspace = {version: 6, pages: [{id: 'home', name: '首页', label: '首页', icon: 'home', align: 'start', components: [small, app]}], theme: {active: 'ios', mode: 'light', base: 'light'}, layout: {columns: 12, maxWidth: 1480}, dock: {preset: 'glass'}, addons: [], statusbar: [], widgets: [], network: [], templates: [], applications: [small, app].map(instance => ({id: instance.id, instance, description: '隔离浏览器验收', group: '验收', openMode: 'modal', dock: false, status: false, settingsSchema: {label: {kind: 'string', label: '标记', default: '初始'}}, settings: {label: '初始'}}))}
    await activePage.evaluate(({workspace, apiBase}) => {
      localStorage.setItem('fp.workspace', JSON.stringify(workspace))
      localStorage.setItem('fp.page', JSON.stringify('home'))
      localStorage.setItem('fp.settings', JSON.stringify({name: '扩展验收', theme: 'light', proxy: '/__proxy?url={url}', ai: {baseUrl: apiBase + '/v1', apiKey: 'synthetic-qa-key', model: 'extension-qa'}}))
    }, {workspace, apiBase})
    await activePage.reload({waitUntil: 'domcontentloaded'})
    await waitApp(activePage); await waitState(activePage, 0)
    await applet(activePage).getByRole('button', {name: 'Applet 递增', exact: true}).click()
    await appFrame(activePage).getByRole('button', {name: 'App 递增', exact: true}).click()
    await waitState(activePage, 1)
    await assert.doesNotReject(async () => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if ((await appData(activePage, 'app', 'qa-app'))?.count === 1 && (await appData(activePage, 'applet', 'qa-applet'))?.count === 1) return
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      throw new Error('App/Applet 保存未完成')
    })
    const iframe = activePage.frames().find(frame => frame !== activePage.mainFrame() && frame.url().includes('sandbox.html') && frame.name() !== '') ?? activePage.frames()[1]
    assert.equal(await iframe.evaluate(() => typeof globalThis.chrome?.runtime), 'undefined')
    await activePage.reload({waitUntil: 'domcontentloaded'})
    await waitApp(activePage); await waitState(activePage, 1)
  })
  await test('主题热切换传入两个运行器，窄屏浅深色无横向溢出', async () => {
    await activePage.getByRole('button', {name: '深浅色切换', exact: true}).click()
    await applet(activePage).getByText(/QA Applet.*深色 true/).waitFor()
    await appFrame(activePage).locator('#qa-state').filter({hasText: '深色 true'}).waitFor()
    for (const mode of ['dark', 'light']) {
      if (mode === 'light') await activePage.getByRole('button', {name: '深浅色切换', exact: true}).click()
      await activePage.setViewportSize({width: 320, height: 760})
      await activePage.screenshot({path: path.join(output, `apps-320-${mode}.png`)})
      assert.equal(await activePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    }
    await activePage.setViewportSize({width: 1440, height: 900})
  })
  await test('网络未授权时由可见 UI 拒绝，不向合成服务发请求', async () => {
    const pending = activePage.evaluate(apiBase => fetch(apiBase + '/data').then(response => response.text()).then(() => 'unexpected success', error => error.message), apiBase)
    const dialog = activePage.getByRole('dialog').filter({hasText: '连接外部服务'})
    await dialog.waitFor()
    await dialog.getByRole('button', {name: '暂不连接', exact: true}).click()
    assert.match(await pending, /取消|允许|权限/)
    assert.equal(dataRequests, 0)
  })
  await test('原生书签桥在扩展内部可读取', async () => {
    const reply = await activePage.evaluate(() => chrome.runtime.sendMessage({source: 'dada-extension', op: 'list'}))
    assert.equal(reply.ok, true)
    assert.ok(Array.isArray(reply.data.items))
  })
  await test('两个新标签页仅一个运行实例，关闭后接续读取已保存状态', async () => {
    const ownerTabId = await activePage.evaluate(async () => (await chrome.tabs.getCurrent()).id)
    const other = watch(await context.newPage())
    await other.goto(newtabUrl, {waitUntil: 'domcontentloaded'})
    await other.getByRole('main', {name: '搭搭已在另一个标签页打开'}).waitFor()
    assert.equal(await other.locator('.app').count(), 0)
    await other.getByRole('button', {name: '回到搭搭', exact: true}).click()
    await other.waitForFunction(async ownerTabId => (await chrome.tabs.query({active: true, currentWindow: true}))[0]?.id === ownerTabId, ownerTabId)
    await activePage.close()
    activePage = other
    await waitApp(activePage); await waitState(activePage, 1)
    assert.equal((await appData(activePage, 'app', 'qa-app')).count, 1)
    assert.equal((await appData(activePage, 'applet', 'qa-applet')).count, 1)
  })
  await test('扩展设置存在准确的开发者模式安装、数据与更新指引', async () => {
    await jump(activePage, '设置')
    await activePage.getByRole('button', {name: /浏览器扩展/}).click()
    await activePage.getByText(/开发者模式/).first().waitFor()
    await activePage.getByText(/解压/).first().waitFor()
    await activePage.getByText('已安装开发者版本', {exact: true}).waitFor()
    await activePage.getByText(/从网页版下载新 ZIP/).waitFor()
    await activePage.getByText(/网页版与扩展的数据独立/).waitFor()
    await activePage.screenshot({path: path.join(output, 'extension-install-guide.png')})
  })
  await test('App/Applet 独立窗口接收设置热更新并保留业务数据和运行形态', async () => {
    for (const kind of ['applet', 'app']) {
      await activePage.getByRole('button', {name: new RegExp(`扩展 ${kind === 'app' ? 'App' : 'Applet'} 验收`)}).click()
      await activePage.getByRole('button', {name: '打开', exact: true}).click()
      const runtime = activePage.locator(`.application-runtime[data-application="qa-${kind}"]`)
      const body = kind === 'app' ? runtime.frameLocator('iframe.app-frame') : runtime
      await body.getByText(/次数 1.*设置 初始 形态 modal/).waitFor()
      const setting = activePage.getByRole('textbox', {name: '标记', exact: true})
      await setting.fill('热更新')
      await setting.blur()
      await body.getByText(/次数 1.*设置 热更新 形态 modal/).waitFor()
      await activePage.getByRole('button', {name: '关闭应用', exact: true}).click()
      await runtime.waitFor({state: 'detached'})
    }
  })
  await test('通过真实设置导出扩展的完整备份，包含应用数据与设置', async () => {
    await activePage.getByRole('button', {name: '数据', exact: true}).click()
    const downloadPromise = activePage.waitForEvent('download')
    await activePage.getByRole('button', {name: '导出备份', exact: true}).click()
    const download = await downloadPromise
    assert.equal(await download.failure(), null)
    await download.saveAs(backupPath)
    const backup = JSON.parse(await readFile(backupPath, 'utf8'))
    assert.equal(backup.app, 'dada-backup')
    for (const kind of ['app', 'applet']) assert.equal(backup.indexedDB.apps.find(row => row.k === `${kind}:qa-${kind}`)?.v.count, 1)
    const workspace = JSON.parse(backup['fp.workspace'])
    assert.equal(workspace.applications.find(application => application.id === 'qa-app').settings.label, '热更新')
    assert.equal(workspace.applications.find(application => application.id === 'qa-applet').settings.label, '热更新')
  })
  await test('扩展备份经真实网页导入后完整恢复，网站可下载完整 ZIP', async () => {
    // 导入/下载独立环境；PWA 另项实测。
    websiteContext = await context.browser().newContext({viewport: {width: 1440, height: 900}, acceptDownloads: true})
    await websiteContext.route('**/*', route => {
      const url = route.request().url()
      if (url === apiBase + '/sw.js') return route.abort()
      if (url === moduleUrl) return route.fulfill({contentType: 'text/javascript', headers: {'access-control-allow-origin': '*'}, body: 'export const double=value=>value*2;'})
      if (url.startsWith(apiBase + '/') || !/^https?:/.test(url)) return route.continue()
      if (/^https:\/\/fonts\.googleapis\.com\//.test(url)) return route.fulfill({contentType: 'text/css', body: ''})
      return route.abort()
    })
    const website = watch(await websiteContext.newPage())
    await website.goto(apiBase + '/', {waitUntil: 'domcontentloaded'})
    await waitApp(website)
    await jump(website, '设置')
    await website.getByRole('button', {name: '数据', exact: true}).click()
    await website.locator('input[type="file"]').setInputFiles(backupPath)
    await Promise.all([
      website.waitForEvent('domcontentloaded'),
      website.getByRole('dialog').filter({hasText: '导入备份'}).getByRole('button', {name: '替换并导入', exact: true}).click(),
    ])
    await waitApp(website)
    // Web opaque srcdoc 的远程 ESM 请求无法可靠经 Playwright route 拦截；
    // 此处直接核对原始备份和恢复记录等价，ESM/运行形态已在真实 MV3 上单独验证。
    for (const kind of ['app', 'applet']) assert.equal((await appData(website, kind, `qa-${kind}`)).count, 1)
    const backup = JSON.parse(await readFile(backupPath, 'utf8'))
    const restored = await website.evaluate(() => ({workspace: JSON.parse(localStorage.getItem('fp.workspace')), settings: JSON.parse(localStorage.getItem('fp.settings'))}))
    assert.deepEqual(restored.workspace.applications, JSON.parse(backup['fp.workspace']).applications)
    assert.deepEqual(restored.workspace.pages, JSON.parse(backup['fp.workspace']).pages)
    assert.deepEqual(restored.settings, JSON.parse(backup['fp.settings']))
    await jump(website, '设置')
    await website.getByRole('button', {name: /浏览器扩展/}).click()
    const downloadPromise = website.waitForEvent('download')
    await website.getByRole('link', {name: '下载 ZIP', exact: true}).click()
    const download = await downloadPromise
    assert.equal(await download.failure(), null)
    assert.equal(download.suggestedFilename(), 'dada-extension.zip')
    const downloaded = path.join(output, 'downloaded-extension.zip')
    await download.saveAs(downloaded)
    assert.deepEqual(await readFile(downloaded), await readFile(path.join(root, 'public/dada-extension.zip')))
    assert.equal(await website.evaluate(() => typeof globalThis.chrome?.runtime?.id), 'undefined')
    await website.screenshot({path: path.join(output, 'website-extension-download.png')})
    await websiteContext.close(); websiteContext = undefined
  })
  await test('网页 PWA 首次安装后新页面可离线启动完整应用', async () => {
    // 独立网页配置不安装扩展，也不使用之前页面的脚本/HTTP缓存。
    // 关闭旧页并离线新开入口，覆盖 App 动态 chunk 的预缓存合同。
    websiteContext = await context.browser().newContext({viewport: {width: 1440, height: 900}, serviceWorkers: 'allow'})
    const online = watch(await websiteContext.newPage())
    await online.goto(apiBase + '/', {waitUntil: 'domcontentloaded'})
    await waitApp(online)
    await online.evaluate(async () => {await navigator.serviceWorker.ready})
    const cached = await online.evaluate(async () => (await Promise.all((await caches.keys()).map(async name => (await (await caches.open(name)).keys()).map(request => request.url)))).flat())
    for (const chunk of ['App-', 'incrementalClient-', 'syncService-']) assert.ok(cached.some(url => url.includes('/assets/' + chunk)), `${chunk} 已预缓存`)
    await online.close()
    await websiteContext.setOffline(true)
    const offline = watch(await websiteContext.newPage())
    const response = await offline.goto(apiBase + '/', {waitUntil: 'domcontentloaded'})
    await waitApp(offline)
    assert.equal(response.fromServiceWorker(), true)
    assert.equal(await offline.evaluate(apiBase => fetch(apiBase + '/offline-network-probe', {cache: 'no-store'}).then(() => false, () => true), apiBase), true)
    await jump(offline, '设置')
    await offline.getByRole('button', {name: /浏览器扩展/}).waitFor()
    await offline.screenshot({path: path.join(output, 'website-pwa-offline.png')})
    await websiteContext.close(); websiteContext = undefined
  })
  await test('隔离预授权环境通过真实宿主发送模型流式请求并保存回答', async () => {
    // 原生权限确认弹窗无法由 headless 自动确认。只在临时副本预授予本机来源，
    // 不改生产 manifest；此项验证获准后的真实网络与 AI 链路，不冒充原生确认验收。
    await context.close()
    const fixture = await mkdtemp(path.join(tmpdir(), 'dada-extension-pregranted-'))
    const grantedProfile = await mkdtemp(path.join(tmpdir(), 'dada-extension-granted-profile-'))
    temporaryPaths.push(fixture, grantedProfile)
    await cp(extension, fixture, {recursive: true})
    await writeFile(path.join(fixture, 'manifest.json'), JSON.stringify({...manifest, host_permissions: ['http://127.0.0.1/*']}, null, 2))
    context = await chromium.launchPersistentContext(grantedProfile, {
      channel: 'chromium', headless: process.env.DADA_EXTENSION_HEADED !== '1',
      viewport: {width: 1440, height: 900}, reducedMotion: 'reduce',
      args: [`--disable-extensions-except=${fixture}`, `--load-extension=${fixture}`],
    })
    await context.route('**/*', route => {
      const url = route.request().url()
      if (url.startsWith(apiBase + '/') || !/^https?:/.test(url)) return route.continue()
      if (/^https:\/\/fonts\.googleapis\.com\//.test(url)) return route.fulfill({contentType: 'text/css', body: ''})
      return route.abort()
    })
    const grantedWorker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
    activePage = watch(await context.newPage())
    await activePage.goto(`chrome-extension://${new URL(grantedWorker.url()).host}/index.html`, {waitUntil: 'domcontentloaded'})
    await waitApp(activePage)
    assert.equal(await activePage.evaluate(() => chrome.permissions.contains({origins: ['http://127.0.0.1/*']})), true)
    await activePage.evaluate(apiBase => {
      const settings = JSON.parse(localStorage.getItem('fp.settings') || '{}')
      settings.ai = {baseUrl: apiBase + '/v1', apiKey: 'isolated-synthetic-key', model: 'extension-qa', protocol: 'openai'}
      localStorage.setItem('fp.settings', JSON.stringify(settings))
      localStorage.setItem('fp.workspace', JSON.stringify({version: 6, pages: [{id: 'home', name: '首页', components: []}], theme: {active: 'ios', mode: 'light', base: 'light'}, layout: {columns: 12, maxWidth: 1480}, dock: {preset: 'glass'}, addons: [], statusbar: [], widgets: [], network: [], templates: [], applications: []}))
    }, apiBase)
    await activePage.reload({waitUntil: 'domcontentloaded'}); await waitApp(activePage)
    const reply = await activePage.evaluate(apiBase => fetch('/__proxy?url=' + encodeURIComponent(apiBase + '/data')).then(response => response.json()), apiBase)
    assert.deepEqual(reply, {ok: true, source: 'local-extension-qa'})
    await activePage.keyboard.press(process.platform === 'darwin' ? 'Meta+j' : 'Control+j')
    await activePage.getByRole('textbox', {name: '消息内容', exact: true}).fill('仅测试本机流式响应')
    await activePage.getByRole('button', {name: '发送', exact: true}).click()
    await activePage.locator('.turn').last().getByText('扩展流式响应成功', {exact: true}).waitFor({timeout: 20000})
    await activePage.getByRole('button', {name: '发送', exact: true}).waitFor()
    assert.equal(requests.length, 1)
    assert.equal(requests[0].stream, true)
    assert.equal(requests[0].messages.at(-1).content, '仅测试本机流式响应')
    await activePage.screenshot({path: path.join(output, 'extension-model-stream.png')})
    await activePage.reload({waitUntil: 'domcontentloaded'}); await waitApp(activePage)
    await activePage.keyboard.press(process.platform === 'darwin' ? 'Meta+j' : 'Control+j')
    await activePage.locator('.ai-history-item').filter({hasText: '仅测试本机流式响应'}).click()
    await activePage.locator('.turn').last().getByText('扩展流式响应成功', {exact: true}).waitFor()
  })
  await test('生成应用与宿主页没有关键 CSP 拒绝或未捕获 JS 错误', async () => {
    assert.deepEqual(cspErrors, [])
    assert.deepEqual(errors, [])
  })
} catch (error) {
  console.error(error.stack ?? error)
  await activePage?.screenshot({path: path.join(output, 'failure.png')}).catch(() => undefined)
  process.exitCode = 1
} finally {
  await writeFile(path.join(output, 'results.json'), JSON.stringify({results, errors, cspErrors, browserLog, syntheticModelRequests: requests.length, syntheticDataRequests: dataRequests, limitations: ['原生可选主机权限确认弹窗需人工确认；自动化覆盖应用内拒绝路径，成功分支使用仅授予 localhost 的临时扩展副本，不修改生产 manifest。']}, null, 2))
  await context?.close()
  await websiteContext?.close()
  await new Promise(resolve => server.close(resolve))
  await Promise.all(temporaryPaths.map(directory => rm(directory, {recursive: true, force: true})))
}
console.log(`扩展浏览器验收：${results.filter(result => result.status === 'passed').length}/${results.length}；结果 ${output}/results.json`)
