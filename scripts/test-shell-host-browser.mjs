import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdirSync, writeFileSync} from 'node:fs'
import {routeBuiltinFixtures} from './browser-builtin-fixtures.mjs'

// 仅使用真实 App、公开工具和真实导航；独立 context，不接触真实用户数据或模型。
const require = createRequire(import.meta.url)
const {chromium} = require(process.env.DADA_PLAYWRIGHT_PATH || 'playwright')
const base = (process.env.DADA_QA_URL || 'http://127.0.0.1:5198').replace(/\/$/, '')
const out = process.env.DADA_QA_OUTPUT || '/tmp/dada-shell-host-browser'
const filter = process.env.DADA_QA_FILTER || ''
mkdirSync(out, {recursive: true})
const browser = await chromium.launch({headless: true})
const results = [], errors = []
let page, context, scenario
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
const ws = () => page.evaluate(() => window.__tada.workspace())
const call = async (name, args = {}) => {
  const result = await page.evaluate(({name, args}) => window.__tada.call(name, args), {name, args})
  await settle()
  return result
}
async function check(name, run) {
  try {await run(); results.push({scenario, name, ok: true}); console.log(`通过：${scenario} ${name}`)}
  catch (error) {
    results.push({scenario, name, ok: false, error: error.message})
    console.error(`失败：${scenario} ${name}: ${error.message}`)
    await page?.screenshot({path: `${out}/${scenario}-${results.length}-failure.png`, fullPage: true}).catch(() => {})
  }
}
async function ready() {
  await page.locator('.app').waitFor({state: 'attached'})
  await page.waitForFunction(() => window.__tada?.workspace())
}
async function fixture(name, width = 1440, mode = 'light') {
  await context?.close()
  scenario = name
  context = await browser.newContext({viewport: {width, height: 960}, reducedMotion: 'reduce'})
  await routeBuiltinFixtures(context, base)
  await context.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType: 'text/css', body: ''}))
  await context.addInitScript(() => {
    if (window !== window.top) return
    localStorage.setItem('fp.assistantPanelMode', '"split"')
    localStorage.setItem('fp.sidebarAi', '"split"')
    window.modelPlans = []; window.modelRequests = []
    const fetchOriginal = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      if (!String(input).includes('/__shell_model__/')) return fetchOriginal(input, init)
      window.modelRequests.push(JSON.parse(init.body))
      const plan = window.modelPlans.shift()
      if (!plan) throw new Error('外壳验收模型出现额外请求')
      const encoder = new TextEncoder()
      const delta = plan.tools ? {tool_calls: plan.tools.map((tool, index) => ({index, id: tool.id, type: 'function', function: {name: tool.name, arguments: JSON.stringify(tool.args)}}))} : {content: plan.text}
      return new Response(new ReadableStream({start(controller) {
        for (const chunk of [{choices: [{index: 0, delta, finish_reason: null}]}, {choices: [{index: 0, delta: {}, finish_reason: plan.tools ? 'tool_calls' : 'stop'}]}]) controller.enqueue(encoder.encode('data: ' + JSON.stringify(chunk) + '\n\n'))
        controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close()
      }}), {headers: {'content-type': 'text/event-stream'}})
    }
  })
  page = await context.newPage(); page.setDefaultTimeout(7000)
  page.on('pageerror', error => errors.push({scenario, message: error.message}))
  await page.goto(base, {waitUntil: 'domcontentloaded'}); await ready()
  await page.evaluate(async () => {
    const {defaultSettings} = await import('/src/lib/defaults.ts')
    const settings = defaultSettings()
    settings.ai = {baseUrl: location.origin + '/__shell_model__/v1', apiKey: 'isolated-fixture', model: 'test-model', protocol: 'openai'}
    localStorage.setItem('fp.settings', JSON.stringify(settings))
  })
  await page.reload({waitUntil: 'domcontentloaded'}); await ready()
  await call('set_theme', {mode})
}
async function command(label) {
  await page.locator('body').click({position: {x: 8, y: 8}})
  await page.keyboard.press('Escape'); await page.keyboard.press('Meta+k')
  await page.locator('.cmdk-row').filter({has: page.locator('.cmdk-label', {hasText: new RegExp(`^${label}$`)})}).click()
  await settle()
}
async function cleanScreenshot(path) {
  await page.locator('.cmdk-row').first().waitFor({state: 'hidden'}).catch(() => {})
  // 命令面板退出动画不属于页面布局；截图等它结束，避免视觉QA误读淡出残影。
  await page.waitForTimeout(220)
  await page.screenshot({path})
}
async function desk() {
  await call('install_addon', {id: 'desk'}); await command('书桌')
  const input = page.getByPlaceholder('添一件待办，回车确认', {exact: true})
  await input.fill('跨外壳未提交输入')
  return {input, node: await input.elementHandle()}
}
async function crossShell() {
  await fixture('cross-shell')
  const {input, node} = await desk()
  await call('create_app', {title: '外壳运行验收', openMode: 'modal', html: '<output id="init"></output><input aria-label="应用草稿">', css: '', js: 'const count=(await tada.store.get("init-count")??0)+1;await tada.store.set("init-count",count);document.getElementById("init").textContent="初始化 "+count'})
  const id = (await ws()).applications.find(a => a.instance.title === '外壳运行验收').id
  await command('外壳运行验收')
  const runtime = page.locator(`.application-runtime[data-application="${id}"]`)
  const iframe = await runtime.locator('iframe').elementHandle()
  const frame = runtime.frameLocator('iframe.app-frame')
  await frame.getByText('初始化 1', {exact: true}).waitFor()
  await frame.getByRole('textbox', {name: '应用草稿', exact: true}).fill('应用未保存输入')
  await page.locator('body').click({position: {x: 8, y: 8}}); await page.keyboard.press('Meta+j')
  const chat = page.getByRole('textbox', {name: '消息内容', exact: true})
  await chat.fill('跨外壳助手草稿')
  for (const ref of ['switch', 'win98', 'ios']) {
    await call('apply_theme', {ref})
    await check(`${ref} 同路由保留页面输入 DOM 和未提交值`, async () => {
      assert.ok(await node.evaluate(el => el.isConnected), '原始页面输入仍连接')
      assert.equal(await input.inputValue(), '跨外壳未提交输入')
    })
    await check(`${ref} 保留应用身份 iframe 初始化次数与助手草稿`, async () => {
      assert.ok(await iframe.evaluate(el => el.isConnected), '原始应用 iframe 仍连接')
      await frame.getByText('初始化 1', {exact: true}).waitFor({state: 'attached'})
      assert.equal(await frame.getByRole('textbox', {name: '应用草稿', exact: true, includeHidden: true}).inputValue(), '应用未保存输入')
      assert.equal(await chat.inputValue(), '跨外壳助手草稿')
      assert.equal((await ws()).applications.find(a => a.instance.title === '外壳运行验收').id, id)
    })
  }
  await page.screenshot({path: `${out}/cross-shell-final.png`})
}
async function launcher() {
  await fixture('switch-launcher')
  await call('apply_theme', {ref: 'switch'})
  const {input, node} = await desk()
  await page.getByRole('button', {name: '返回主屏', exact: true}).click()
  await check('主屏隐藏页面而不销毁输入', async () => {
    assert.ok(await node.evaluate(el => el.isConnected), '返回主屏后原输入仍连接')
    assert.equal(await input.inputValue(), '跨外壳未提交输入')
    assert.ok(await node.evaluate(el => !!el.closest('[inert]')), '隐藏页面 inert')
  })
  await command('书桌')
  await check('同目标重复激活恢复输入与可交互舞台', async () => {
    assert.ok(await node.evaluate(el => el.isConnected))
    assert.equal(await input.inputValue(), '跨外壳未提交输入')
    assert.equal(await node.evaluate(el => !!el.closest('[inert]')), false)
    await input.fill('恢复后仍可编辑')
  })
}
async function minimized() {
  await fixture('win98-minimized')
  await call('apply_theme', {ref: 'win98'})
  const {input, node} = await desk()
  await page.getByRole('button', {name: '最小化窗口', exact: true}).click()
  await check('最小化保持内容且隐藏舞台 inert', async () => {
    assert.ok(await node.evaluate(el => el.isConnected))
    assert.ok(await node.evaluate(el => !!el.closest('[inert]')), '最小化内容 inert')
  })
  await command('书桌')
  await check('同目标命令恢复最小化窗口', async () => {
    assert.equal(await page.locator('.canvas').getAttribute('data-win98-desktop'), 'false')
    assert.ok(await node.evaluate(el => el.isConnected))
    assert.equal(await input.inputValue(), '跨外壳未提交输入')
  })
}
async function switchSettingsHeader() {
  await fixture('switch-settings-header')
  await call('apply_theme', {ref: 'switch'})
  await command('设置')
  await check('主机设置显示宽页报头并隐藏普通TopBar', async () => {
    await page.locator('.settings-page').waitFor()
    assert.equal(await page.locator('.topbar').evaluate(el => getComputedStyle(el).display), 'none')
    const header = page.locator('.console-settings-header')
    await header.waitFor()
    assert.notEqual(await header.evaluate(el => getComputedStyle(el).display), 'none')
  })
}
async function approval() {
  await fixture('cross-shell-approval')
  await call('add_page', {name: '外壳审批夹具'})
  const pageId = (await ws()).pages.find(p => p.name === '外壳审批夹具').id
  await page.keyboard.press('Meta+j')
  await page.evaluate(pageId => {window.modelPlans = [{tools: [{id: 'shell-approval', name: 'remove_page', args: {pageId}}]}]}, pageId)
  await page.getByRole('textbox', {name: '消息内容', exact: true}).fill('删除外壳审批夹具')
  await page.getByRole('button', {name: '发送', exact: true}).click()
  await page.locator('.approval-card').waitFor()
  const node = await page.locator('.approval-card').elementHandle()
  for (const ref of ['switch', 'win98', 'ios']) {
    await call('apply_theme', {ref})
    await check(`${ref} 待决审批仍连接且保持发送锁`, async () => {
      assert.ok(await node.evaluate(el => el.isConnected))
      await page.getByRole('button', {name: '停止', exact: true}).waitFor()
      assert.equal((await ws()).pages.some(p => p.id === pageId), true)
    })
  }
  await page.getByRole('button', {name: '停止', exact: true}).click()
  await page.locator('.approval-card').waitFor({state: 'detached'})
  await check('跨外壳后停止仍取消本轮且未执行', async () => assert.equal((await ws()).pages.some(p => p.id === pageId), true))
}

