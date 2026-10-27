import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require = createRequire(import.meta.url)
const {chromium} = require(process.env.DADA_PLAYWRIGHT_PATH || 'playwright')
const base = (process.env.DADA_QA_URL || 'http://127.0.0.1:5175').replace(/\/$/, '')
const browser = await chromium.launch({headless: true})
const context = await browser.newContext({viewport: {width: 492, height: 636}, reducedMotion: 'reduce'})
const errors = [], samples = []
try {
  // A fresh browser context owns all test storage; the user's browser is never attached.
  await context.addInitScript(() => localStorage.setItem('fp.assistantPanelMode', JSON.stringify('split')))
  await context.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort())
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(base + '/', {waitUntil: 'domcontentloaded'})
  await page.waitForFunction(() => window.__tada?.workspace())
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const call = async (name, args) => {
    const result = await page.evaluate(({name, args}) => window.__tada.call(name, args), {name, args})
    assert.ok(typeof result !== 'string' || !result.startsWith('没有成功'), String(result))
    await settle()
    return result
  }
  const atBottom = async (selector = '.canvas > .page', links = '.quick-link', hitTest = true) => {
    await page.locator(selector).evaluate(element => {element.scrollTop = element.scrollHeight})
    await settle()
    return page.evaluate(({selector, links, hitTest}) => {
      const root = document.querySelector(selector)
      const last = [...root.querySelectorAll(links)].at(-1)
      const dock = document.querySelector('.dock')
      const rect = element => {const r = element.getBoundingClientRect(); return {top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height}}
      const link = rect(last), dockBox = rect(dock), rootBox = rect(root)
      const dockOverlapsX = link.left < dockBox.right && link.right > dockBox.left
      const visibleBottom = Math.min(innerHeight, rootBox.bottom, dockOverlapsX ? dockBox.top : rootBox.bottom)
      const point = {x: (link.left + link.right) / 2, y: link.bottom - 2}
      const hit = document.elementFromPoint(point.x, point.y)
      return {root: rootBox, link, dock: dockBox, visibleBottom, scrollTop: root.scrollTop, scrollHeight: root.scrollHeight, clientHeight: root.clientHeight, horizontalOverflow: root.scrollWidth - root.clientWidth, hittable: !hitTest || last.contains(hit), viewportHeight: innerHeight, padding: getComputedStyle(root).paddingBottom, hit: hit?.outerHTML.slice(0, 300), point}
    }, {selector, links, hitTest})
  }
  const assertReachable = (sample, label) => {
    assert.ok(sample.root.top >= -1 && sample.root.bottom <= sample.viewportHeight + 1, label + ':页面滚动区域位于可视窗口内')
    assert.ok(sample.horizontalOverflow <= 1, label + ':页面没有横向溢出')
    assert.ok(sample.scrollTop >= sample.scrollHeight - sample.clientHeight - 1, label + ':确实滚动到底')
    assert.ok(sample.link.bottom <= sample.visibleBottom + 1, `${label}:末尾内容被遮挡 ${JSON.stringify(sample)}`)
    assert.ok(sample.link.top >= sample.root.top - 1, label + ':末尾链接完整可见')
    assert.equal(sample.hittable, true, label + ':末尾链接底边命中链接，不命中Dock ' + JSON.stringify(sample))
  }

  // Unsectioned default home keeps the established one-screen layout and its wrappers.
  const original = await page.evaluate(() => window.__tada.workspace().pages.find(p => p.id === 'home'))
  for (const width of [320, 375, 492, 760, 761, 768, 980, 981, 1440]) {
    await page.setViewportSize({width, height: 900}); await settle()
    const legacy = await page.locator('.canvas > .page').evaluate(root => {
      const wrap = root.firstElementChild
      return {types: [...root.querySelectorAll('.widget')].map(e => e.dataset.type), height: wrap.style.height, childHeight: wrap.firstElementChild.style.height, overflow: root.scrollWidth - root.clientWidth}
    })
    assert.deepEqual(legacy.types, ['clock', 'search', 'links'])
    assert.equal(legacy.height, '100%'); assert.equal(legacy.childHeight, '100%')
    assert.ok(legacy.overflow <= 1)
    assertReachable(await atBottom(), `旧首页${width}px`)
  }
  assert.deepEqual(await page.evaluate(() => window.__tada.workspace().pages.find(p => p.id === 'home')), original, 'resize不修改首页配置')

  await call('install_addon', {id: 'desk'})
  await call('install_addon', {id: 'calendar'})
  await call('add_component', {pageId: 'home', type: 'todos'})
  await call('add_component', {pageId: 'home', type: 'agenda'})
  const sections = await page.evaluate(() => {
    const components = window.__tada.workspace().pages.find(p => p.id === 'home').components
    const id = type => components.find(c => c.type === type).id
    return [{id: 'hero', kind: 'hero', items: [id('clock'), id('search')], align: 'center'}, {id: 'work', kind: 'split', primary: [id('todos')], secondary: [id('agenda')], ratio: 'wide-primary'}, {id: 'links', kind: 'section', items: [id('links')], columns: 1}]
  })
  await call('set_page_sections', {pageId: 'home', sections})
  const input = page.locator('.canvas > .page .widget[data-type="todos"] input').first()
  await input.fill('滚动与改版后保留未提交输入')
  const originalNode = await input.elementHandle()
  // The reporter's viewport and component mix: without the production fix this assertion fails.
  await page.setViewportSize({width: 492, height: 636}); await settle()
  const first = await atBottom()
  assertReachable(first, '492×636真实首页')
  samples.push({label: '492×636', ...first})
  await page.screenshot({path: '/tmp/dada-page-mobile-after.png'})

  for (const width of [320, 375, 492, 760, 761, 768, 980, 981, 1440]) {
    await page.setViewportSize({width, height: 636}); await settle()
    for (const mode of ['light', 'dark']) {
      await call('set_theme', {mode})
      const before = await page.evaluate(() => JSON.stringify(window.__tada.workspace()))
      const sample = await atBottom()
      assertReachable(sample, `${width}px ${mode}`)
      assert.equal(await originalNode.evaluate(element => element.isConnected), true, 'resize与主题不重建输入DOM')
      assert.equal(await input.inputValue(), '滚动与改版后保留未提交输入')
      assert.equal(await page.evaluate(() => JSON.stringify(window.__tada.workspace())), before, '滚动不修改配置')
      samples.push({label: `${width}px ${mode}`, ...sample})
    }
  }
  // Enter and leave the natural-height mode without remounting business content.
  await call('set_page_sections', {pageId: 'home', sections: null})
  await call('set_page_sections', {pageId: 'home', sections})
  assert.equal(await originalNode.evaluate(element => element.isConnected), true)
  assert.equal(await input.inputValue(), '滚动与改版后保留未提交输入')

  await page.getByRole('button', {name: '打开搭搭助手', exact: true}).click()
  const divider = page.getByRole('separator', {name: '调整页面与 AI 面板宽度'})
  await divider.focus(); await divider.press('Home'); await settle()
  const split = await atBottom()
  assert.ok(split.root.width < 720, '桌面窗口内确实使用窄AI分栏')
  assertReachable(split, '桌面AI窄栏')
  samples.push({label: 'AI窄栏', ...split})

  // Preview has no FxLayers wrapper, but shares .page, Dock clearance and grid rules.
  const draft = JSON.parse(await call('create_homepage_draft', {recipeId: 'minimal'}))
  await call('update_homepage_draft', {draftId: draft.id, expectedRevision: draft.revision, sections})
  for (const width of [320, 492, 1440]) {
    await page.setViewportSize({width, height: 900}); await settle()
    const sample = await atBottom('.homepage-draft-page', '.quick-link', false)
    assertReachable(sample, `草稿${width}px`)
  }
  await page.getByRole('region', {name: '首页布局预览'}).getByRole('button', {name: '取消', exact: true}).click()
  assert.equal(await originalNode.evaluate(element => element.isConnected), true)

  // Exercise a real system page; it retains its own flex/scroll contract.
  await page.setViewportSize({width: 492, height: 900}); await settle()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Meta+k')
  await page.getByRole('button', {name: '组件市场', exact: true}).click()
  const market = page.locator('.canvas > .page.sys-view')
  await market.waitFor()
  await page.getByRole('tab', {name: /内置组件/}).click()
  for (const width of [320, 375, 492, 760, 761, 768, 980, 981, 1440]) {
    await page.setViewportSize({width, height: 900}); await settle()
    const system = await atBottom('.canvas > .page.sys-view', '#catalog-components .catalog-row:last-child button:last-child')
    assertReachable(system, `组件市场${width}px`)
  }
  assert.equal(await market.evaluate(element => getComputedStyle(element).display), 'flex')
  assert.deepEqual(errors, [], '无浏览器运行异常')
  console.log('通过：真实App末尾链接的滚动到底几何和命中、五宽及四断点边界双主题、AI窄栏、输入DOM存活、旧首页、草稿与系统页')
  console.log(JSON.stringify(samples.map(({label, link, dock, root, scrollHeight, scrollTop}) => ({label, width: root.width, linkBottom: link.bottom, dockTop: dock.top, scrollHeight, scrollTop})), null, 2))
} finally {await context.close(); await browser.close()}
