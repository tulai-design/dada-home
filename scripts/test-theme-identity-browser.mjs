import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdirSync, writeFileSync} from 'node:fs'
import {routeBuiltinFixtures} from './browser-builtin-fixtures.mjs'

// 每个场景使用全新 context；不读取用户 profile，也不调用真实模型或远端服务。
const require = createRequire(import.meta.url)
const {chromium} = require(process.env.DADA_PLAYWRIGHT_PATH || 'playwright')
const base = (process.env.DADA_QA_URL || 'http://127.0.0.1:5197').replace(/\/$/, '')
const out = process.env.DADA_QA_OUTPUT || '/tmp/dada-theme-identity-browser'
const filter = process.env.DADA_QA_FILTER || ''
mkdirSync(out, {recursive: true})
const browser = await chromium.launch({headless: true})
const results = [], errors = [], samples = []
let page, context, scenario

async function check(name, run) {
  try {
    await run()
    results.push({scenario, name, ok: true})
    console.log(`通过：${scenario} ${name}`)
  } catch (error) {
    results.push({scenario, name, ok: false, error: error.message})
    console.error(`失败：${scenario} ${name}: ${error.message}`)
    await page?.screenshot({path: `${out}/${scenario}-${results.length}-failure.png`, fullPage: true}).catch(() => {})
  }
}

const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
const call = async (name, args = {}) => {
  const result = await page.evaluate(({name, args}) => window.__tada.call(name, args), {name, args})
  await settle()
  return result
}
const workspace = () => page.evaluate(() => window.__tada.workspace())
const active = async () => {const ws = await workspace(); return ws.themes.find(t => t.id === ws.theme.active)}

async function ready() {
  // Switch/Win98 在启动器/桌面模式下可能暂时不挂载首页 widget；宿主
  // `.app` 才是应用已经完成渲染的稳定信号，不能把合法的隐藏内容当作启动失败。
  await page.locator('.app').waitFor({state: 'attached'})
  await page.waitForFunction(() => window.__tada?.workspace())
}

async function openFixture(name, width = 1440) {
  await context?.close()
  scenario = name
  context = await browser.newContext({viewport: {width, height: 960}, reducedMotion: 'reduce'})
  await routeBuiltinFixtures(context, base)
  await context.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType: 'text/css', body: ''}))
  await context.addInitScript(() => {
    if (window !== window.top) return
    localStorage.setItem('fp.assistantPanelMode', JSON.stringify('split'))
    localStorage.setItem('fp.sidebarAi', JSON.stringify('split'))
    window.modelPlans = []
    window.modelRequests = []
    const original = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      if (!String(input).includes('/__theme_model__/')) return original(input, init)
      window.modelRequests.push(JSON.parse(init.body))
      const plan = window.modelPlans.shift()
      if (!plan) throw new Error('主题验收模型出现额外请求')
      const encoder = new TextEncoder()
      const chunks = [
        {choices: [{index: 0, delta: plan.tools ? {tool_calls: plan.tools.map((tool, index) => ({index, id: tool.id, type: 'function', function: {name: tool.name, arguments: JSON.stringify(tool.args)}}))} : {content: plan.text}, finish_reason: null}]},
        {choices: [{index: 0, delta: {}, finish_reason: plan.tools ? 'tool_calls' : 'stop'}]},
      ]
      return new Response(new ReadableStream({start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode('data: ' + JSON.stringify(chunk) + '\n\n'))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }}), {headers: {'content-type': 'text/event-stream'}})
    }
  })
  page = await context.newPage()
  page.setDefaultTimeout(7000)
  page.on('pageerror', error => errors.push({scenario, message: error.message}))
  await page.goto(base, {waitUntil: 'domcontentloaded'})
  await ready()
  await page.evaluate(async () => {
    const {defaultSettings} = await import('/src/lib/defaults.ts')
    const settings = defaultSettings()
    settings.ai = {baseUrl: location.origin + '/__theme_model__/v1', apiKey: 'isolated-fixture', model: 'test-model', protocol: 'openai'}
    localStorage.setItem('fp.settings', JSON.stringify(settings))
  })
  await page.reload({waitUntil: 'domcontentloaded'})
  await ready()
}

async function command(label) {
  await page.keyboard.press('Escape')
  await page.keyboard.press('Meta+k')
  await page.locator('.cmdk-row').filter({has: page.locator('.cmdk-label', {hasText: new RegExp(`^${label}$`)})}).click()
  await settle()
}