async function geometry(ref, mode, size) {
  const width = size === 'split' ? 1024 : size
  await fixture(`matrix-${ref}-${mode}-${size}`, width, mode)
  await call('apply_theme', {ref}); await call('set_theme', {mode})
  const {input, node} = await desk()
  if (size === 'split') {
    await page.locator('body').click({position: {x: 8, y: 8}})
    await page.keyboard.press('Meta+j')
    await page.getByRole('separator', {name: '调整页面与 AI 面板宽度', exact: true}).waitFor()
  }
  await check('可见舞台在真实画布中可输入、无横向溢出', async () => {
    assert.ok(await node.evaluate(el => el.isConnected))
    assert.equal(await node.evaluate(el => !!el.closest('[inert]')), false)
    await input.fill(`可交互 ${ref} ${mode} ${size}`)
    const measured = await page.locator('.canvas').evaluate(canvas => {
      const rect = canvas.getBoundingClientRect()
      return {width: rect.width, height: rect.height, overflow: canvas.scrollWidth - canvas.clientWidth, documentOverflow: document.documentElement.scrollWidth - innerWidth}
    })
    assert.ok(measured.width > 0 && measured.height > 0)
    assert.ok(measured.overflow <= 1, `画布横向溢出 ${JSON.stringify(measured)}`)
    assert.ok(measured.documentOverflow <= 1, `文档横向溢出 ${JSON.stringify(measured)}`)
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), mode)
  })
  if (ref !== 'ios') {
    await page.getByRole('button', {name: ref === 'switch' ? '返回主屏' : '最小化窗口', exact: true}).click()
    await check('隐藏舞台保留输入且 inert/aria 同步', async () => {
      assert.ok(await node.evaluate(el => el.isConnected))
      assert.ok(await node.evaluate(el => !!el.closest('[inert]')))
      assert.ok(await node.evaluate(el => !!el.closest('[aria-hidden="true"]')))
      assert.equal(await input.isVisible(), false)
    })
    await command('书桌')
    await check('同目标恢复实际输入与原节点', async () => {
      assert.ok(await node.evaluate(el => el.isConnected))
      assert.equal(await input.inputValue(), `可交互 ${ref} ${mode} ${size}`)
      assert.equal(await node.evaluate(el => !!el.closest('[inert]')), false)
      await input.fill('恢复后可编辑')
    })
  }
  if (size === 320 || size === 'split') await cleanScreenshot(`${out}/${scenario}.png`)
}
async function inspectorVisibility() {
  await fixture('inspector-visibility')
  await call('apply_theme', {ref: 'win98'})
  await desk()
  await page.locator('body').click({position: {x: 8, y: 8}}); await page.keyboard.press('Meta+j')
  const inspect = async () => {
    await page.evaluate(() => {window.modelRequests = []; window.modelPlans = [{tools: [{id: 'inspect-shell', name: 'inspect_page', args: {}}]}, {text: '页面检查夹具完成'}]})
    await page.getByRole('textbox', {name: '消息内容', exact: true}).fill('检查当前真实页面布局')
    await page.getByRole('button', {name: '发送', exact: true}).click()
    await page.waitForFunction(() => window.modelRequests.length === 2)
    await page.getByRole('button', {name: '发送', exact: true}).waitFor()
    return page.evaluate(() => {
      const messages = window.modelRequests[1].messages
      const message = [...messages].reverse().find(item => item.role === 'tool')
      return JSON.parse(typeof message.content === 'string' ? message.content : message.content.map(item => item.text || '').join(''))
    })
  }
  await check('真实Agent检查可见舞台返回当前页面几何', async () => {
    const report = await inspect()
    assert.equal(report.status, 'ok'); assert.equal(report.page.visible, true)
    assert.ok(report.page.viewport.width > 0)
  })
  await page.getByRole('button', {name: '最小化窗口', exact: true}).click()
  await check('真实Agent检查隐藏舞台明确拒绝测量', async () => {
    const report = await inspect()
    assert.equal(report.page.visible, false)
    assert.notEqual(report.status, 'ok')
    assert.ok(report.unknown.some(item => ['page-not-mounted', 'page-hidden', 'not-mounted'].includes(item.code)), JSON.stringify(report))
  })
}
async function win98ActivationMenu() {
  await fixture('win98-activation-menu')
  await call('apply_theme', {ref: 'win98'})
  await desk()
  await page.getByRole('button', {name: '开始菜单', exact: true}).click()
  await page.locator('.win98-start-menu').waitFor()
  // 数字快捷键调用宿主同一导航执行器；保持开始菜单内焦点，不用点击外部
  // 产生的自动关闭事件掩盖 activation revision 清理。
  await page.keyboard.press('2')
  await check('外部同目标成功激活关闭Win98开始菜单', async () => {
    await page.locator('.win98-start-menu').waitFor({state: 'hidden'})
    assert.equal(await page.locator('.canvas').getAttribute('data-win98-desktop'), 'false')
  })
}
async function backgroundPageRemoval() {
  await fixture('background-page-removal-settings')
  await desk()
  const deskId = (await ws()).pages.find(item => item.name === '书桌').id
  await page.locator('body').click({position: {x: 8, y: 8}}); await page.keyboard.press('Meta+,')
  await page.locator('.settings-page').waitFor()
  const settingsNode = await page.locator('.settings-page').elementHandle()
  const name = page.getByPlaceholder('朋友', {exact: true})
  await name.fill('设置中正在编辑')
  const inputNode = await name.elementHandle()
  await call('remove_page', {pageId: deskId})
  await check('后台页面删除不离开设置或重建设置输入', async () => {
    assert.ok(await settingsNode.evaluate(el => el.isConnected))
    assert.ok(await inputNode.evaluate(el => el.isConnected))
    assert.equal(await name.inputValue(), '设置中正在编辑')
    assert.equal((await ws()).pages.some(item => item.id === deskId), false)
  })
  for (const mode of ['modal', 'drawer', 'page']) {
    await fixture(`background-page-removal-${mode}`)
    await desk()
    const backgroundId = (await ws()).pages.find(item => item.name === '书桌').id
    const title = `后台删除${mode}应用`
    await call('create_app', {title, openMode: mode, html: '<output id="init"></output><input aria-label="后台删除应用输入">', css: '', js: 'const n=(await tada.store.get("init")??0)+1;await tada.store.set("init",n);document.getElementById("init").textContent="初始化 "+n'})
    const id = (await ws()).applications.find(item => item.instance.title === title).id
    await command(title)
    const runtime = page.locator(`.application-runtime[data-application="${id}"]`)
    const frame = runtime.frameLocator('iframe.app-frame')
    await frame.getByText('初始化 1', {exact: true}).waitFor()
    await frame.getByRole('textbox', {name: '后台删除应用输入', exact: true}).fill('后台删页仍保留')
    const iframe = await runtime.locator('iframe').elementHandle()
    await call('remove_page', {pageId: backgroundId})
    await check(`${mode} 活动应用在后台页面删除后保持iframe和初始化`, async () => {
      assert.ok(await iframe.evaluate(el => el.isConnected))
      await frame.getByText('初始化 1', {exact: true}).waitFor()
      assert.equal(await frame.getByRole('textbox', {name: '后台删除应用输入', exact: true}).inputValue(), '后台删页仍保留')
      assert.equal((await ws()).applications.find(item => item.id === id).id, id)
    })
  }
  await fixture('current-page-removal')
  await desk()
  const currentId = (await ws()).pages.find(item => item.name === '书桌').id
  await call('remove_page', {pageId: currentId})
  await check('当前展示页删除后成功回退首页', async () => {
    await page.locator('.page[data-page-id="home"]').waitFor()
    assert.equal(await page.getByPlaceholder('添一件待办，回车确认', {exact: true}).count(), 0)
  })
}
async function attachedOverlays() {
  await fixture('attached-overlays')
  await call('apply_theme', {ref: 'win98'})
  await desk()
  for (const mode of ['modal', 'drawer']) {
    const title = `外壳${mode}附着应用`
    await call('create_app', {title, openMode: mode, html: '<output id="init"></output><input aria-label="附着应用输入">', css: '', js: 'const n=(await tada.store.get("init")??0)+1;await tada.store.set("init",n);document.getElementById("init").textContent="初始化 "+n'})
    const id = (await ws()).applications.find(a => a.instance.title === title).id
    await command(title)
    const runtime = page.locator(`.application-runtime[data-application="${id}"]`)
    const iframe = await runtime.locator('iframe').elementHandle()
    const frame = runtime.frameLocator('iframe.app-frame')
    await frame.getByText('初始化 1', {exact: true}).waitFor()
    await frame.getByRole('textbox', {name: '附着应用输入', exact: true}).fill(`${mode}未提交应用输入`)
    await page.getByRole('button', {name: '最小化窗口', exact: true}).click()
    await check(`${mode} 外壳最小化保留运行且隐藏附着窗口`, async () => {
      assert.ok(await iframe.evaluate(el => el.isConnected))
      await frame.getByText('初始化 1', {exact: true}).waitFor({state: 'attached'})
      assert.equal(await runtime.isVisible(), false)
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Tab')
        assert.equal(await iframe.evaluate(el => el === document.activeElement || el.contains(document.activeElement)), false, '隐藏iframe不可聚焦')
      }
    })
    await page.locator('.win98-task-current').click()
    await check(`${mode} 恢复外壳保留输入和初始化次数`, async () => {
      await frame.getByText('初始化 1', {exact: true}).waitFor()
      assert.equal(await frame.getByRole('textbox', {name: '附着应用输入', exact: true}).inputValue(), `${mode}未提交应用输入`)
    })
    if (mode === 'modal') {
      await page.getByRole('button', {name: '最小化应用', exact: true}).click()
      await page.getByRole('button', {name: '最小化窗口', exact: true}).click()
      await page.locator('.win98-task-current').click()
      await check('应用自己最小化不被外壳恢复覆盖', async () => {
        assert.equal(await runtime.isVisible(), false)
        await page.getByRole('button', {name: `恢复${title}`, exact: true}).click()
        await frame.getByText('初始化 1', {exact: true}).waitFor()
      })
      await page.getByRole('button', {name: '关闭应用', exact: true}).click()
    }
  }
}

