import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {writeFile} from 'node:fs/promises'
import {routeBuiltinFixtures, seedBuiltinFixtures} from './browser-builtin-fixtures.mjs'

// 全新浏览器 context；所有远端数据与链接由 fixture 接管，不接触用户浏览器和真实存储。
const require = createRequire(import.meta.url)
const {chromium} = require(process.env.DADA_PLAYWRIGHT_PATH || 'playwright')
const base = (process.env.DADA_QA_URL || 'http://127.0.0.1:5175').replace(/\/$/, '')
const browser = await chromium.launch({headless: true})
const context = await browser.newContext({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce', timezoneId: 'Asia/Shanghai', hasTouch: true})
const errors = [], samples = [], colors = [], focusSamples = []
const cases = [
  {label: '热榜', slug: 'hot', target: '.hot-grid li a'},
  {label: '订阅', slug: 'feeds', target: '.feed-card'},
  {label: '书签', slug: 'bookmarks', target: '.mark-link'},
  {label: '书桌', slug: 'desk', target: '.note-area'},
  {label: '日历', slug: 'calendar', target: '.cd-row'},
  {label: '专注', slug: 'focus', target: '.pomo-stats'},
  {label: '音乐', slug: 'music', target: '.music-row'},
  {label: '天气', slug: 'weather', target: '.weather-card'},
  {label: '控制面板', slug: 'settings', target: '.settings-page textarea'},
  {label: '组件市场', slug: 'market', target: '.catalog-open'},
]

try {
  await context.addInitScript(() => {
    if (window !== window.top) return
    localStorage.setItem('fp.assistantPanelMode', JSON.stringify('split'))
    localStorage.setItem('fp.sidebarAi', JSON.stringify('split'))
  })
  await routeBuiltinFixtures(context, base)
  await context.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType: 'text/css', body: ''}))
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(base, {waitUntil: 'domcontentloaded'})
  await page.locator('.app').waitFor({state: 'attached'})
  await page.waitForFunction(() => window.__tada?.workspace())
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const call = async (name, args) => {
    const result = await page.evaluate(({name, args}) => window.__tada.call(name, args), {name, args})
    assert.ok(typeof result !== 'string' || !/^(没有成功|没有工具)/.test(result), `${name}: ${result}`)
    await settle(); return result
  }
  const snapshot = async name => {
    await page.evaluate(() => {if (document.activeElement instanceof HTMLElement) document.activeElement.blur()})
    await page.mouse.move(0, 0); await settle()
    await page.screenshot({path: `/tmp/dada-win98-${name}.png`})
  }
  const measure = async (label, target) => {
    const end = page.locator(target).last()
    await end.waitFor(); await end.scrollIntoViewIfNeeded()
    await end.evaluate(element => {
      for (let parent = element.parentElement; parent && !parent.classList.contains('canvas'); parent = parent.parentElement) {
        if (parent.scrollHeight > parent.clientHeight && /auto|scroll/.test(getComputedStyle(parent).overflowY)) parent.scrollTop = parent.scrollHeight
      }
    })
    await settle()
    const sample = await page.evaluate(({label, target}) => {
      const rect = element => {const r = element.getBoundingClientRect(); return {left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height}}
      const canvas = document.querySelector('.canvas'), root = canvas.querySelector('.page'), last = [...root.querySelectorAll(target)].at(-1)
      const end = rect(last), bounds = rect(root), canvasBox = rect(canvas)
      const clips = [bounds, canvasBox, {left: 0, top: 0, right: innerWidth, bottom: innerHeight}]
      for (let parent = last.parentElement; parent && parent !== canvas; parent = parent.parentElement) if (/auto|scroll|hidden|clip/.test(getComputedStyle(parent).overflowY)) clips.push(rect(parent))
      const visible = {left: Math.max(...clips.map(r => r.left)), right: Math.min(...clips.map(r => r.right)), top: Math.max(...clips.map(r => r.top)), bottom: Math.min(...clips.map(r => r.bottom))}
      const hit = document.elementFromPoint(end.left + Math.min(end.width / 2, 100), end.bottom - 2)
      return {label, canvas: canvasBox, root: bounds, end, visible, overflow: root.scrollWidth - root.clientWidth, documentOverflow: document.documentElement.scrollWidth - innerWidth, hittable: last.contains(hit)}
    }, {label, target})
    samples.push(sample)
    assert.ok(sample.overflow <= 1 && sample.documentOverflow <= 1, `${label}: 横向溢出 ${JSON.stringify(sample)}`)
    assert.ok(sample.end.left >= sample.visible.left - 1 && sample.end.right <= sample.visible.right + 1 && sample.end.top >= sample.visible.top - 1 && sample.end.bottom <= sample.visible.bottom + 1 && sample.hittable, `${label}: 末项未完整露出或被覆盖 ${JSON.stringify(sample)}`)
  }
  const theme = await page.evaluate(() => window.__tada.workspace().themes.find(theme => theme.id === 'win98'))
  assert.ok(theme?.builtin, 'Windows 98 注册为内置主题')
  assert.equal(theme.name, 'Windows 98')
  await call('apply_theme', {ref: 'win98'})
  await page.waitForFunction(() => document.documentElement.dataset.skin === 'win98')
  const desktop = page.getByRole('region', {name: 'Windows 98 桌面', exact: true})
  const taskbar = page.getByRole('navigation', {name: '任务栏', exact: true})
  const start = taskbar.getByRole('button', {name: '开始菜单', exact: true})
  const menu = page.getByRole('menu', {name: '开始', exact: true})
  const titlebar = page.locator('.win98-titlebar')
  const open = async label => {
    await start.click(); await menu.waitFor()
    await menu.getByRole('menuitem', {name: label, exact: true}).click()
    await menu.waitFor({state: 'hidden'}); await settle()
  }
  const showDesktop = async () => {await taskbar.getByRole('button', {name: '显示桌面', exact: true}).click(); await desktop.waitFor()}
  const assertShell = async label => {
    const geometry = await page.evaluate(() => {
      const rect = e => {const b = e.getBoundingClientRect(); return {left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height}}
      const canvas = document.querySelector('.canvas'), dock = document.querySelector('.win98-taskbar'), title = document.querySelector('.win98-titlebar')
      return {canvas: rect(canvas), taskbar: rect(dock), title: title && rect(title), overflow: canvas.scrollWidth - canvas.clientWidth, documentOverflow: document.documentElement.scrollWidth - innerWidth}
    })
    assert.ok(geometry.overflow <= 1 && geometry.documentOverflow <= 1, `${label}: 桌面横向溢出 ${JSON.stringify(geometry)}`)
    assert.ok(geometry.taskbar.left >= geometry.canvas.left - 1 && geometry.taskbar.right <= geometry.canvas.right + 1 && geometry.taskbar.bottom <= geometry.canvas.bottom + 1, `${label}: 任务栏必须留在实际画布内`)
    if (geometry.title?.width) assert.ok(geometry.title.left >= geometry.canvas.left - 1 && geometry.title.right <= geometry.canvas.right + 1 && geometry.title.bottom <= geometry.taskbar.top, `${label}: 窗口标题栏在画布范围内`)
  }
  await desktop.waitFor(); await assertShell('初始空桌面')
  await snapshot('empty')
  await seedBuiltinFixtures(page, call)
  await call('create_applet', {title: '窗口验收应用', source: 'applet({state:{},view:()=>ui.Text({text:"Win98 应用内容可用"})})'})
  const appId = await page.evaluate(() => window.__tada.workspace().applications.find(app => app.instance.title === '窗口验收应用').id)
  await call('configure_application', {ref: appId, dock: true, openMode: 'page'})

  // 开始菜单是真实可操作的导航，键盘退出/方向键与外点收起都保留。
  await start.click(); await menu.waitFor()
  for (const label of ['热榜', '订阅', '书桌', '日历', '专注', '控制面板', '组件市场', '窗口验收应用']) assert.equal(await menu.getByRole('menuitem', {name: label, exact: true}).count(), 1)
  await snapshot('start-menu')
  const firstItem = menu.getByRole('menuitem').first()
  await firstItem.focus(); await page.keyboard.press('ArrowDown')
  assert.ok(await menu.getByRole('menuitem').nth(1).evaluate(element => element === document.activeElement), '开始菜单方向键移动焦点')
  await page.keyboard.press('Escape'); await menu.waitFor({state: 'hidden'})
  assert.ok(await start.evaluate(element => element === document.activeElement), 'Esc回到开始按钮')
  await start.click(); await menu.waitFor(); await page.mouse.click(1300, 80); await menu.waitFor({state: 'hidden'})

  const hotIcon = desktop.getByRole('button', {name: '热榜', exact: true})
  await hotIcon.focus(); await hotIcon.press('Enter')
  await page.locator('.hot-grid li a').first().waitFor(); await titlebar.waitFor()
  await titlebar.getByRole('button', {name: '关闭窗口', exact: true}).click(); await desktop.waitFor()
  await desktop.getByRole('button', {name: '书桌', exact: true}).dblclick()
  const todoInput = page.getByPlaceholder('添一件待办，回车确认')
  const note = page.getByPlaceholder('随手记下什么，AI 也可以往这里写。')
  await todoInput.fill('最小化后保留未提交草稿')
  await note.fill('窗口恢复后保留便签内容')
  const todoNode = await todoInput.elementHandle(), noteNode = await note.elementHandle()
  await titlebar.getByRole('button', {name: '最小化窗口', exact: true}).click(); await desktop.waitFor()
  await taskbar.getByRole('button', {name: '恢复书桌', exact: true}).click()
  assert.ok(await todoNode.evaluate(element => element.isConnected), '最小化不卸载输入DOM')
  assert.ok(await noteNode.evaluate(element => element.isConnected), '最小化不卸载便签DOM')
  assert.equal(await todoInput.inputValue(), '最小化后保留未提交草稿')
  assert.equal(await note.inputValue(), '窗口恢复后保留便签内容')
  await taskbar.getByRole('button', {name: '最小化书桌', exact: true}).click(); await desktop.waitFor()
  await taskbar.getByRole('button', {name: '恢复书桌', exact: true}).click()
  const beforeMax = await page.locator('.canvas .page').boundingBox()
  await titlebar.getByRole('button', {name: '最大化窗口', exact: true}).click()
  await page.waitForFunction(() => document.querySelector('.canvas').dataset.win98Maximized === 'true')
  const afterMax = await page.locator('.canvas .page').boundingBox()
  assert.ok(afterMax.width > beforeMax.width || afterMax.height > beforeMax.height, '最大化真实扩大窗口')
  await titlebar.getByRole('button', {name: '还原窗口', exact: true}).click()
  assert.ok(await todoNode.evaluate(element => element.isConnected), '最大化/还原保留输入DOM')
  await titlebar.getByRole('button', {name: '关闭窗口', exact: true}).click(); await desktop.waitFor()
  assert.equal(await taskbar.locator('.win98-task-current').count(), 0, '关闭窗口移除当前任务入口')
  await open('窗口验收应用')
  await page.getByText('Win98 应用内容可用', {exact: true}).waitFor()
  await titlebar.getByRole('button', {name: '关闭窗口', exact: true}).click(); await desktop.waitFor()

  for (const viewport of [{width: 1440, height: 900}, {width: 390, height: 844}, {width: 320, height: 700}]) {
    await page.setViewportSize(viewport)
    for (const mode of ['light', 'dark']) {
      await call('set_theme', {mode}); await showDesktop(); await assertShell(`${viewport.width} ${mode} 桌面`)
      await snapshot(`desktop-${mode}-${viewport.width}`)
      colors.push(await page.evaluate(({mode, width}) => {
        const background = element => {for (let node = element; node; node = node.parentElement) {const value = getComputedStyle(node).backgroundColor; if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') return value} return 'transparent'}
        const dock = document.querySelector('.win98-taskbar')
        return {mode, width, desktop: background(document.querySelector('.win98-desktop')), face: background(dock), text: getComputedStyle(dock).color}
      }, {mode, width: viewport.width}))
      for (const item of cases) {
        await open(item.label)
        if (item.slug === 'market') await page.getByRole('tab', {name: /内置组件/}).click()
        if (item.slug === 'settings' && !await page.locator(item.target).last().isVisible()) await page.locator('.settings-nav').filter({hasText: '个人'}).click()
        if (item.slug === 'weather') await page.locator('.weather-temp').waitFor()
        await assertShell(`${viewport.width} ${mode} ${item.slug}`)
        await measure(`${viewport.width} ${mode} ${item.slug}`, item.target)
        await snapshot(`${item.slug}-${mode}-${viewport.width}-end`)
        await page.locator(item.target).last().evaluate(element => {for (let node = element.parentElement; node && !node.classList.contains('canvas'); node = node.parentElement) if (/auto|scroll/.test(getComputedStyle(node).overflowY)) node.scrollTop = 0})
        await snapshot(`${item.slug}-${mode}-${viewport.width}`)
        if (item.slug === 'settings' && viewport.width < 500) {
          await page.getByRole('button', {name: '返回设置列表', exact: true}).click()
          await page.locator('.settings-nav').filter({hasText: '个人'}).click()
          await page.getByRole('textbox', {name: '称呼', exact: true}).waitFor()
        }
      }
    }
  }
  const day = colors.find(c => c.mode === 'light'), night = colors.find(c => c.mode === 'dark')
  assert.notEqual(day.desktop, night.desktop, '桌面底色随亮暗模式变化')
  assert.notEqual(day.face, night.face, '任务栏表面随亮暗模式变化')
  assert.notEqual(day.text, night.text, '文字随亮暗模式变化')

  await showDesktop()
  await desktop.getByRole('button', {name: '日历', exact: true}).tap()
  const eventInput = page.getByRole('textbox', {name: '日程标题', exact: true})
  await eventInput.fill('Win98 手机日程')
  const calendarBounds = await page.locator('.cal-add').evaluate(form => {
    const panel = form.closest('.cal-day').getBoundingClientRect()
    return [...form.children].every(element => {const r = element.getBoundingClientRect(); return r.left >= panel.left && r.right <= panel.right})
  })
  assert.ok(calendarBounds, '日历标题、时间、添加控件外框都留在面板内')
  await page.locator('.cal-add').getByRole('button', {name: '添加', exact: true}).click()
  assert.ok((await call('list_events', {})).includes('Win98 手机日程'), '手机触摸打开日历并实际添加日程')
  await open('专注')
  await page.locator('.pomo').getByRole('button', {name: '开始专注', exact: true}).click()
  await page.locator('.pomo').getByRole('button', {name: '暂停', exact: true}).click()
  await page.locator('.pomo').getByText('已暂停', {exact: true}).waitFor()
  await page.locator('.pomo').getByRole('button', {name: '放弃这一段', exact: true}).click()

  await page.setViewportSize({width: 1440, height: 900}); await open('控制面板')
  for (const mode of ['light', 'dark']) {
    await call('set_theme', {mode})
    for (const name of ['称呼', '身份', '备注']) {
      const input = page.getByRole('textbox', {name, exact: true})
      await input.scrollIntoViewIfNeeded(); await input.focus(); await page.keyboard.press('Shift'); await settle()
      const sample = await input.evaluate(element => {
        const chain = []; for (let node = element; node && !node.classList.contains('ios-card'); node = node.parentElement) {const css = getComputedStyle(node); chain.push({tag: node.tagName, outlineStyle: css.outlineStyle, outlineWidth: css.outlineWidth})}
        const overlay = document.querySelector('[data-lobe-global-focus-ring]')
        return {chain, globalRing: !!overlay && overlay.matches(':popover-open') && overlay.getBoundingClientRect().width > 0}
      })
      focusSamples.push({mode, name, ...sample})
      const outlines = sample.chain.filter(node => node.outlineStyle !== 'none' && Number.parseFloat(node.outlineWidth) > 0)
      assert.equal(outlines.length + Number(sample.globalRing), 1, `${mode} ${name}: 输入仅有一层焦点框 ${JSON.stringify(sample)}`)
    }
  }
  await page.locator('.settings-nav').filter({hasText: '外观'}).click()
  const appearance = page.locator('.ios-detail')
  await appearance.getByText('浅色', {exact: true}).click()
  assert.equal(await page.evaluate(() => window.__tada.workspace().theme.mode), 'light')
  await appearance.getByText('深色', {exact: true}).click()
  assert.equal(await page.evaluate(() => window.__tada.workspace().theme.mode), 'dark')
  await page.reload({waitUntil: 'domcontentloaded'})
  await page.locator('.app').waitFor({state: 'attached'})
  await page.waitForFunction(() => window.__tada?.workspace())
  assert.equal(await page.evaluate(() => window.__tada.workspace().theme.active), 'win98')
  assert.equal(await page.evaluate(() => window.__tada.workspace().theme.mode), 'dark')
  await desktop.waitFor(); await snapshot('refresh-dark')
  await call('apply_theme', {ref: 'ios'})
  assert.equal(await page.locator('.win98-desktop, .win98-taskbar, .win98-titlebar').count(), 0, '切其他主题不残留Win98外壳')
  assert.equal(await page.evaluate(() => document.documentElement.dataset.skin), 'ios')
  await call('apply_theme', {ref: 'win98'}); await desktop.waitFor()

  // 保留应用配置的独立窗口形态；窗口层使用任务栏上方的实际可用区域。
  await call('configure_application', {ref: appId, openMode: 'modal'})
  const assertFloating = async label => {
    const sample = await page.evaluate(label => {
      const rect = e => {const b = e.getBoundingClientRect(); return {left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height}}
      const window = document.querySelector('.application-floating-window'), start = document.querySelector('.win98-start'), startRect = rect(start)
      return {label, canvas: rect(document.querySelector('.canvas')), layer: rect(document.querySelector('.application-window-layer')), window: rect(window), taskbar: rect(document.querySelector('.win98-taskbar')), startHittable: start.contains(document.elementFromPoint(startRect.left + startRect.width / 2, startRect.top + startRect.height / 2))}
    }, label)
    assert.ok(sample.window.left >= sample.canvas.left - 1 && sample.window.right <= sample.canvas.right + 1 && sample.window.top >= sample.canvas.top - 1 && sample.window.bottom <= sample.taskbar.top + 1, `${label}: 独立应用窗口超出画布或盖住任务栏 ${JSON.stringify(sample)}`)
    assert.ok(sample.layer.bottom <= sample.taskbar.top + 1 && sample.startHittable, `${label}: 应用窗口层遮挡任务栏`)
    samples.push(sample)
  }
  for (const viewport of [{width: 1440, height: 900}, {width: 390, height: 844}, {width: 320, height: 700}]) {
    await page.setViewportSize(viewport); await showDesktop(); await open('窗口验收应用')
    const floating = page.getByRole('dialog', {name: '窗口验收应用', exact: true})
    await floating.getByText('Win98 应用内容可用', {exact: true}).waitFor()
    await assertFloating(`${viewport.width} 独立应用`)
    if (viewport.width > 760) {
      const runtimeNode = await floating.locator('.application-runtime').elementHandle()
      await floating.getByRole('button', {name: '最大化应用', exact: true}).click(); await assertFloating('桌面独立应用最大化')
      await floating.getByRole('button', {name: '还原窗口', exact: true}).click()
      await floating.getByRole('button', {name: '最小化应用', exact: true}).click(); await floating.waitFor({state: 'hidden'})
      await page.locator('.application-minimized-window').getByRole('button', {name: '恢复窗口验收应用', exact: true}).click()
      await floating.waitFor(); assert.ok(await runtimeNode.evaluate(element => element.isConnected), '独立应用最小化保留运行DOM')
      await assertFloating('桌面独立应用恢复')
    }
    await snapshot(`application-window-${viewport.width}`)
    await floating.getByRole('button', {name: '关闭应用', exact: true}).click(); await floating.waitFor({state: 'hidden'})
  }

  await page.setViewportSize({width: 1440, height: 900})
  await open('热榜'); await open('搭搭')
  const divider = page.getByRole('separator', {name: '调整页面与 AI 面板宽度'})
  await divider.waitFor(); await divider.focus(); await divider.press('Home'); await settle()
  await assertShell('AI窄分栏')
  assert.ok((await page.locator('.canvas').boundingBox()).width < 800, 'AI分栏实际缩窄画布')
  await measure('AI分栏 热榜', '.hot-grid li a'); await snapshot('split-hot')

  assert.deepEqual(errors, [], 'Win98 页面没有浏览器运行异常')
  await writeFile('/tmp/dada-win98-browser-report.json', JSON.stringify({errors, samples, colors, focusSamples}, null, 2))
  console.log(`通过：Windows 98 主题 ${samples.length} 个布局场景及桌面/开始菜单/窗口/内容交互`)
} catch (error) {
  await context.pages()[0]?.screenshot({path: '/tmp/dada-win98-failure.png'})
  await writeFile('/tmp/dada-win98-browser-report.json', JSON.stringify({errors, samples, colors, focusSamples}, null, 2))
  throw error
} finally {await context.close(); await browser.close()}