async function appearance() {
  return page.evaluate(() => {
    const root = document.documentElement
    const css = getComputedStyle(root)
    // 用实际元素解析颜色，避免只证明配置或 CSS 自定义属性被写入。
    const probe = document.createElement('span')
    probe.style.color = 'var(--main)'
    document.body.append(probe)
    const color = getComputedStyle(probe).color
    probe.style.fontFamily = 'var(--font-sans)'
    const sans = getComputedStyle(probe).fontFamily
    probe.remove()
    return {skin: root.dataset.skin || 'paper', color, bg: css.getPropertyValue('--bg').trim(), radius: css.getPropertyValue('--radius').trim(), font: css.getPropertyValue('--font-serif').trim(), sans, switch: !!document.querySelector('.switch-dock'), win98: !!document.querySelector('.win98-taskbar')}
  })
}

function sameRenderer(actual, expected) {
  for (const key of ['skin', 'radius', 'font', 'switch', 'win98']) assert.equal(actual[key], expected[key], `${key} 必须保留`)
}

async function derivation(ref, width) {
  await openFixture(`${ref}-${width}`, width)
  await call('apply_theme', {ref})
  await call('set_theme', {mode: 'light'})
  const original = await active(), before = await appearance()
  await call('set_theme', {overrides: {main: '#8844cc'}})
  const variant = await active(), derived = await appearance()
  samples.push({scenario, original, variant, before, derived})
  await check('派生保留造型、外壳、尺寸及字体', async () => {
    assert.notEqual(variant.id, original.id)
    assert.equal(variant.builtin, undefined)
    sameRenderer(derived, before)
  })
  await check('共享主色真正覆盖已有模式主色', async () => assert.equal(derived.color, 'rgb(136, 68, 204)'))
  await call('save_theme', {id: variant.id, name: `验收${ref}`, light: {main: '#a030c0'}, dark: {main: '#52ddaa'}})
  if (ref === 'switch' || ref === 'win98') {
    await call('set_theme', {fonts: [{family: 'Noto Serif SC', role: 'sans'}]})
    await check('显式字体派生后实际字体栈保留', async () => assert.match((await appearance()).sans, /Noto Serif SC/))
    // 现有 font-serif 以 var(--font-sans) 复用主机正文栈，显式更换 sans
    // 会同时影响其计算值；后续只要求这一已经确认的新设计继续保留。
    const changed = await appearance()
    before.font = changed.font
    before.sans = changed.sans
  }
  await check('改名与双模式修改保持实现，浅色实际生效', async () => {
    assert.equal((await active()).name, `验收${ref}`)
    sameRenderer(await appearance(), before)
    assert.equal((await appearance()).color, 'rgb(160, 48, 192)')
  })
  await call('set_theme', {mode: 'dark'})
  await check('深色实际生效并保持外壳', async () => {
    const now = await appearance()
    assert.equal(now.skin, before.skin)
    assert.equal(now.switch, before.switch)
    assert.equal(now.win98, before.win98)
    assert.equal(now.color, 'rgb(82, 221, 170)')
    assert.notEqual(now.bg, before.bg)
    assert.ok(await page.locator('.canvas').evaluate(el => el.scrollWidth <= el.clientWidth + 1), '画布无横向溢出')
  })
  await page.screenshot({path: `${out}/${scenario}-dark.png`})
  await call('save_template', {name: `模板${ref}`})
  const templateId = (await workspace()).templates.find(t => t.name === `模板${ref}`).id
  await page.reload({waitUntil: 'domcontentloaded'})
  // __tada 先于 App 的 registry 动态导入挂到 window；只等它存在会在启动竞态
  // 下让 defaultWorkspace 看到未注册的组件。与首次启动相同，等待宿主 .app
  // 后再读取工作空间，确保重载验收观察的是稳定应用而非初始化中间态。
  await ready()
  await check('重载后精确主题身份与双模式值保留', async () => {
    assert.equal((await active()).id, variant.id)
    assert.equal((await appearance()).skin, before.skin)
    assert.equal((await appearance()).color, 'rgb(82, 221, 170)')
  })
  await call('apply_theme', {ref: 'ios'})
  await call('apply_template', {ref: templateId})
  // 模板保存的是主题的完整双模式设计；当前明暗偏好属于 workspace.theme。
  // 先显式切回深色，再验证模板中的 dark 分支确实被采用，避免把“当前模式”
  // 与主题快照中的双模式值混为一谈。
  await call('set_theme', {mode: 'dark'})
  await check('模板重载后按精确身份往返', async () => {
    assert.equal((await active()).id, variant.id)
    sameRenderer(await appearance(), before)
    assert.equal((await appearance()).color, 'rgb(82, 221, 170)')
  })
  if (ref === 'switch' || ref === 'win98') {
    await call('set_theme', {overrides: null})
    await check('清空设计仍保留外壳必需 token 与控件实际样式', async () => {
      const cleared = await appearance()
      assert.equal(cleared.skin, before.skin)
      assert.equal(cleared.switch, before.switch)
      assert.equal(cleared.win98, before.win98)
      const token = ref === 'switch' ? 'switch-focus' : 'win98-face'
      const computed = await page.evaluate(({token, ref}) => {
        const css = getComputedStyle(document.documentElement)
        const element = document.querySelector(ref === 'switch' ? '.switch-dock' : '.win98-taskbar')
        return {token: css.getPropertyValue(`--${token}`).trim(), display: element && getComputedStyle(element).display, background: element && getComputedStyle(element).backgroundColor}
      }, {token, ref})
      assert.ok(computed.token, `${token} 清空后仍有默认值`)
      assert.ok(computed.display && computed.display !== 'none')
      assert.ok(computed.background, '外壳控件实际样式可计算')
    })
  }
}