async function readerOverlay() {
  await fixture('reader-overlay')
  // 摘要只对正文足够的文章开放；本场景提供明确长正文，避免把产品的短文
  // 拒绝策略误判为摘要丢失。真实模型仍由本地 synthetic stream 接管。
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (!(url.searchParams.get('url') || url.href).includes('fixture.invalid/design.xml')) return route.fallback()
    const content = '<p>' + '这是一篇用于稳定阅读器生命周期验证的完整文章，讨论如何通过清晰的界面边界保留用户的阅读进度、摘要和未提交输入。'.repeat(12) + '</p>'
    return route.fulfill({contentType: 'application/rss+xml', body: `<?xml version="1.0"?><rss version="2.0"><channel><title>设计周刊</title><item><title>稳定阅读器生命周期夹具</title><link>https://fixture.invalid/long-article</link><guid>long-reader</guid><description><![CDATA[${content}]]></description></item></channel></rss>`})
  })
  await call('install_addon', {id: 'feeds'})
  await call('add_feed', {title: '设计周刊', url: 'https://fixture.invalid/design.xml'})
  await call('apply_theme', {ref: 'win98'})
  await command('订阅')
  await page.locator('.feed-card').first().click()
  const reader = page.locator('.reader')
  await reader.waitFor()
  const node = await reader.elementHandle()
  const title = await reader.locator('h1').textContent()
  await page.evaluate(() => {window.modelPlans = [{text: '外壳阅读摘要夹具'}]})
  await reader.getByRole('button', {name: 'AI 摘要', exact: true}).click()
  await reader.getByText('外壳阅读摘要夹具', {exact: true}).waitFor()
  await page.getByRole('button', {name: '最小化窗口', exact: true}).click()
  await check('阅读器随外壳隐藏但DOM与文章摘要保持', async () => {
    assert.ok(await node.evaluate(el => el.isConnected)); assert.equal(await reader.isVisible(), false)
    assert.equal(await node.evaluate(el => el.querySelector('h1')?.textContent), title)
    assert.ok(await node.evaluate(el => el.textContent?.includes('外壳阅读摘要夹具')))
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab')
      assert.equal(await node.evaluate(el => el.contains(document.activeElement)), false, '隐藏阅读器不可接收焦点')
    }
  })
  await page.locator('.win98-task-current').click()
  await check('恢复外壳显示同一阅读器与摘要', async () => {
    assert.ok(await node.evaluate(el => el.isConnected)); await reader.waitFor()
    assert.equal(await reader.locator('h1').textContent(), title)
    await reader.getByText('外壳阅读摘要夹具', {exact: true}).waitFor()
  })
  await page.keyboard.press('Meta+j')
  await page.getByRole('separator', {name: '调整页面与 AI 面板宽度', exact: true}).waitFor()
  await check('窄分栏阅读器与应用抽屉始终处于画布保留区内', async () => {
    const measure = () => page.locator('.attached-drawer').evaluate(drawer => {
      const canvas = drawer.closest('.canvas')
      const a = drawer.getBoundingClientRect(), b = canvas.getBoundingClientRect()
      const chrome = canvas.querySelector('.win98-titlebar')?.getBoundingClientRect()
      return {left: a.left, right: a.right, top: a.top, bottom: a.bottom, canvasLeft: b.left, canvasRight: b.right, canvasTop: b.top, canvasBottom: b.bottom, chromeBottom: chrome?.bottom || b.top}
    })
    let rect = await measure()
    assert.ok(rect.left >= rect.canvasLeft - 1 && rect.right <= rect.canvasRight + 1, JSON.stringify(rect))
    assert.ok(rect.top >= rect.chromeBottom - 1 && rect.bottom <= rect.canvasBottom + 1, JSON.stringify(rect))
    // 同一通用附着抽屉由Reader和应用复用；真实应用打开后再测一次。
    await page.locator('.attached-drawer').getByRole('button', {name: '关闭', exact: true}).click()
    await call('create_app', {title: '窄分栏抽屉', openMode: 'drawer', html: '<p>窄分栏抽屉内容</p>', css: '', js: ''})
    await command('窄分栏抽屉')
    await page.locator('.attached-drawer').waitFor()
    rect = await measure()
    assert.ok(rect.left >= rect.canvasLeft - 1 && rect.right <= rect.canvasRight + 1, JSON.stringify(rect))
    assert.ok(rect.top >= rect.chromeBottom - 1 && rect.bottom <= rect.canvasBottom + 1, JSON.stringify(rect))
  })
}
async function fourthAdapter() {
  await context?.close(); scenario = 'fourth-adapter'
  context = await browser.newContext({viewport: {width: 1440, height: 960}, reducedMotion: 'reduce'})
  await routeBuiltinFixtures(context, base)
  await context.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType: 'text/css', body: ''}))
  page = await context.newPage(); page.setDefaultTimeout(7000)
  page.on('pageerror', error => errors.push({scenario, message: error.message}))
  await page.goto(`${base}/tests/shell-host/index.html`, {waitUntil: 'domcontentloaded'})
  const input = page.getByRole('textbox', {name: '第四外壳未提交输入', exact: true, includeHidden: true})
  await input.fill('第四外壳原始输入')
  const inputNode = await input.elementHandle()
  const runtime = page.locator('.application-runtime')
  const iframeNode = await runtime.locator('iframe').elementHandle()
  const frame = runtime.frameLocator('iframe.app-frame')
  await frame.getByText('初始化 1', {exact: true}).waitFor()
  await frame.getByRole('textbox', {name: '第四外壳应用草稿', exact: true}).fill('第四外壳应用原始输入')
  const chat = page.getByRole('textbox', {name: '消息内容', exact: true})
  await chat.fill('第四外壳助手草稿')
  const chatNode = await chat.elementHandle()
  const approvalNode = await page.locator('.approval-card').elementHandle()
  const retained = async () => {
    assert.ok(await inputNode.evaluate(el => el.isConnected)); assert.equal(await input.inputValue(), '第四外壳原始输入')
    assert.ok(await iframeNode.evaluate(el => el.isConnected)); await frame.getByText('初始化 1', {exact: true}).waitFor({state: 'attached'})
    assert.equal(await frame.getByRole('textbox', {name: '第四外壳应用草稿', exact: true, includeHidden: true}).inputValue(), '第四外壳应用原始输入')
    assert.ok(await chatNode.evaluate(el => el.isConnected)); assert.equal(await chat.inputValue(), '第四外壳助手草稿')
    assert.ok(await approvalNode.evaluate(el => el.isConnected))
  }
  await check('第四Adapter注册、真实业务运行与重复ID拒绝', async () => {
    assert.match(await page.evaluate(() => window.shellProbe.duplicate), /重复.*test-fourth/)
    assert.equal(await page.locator('.canvas').getAttribute('data-shell'), 'test-fourth')
    await retained()
  })
  await page.getByRole('button', {name: '第四外壳隐藏恢复', exact: true}).click()
  await check('第四Adapter隐藏真实舞台且保留输入和运行器', async () => {
    await retained()
    assert.ok(await inputNode.evaluate(el => !!el.closest('[inert]')))
    assert.equal(await input.isVisible(), false)
  })
  await page.getByRole('button', {name: '第四外壳同目标', exact: true}).click()
  await check('第四Adapter同目标revision恢复真实舞台', async () => {
    await retained(); assert.equal(await input.isVisible(), true)
    assert.equal(await inputNode.evaluate(el => !!el.closest('[inert]')), false)
  })
  await page.getByRole('button', {name: '请求标准外壳', exact: true}).click()
  await page.evaluate(() => dispatchEvent(new Event('shell-fixture-event')))
  await check('不同hooks实现切换清理监听且不重挂业务', async () => {
    const probe = await page.evaluate(() => window.shellProbe)
    assert.equal(probe.cleanups, 1)
    assert.equal(probe.events.includes('fourth-event'), false)
    await retained()
  })
  await page.getByRole('button', {name: '请求第四外壳', exact: true}).click()
  await check('切回第四Adapter不触发hooks顺序错误', async () => {
    assert.equal(await page.evaluate(() => window.shellProbe.mounts), 2)
    await retained()
  })
  for (const fault of ['触发事件故障', '触发布局故障', '触发超界布局', '请求缺失Switch外壳', '请求缺失Win98外壳', '请求渲染故障']) {
    if (fault.startsWith('触发') && fault !== '触发事件故障') {
      await page.getByRole('button', {name: '重试桌面', exact: true}).click()
      await page.getByRole('button', {name: '第四外壳隐藏恢复', exact: true}).waitFor()
    }
    await page.getByRole('button', {name: fault, exact: true}).click()
    await page.getByRole('status', {name: '外壳恢复', exact: true}).waitFor()
    await check(`${fault}实际回落paper/standard并保持业务`, async () => {
      await retained()
      const data = await page.evaluate(() => ({skin: document.documentElement.dataset.skin || 'paper', shell: document.documentElement.dataset.shell, snapshot: window.shellProbe.snapshot, requested: window.shellProbe.requested}))
      assert.equal(data.skin, 'paper'); assert.equal(data.shell, 'standard')
      assert.ok(data.snapshot.fault); assert.equal(data.snapshot.activeSkin, 'paper')
      assert.notEqual(data.requested, 'standard')
      const canvas = await page.locator('.canvas').boundingBox()
      assert.ok(canvas && canvas.width > 300 && canvas.height > 300)
      const recovery = page.getByRole('status', {name: '外壳恢复', exact: true})
      await recovery.getByRole('button', {name: '打开设置', exact: true}).click()
      await page.locator('#fixture-status').filter({hasText: '设置:settings'}).waitFor()
      await recovery.getByRole('button', {name: '搭搭助手', exact: true}).click()
      await page.locator('#fixture-status').filter({hasText: '助手已打开'}).waitFor()
    })
  }
  await page.getByRole('status', {name: '外壳恢复', exact: true}).getByRole('button', {name: '停止', exact: true}).click()
  await check('故障回落下可信停止入口可实际执行', async () => {
    await page.locator('#fixture-status').filter({hasText: '停止已执行'}).waitFor()
    await retained()
  })
  await page.screenshot({path: `${out}/fourth-adapter-fallback.png`})
}
try {
  for (const [name, run] of [['cross-shell', crossShell], ['switch-launcher', launcher], ['win98-minimized', minimized], ['switch-settings-header', switchSettingsHeader], ['inspector-visibility', inspectorVisibility], ['win98-activation-menu', win98ActivationMenu], ['background-page-removal', backgroundPageRemoval], ['cross-shell-approval', approval], ['attached-overlays', attachedOverlays], ['reader-overlay', readerOverlay]]) if (!filter || name.includes(filter)) await check(`场景 ${name}`, run)
  if (!filter || filter.includes('matrix')) for (const ref of ['ios', 'switch', 'win98']) for (const mode of ['light', 'dark']) for (const size of [1440, 390, 320, 'split']) {
    if (!filter || `matrix-${ref}-${mode}-${size}`.includes(filter)) await check(`矩阵 ${ref}-${mode}-${size}`, () => geometry(ref, mode, size))
  }
  if (!filter || filter.includes('fourth')) await check('第四可信Adapter与故障回落', fourthAdapter)
  await check('浏览器无未捕获异常', async () => assert.deepEqual(errors, []))
} finally {
  writeFileSync(`${out}/results.json`, JSON.stringify({base, results, errors}, null, 2)); await browser.close()
}
const failed = results.filter(r => !r.ok)
console.log(`${results.length - failed.length}/${results.length} 项通过；证据：${out}/results.json`)
if (failed.length) process.exitCode = 1