async function lifecycle(ref) {
  await openFixture(`lifecycle-${ref}`)
  await call('install_addon', {id: 'desk'})
  await call('apply_theme', {ref})
  await command('书桌')
  const input = page.getByPlaceholder('添一件待办，回车确认', {exact: true})
  await input.fill('未提交的待办草稿')
  const inputNode = await input.elementHandle()
  await call('create_app', {title: '主题运行验收', openMode: 'modal', html: '<output id="init"></output><input aria-label="应用草稿">', css: '', js: 'const count=(await tada.store.get("init-count")??0)+1;await tada.store.set("init-count",count);document.getElementById("init").textContent="初始化 "+count'})
  const applicationId = (await workspace()).applications.find(a => a.instance.title === '主题运行验收').id
  await command('主题运行验收')
  const runtime = page.locator(`.application-runtime[data-application="${applicationId}"]`)
  const frame = runtime.frameLocator('iframe.app-frame')
  await frame.getByText('初始化 1', {exact: true}).waitFor()
  await frame.getByRole('textbox', {name: '应用草稿', exact: true}).fill('应用中的未保存文字')
  const runtimeNode = await runtime.elementHandle(), iframeNode = await runtime.locator('iframe').elementHandle()
  // iframe 输入框拥有焦点时，快捷键不会冒泡到宿主 document；先把焦点交还
  // 给页面，再打开助手，避免把“助手未打开”误报成外壳切换丢失状态。
  await page.locator('body').click({position: {x: 8, y: 8}})
  await page.keyboard.press('Meta+j')
  const chat = page.getByRole('textbox', {name: '消息内容', exact: true})
  await chat.fill('尚未发送的助手草稿')
  await call('set_theme', {overrides: {main: '#8844cc'}})
  const variantId = (await active()).id
  await check('派生后待办输入 DOM 与未提交值保留', async () => {
    assert.ok(await inputNode.evaluate(el => el.isConnected))
    assert.equal(await input.inputValue(), '未提交的待办草稿')
  })
  await check('应用 canonical ID、iframe 与运行初始化次数保留', async () => {
    assert.ok(await runtimeNode.evaluate(el => el.isConnected))
    assert.ok(await iframeNode.evaluate(el => el.isConnected))
    assert.equal((await workspace()).applications.find(a => a.instance.title === '主题运行验收').id, applicationId)
    await frame.getByText('初始化 1', {exact: true}).waitFor()
    assert.equal(await frame.getByRole('textbox', {name: '应用草稿', exact: true}).inputValue(), '应用中的未保存文字')
  })
  await check('助手草稿与分栏保留', async () => {
    assert.equal(await chat.inputValue(), '尚未发送的助手草稿')
    await page.getByRole('separator', {name: '调整页面与 AI 面板宽度', exact: true}).waitFor()
  })
  await call('apply_theme', {ref})
  await call('apply_theme', {ref: variantId})
  await check('同外壳切换内置与变体保留所有运行 DOM', async () => {
    assert.ok(await inputNode.evaluate(el => el.isConnected))
    assert.ok(await iframeNode.evaluate(el => el.isConnected))
    assert.equal(await chat.inputValue(), '尚未发送的助手草稿')
  })
  await check('撤销重做使用相同身份且保留运行 DOM', async () => {
    // 走真实命令菜单，避免 Vite HMR 的动态 import 创建另一份 store 模块实例。
    await command('撤销上一步')
    assert.equal((await active()).id, ref)
    await command('重做上一步')
    assert.equal((await active()).id, variantId)
    assert.ok(await iframeNode.evaluate(el => el.isConnected))
  })
  await page.screenshot({path: `${out}/${scenario}-split.png`})
}

async function windowState() {
  await openFixture('win98-window')
  await call('install_addon', {id: 'desk'})
  await call('apply_theme', {ref: 'win98'})
  await command('书桌')
  await page.getByRole('button', {name: '最大化窗口', exact: true}).click()
  await call('set_theme', {overrides: {main: '#8844cc'}})
  await check('Win98 派生后最大化状态保留', async () => {
    assert.equal(await page.locator('.canvas').getAttribute('data-win98-maximized'), 'true')
    await page.getByRole('button', {name: '还原窗口', exact: true}).waitFor()
  })
  // 回到内置重新进入窗口，使基线丢失外壳不掩盖最小化的独立证据。
  await call('apply_theme', {ref: 'win98'})
  await command('书桌')
  await page.getByRole('button', {name: '最小化窗口', exact: true}).click()
  await call('set_theme', {overrides: {main: '#7733bb'}})
  await check('Win98 派生后最小化状态可恢复', async () => {
    assert.equal(await page.locator('.canvas').getAttribute('data-win98-desktop'), 'true')
    await page.getByRole('button', {name: '恢复书桌', exact: true}).click()
    assert.equal(await page.locator('.canvas').getAttribute('data-win98-desktop'), 'false')
  })
}

async function approvals() {
  await openFixture('approvals')
  await call('apply_theme', {ref: 'switch'})
  await call('add_page', {name: '审批夹具'})
  const pageId = (await workspace()).pages.find(p => p.name === '审批夹具').id
  await page.keyboard.press('Meta+j')
  for (const action of ['停止', '允许']) {
    await call('apply_theme', {ref: 'switch'})
    await page.evaluate(({pageId, action}) => {window.modelRequests = []; window.modelPlans = [{tools: [{id: `theme-${action}`, name: 'remove_page', args: {pageId}}]}, {text: '已完成审批验收。'}]}, {pageId, action})
    await page.getByRole('textbox', {name: '消息内容', exact: true}).fill('删除审批夹具')
    await page.getByRole('button', {name: '发送', exact: true}).click()
    await page.locator('.approval-card').waitFor()
    const approval = await page.locator('.approval-card').elementHandle()
    await call('set_theme', {overrides: {main: '#8844cc'}})
    await check(`派生时待决审批保留并能${action}`, async () => {
      assert.ok(await approval.evaluate(el => el.isConnected))
      await page.getByRole('button', {name: action, exact: true}).click()
      await page.getByRole('button', {name: '发送', exact: true}).waitFor()
      await page.locator('.approval-card').waitFor({state: 'detached'})
      const state = await workspace()
      assert.equal(state.pages.some(p => p.id === pageId), action === '停止')
      assert.equal(await page.evaluate(() => window.modelRequests.length), action === '停止' ? 1 : 2)
      if (action === '允许') await page.getByText('已完成审批验收。', {exact: true}).waitFor()
    })
  }
}

try {
  for (const ref of ['default', 'ios', 'pixel', 'switch', 'win98']) for (const width of [1440, 390]) {
    if (!filter || `${ref}-${width}`.includes(filter)) await check(`场景 ${ref}-${width}`, () => derivation(ref, width))
  }
  for (const ref of ['ios', 'pixel', 'switch', 'win98']) if (!filter || `lifecycle-${ref}`.includes(filter)) await check(`生命周期 ${ref}`, () => lifecycle(ref))
  if (!filter || 'win98-window'.includes(filter)) await check('窗口状态场景', windowState)
  if (!filter || 'approvals'.includes(filter)) await check('审批场景', approvals)
  await check('浏览器运行时没有未捕获异常', async () => assert.deepEqual(errors, []))
} finally {
  writeFileSync(`${out}/results.json`, JSON.stringify({base, results, errors, samples}, null, 2))
  await browser.close()
}
const failed = results.filter(r => !r.ok)
console.log(`${results.length - failed.length}/${results.length} 项通过；证据：${out}/results.json`)
if (failed.length) process.exitCode = 1
