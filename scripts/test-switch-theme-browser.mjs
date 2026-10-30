import assert from 'node:assert/strict'
import {createRequire} from 'node:module'

const require = createRequire(import.meta.url)
const {chromium} = require(process.env.DADA_PLAYWRIGHT_PATH || 'playwright')
const base = (process.env.DADA_QA_URL || 'http://127.0.0.1:5175').replace(/\/$/, '')
const browser = await chromium.launch({headless: true})
// 独立浏览器与存储，不附着到用户正在使用的标签页。
const context = await browser.newContext({viewport: {width: 1280, height: 720}, reducedMotion: 'reduce'})
const errors = [], samples = [], focusSamples = []
try {
  await context.addInitScript(() => { localStorage.setItem('fp.assistantPanelMode', JSON.stringify('split')); localStorage.setItem('fp.sidebarAi', JSON.stringify('split')) })
  await context.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort())
  const page = await context.newPage()
  page.setDefaultTimeout(7000)
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(base + '/', {waitUntil: 'domcontentloaded'})
  await page.locator('.app').waitFor({state: 'attached'})
  await page.waitForFunction(() => window.__tada?.workspace())
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const snapshot = async name => {
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
    await page.mouse.move(0, 0); await settle()
    await page.screenshot({path: `/tmp/dada-switch-${name}.png`})
  }
  const call = async (name, args) => {
    const result = await page.evaluate(({name, args}) => window.__tada.call(name, args), {name, args})
    assert.ok(typeof result !== 'string' || !result.startsWith('没有成功'), String(result))
    await settle()
    return result
  }
  const dock = page.getByRole('navigation', {name: '主机菜单'})
  const home = page.getByRole('region', {name: '主机主屏'})
  const settings = async () => {await dock.getByRole('button', {name: '设置', exact: true}).click(); await page.locator('.settings-page').waitFor(); await settle()}
  const board = async () => {await dock.getByRole('button', {name: '主屏', exact: true}).click(); await home.waitFor(); await settle()}
  const geometry = () => page.evaluate(() => {
    const rect = e => {const r = e.getBoundingClientRect(); return {top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height}}
    const canvas = document.querySelector('.canvas'), dock = document.querySelector('.switch-dock')
    const art = document.querySelector('.switch-cover[data-on="true"] .switch-cover-art')
    const track = document.querySelector('.switch-covers')
    const result = {canvas: rect(canvas), dock: rect(dock), overflow: canvas.scrollWidth - canvas.clientWidth, bodyOverflow: document.documentElement.scrollWidth - innerWidth}
    if (art) {
      result.art = rect(art); result.track = rect(track)
      const css = getComputedStyle(art)
      result.ring = Number.parseFloat(css.outlineWidth) + Number.parseFloat(css.outlineOffset)
      const point = {x: result.art.left + result.art.width / 2, y: result.art.top + result.art.height / 2}
      result.hittable = art.contains(document.elementFromPoint(point.x, point.y))
    }
    return result
  })
  const assertGeometry = (sample, label) => {
    assert.ok(sample.overflow <= 1 && sample.bodyOverflow <= 1, `${label}:主画布横向溢出 ${JSON.stringify(sample)}`)
    assert.ok(sample.dock.left >= sample.canvas.left - 1 && sample.dock.right <= sample.canvas.right + 1, `${label}:菜单必须留在实际画布内`)
    assert.ok(sample.dock.bottom <= sample.canvas.bottom + 1, `${label}:底部操作条可见`)
    if (sample.art) {
      assert.ok(sample.art.bottom + sample.ring <= sample.dock.top + 1, `${label}:封面焦点框被菜单遮挡 ${JSON.stringify(sample)}`)
      assert.ok(sample.art.top - sample.ring >= sample.track.top - 1, `${label}:焦点框上边裁切`)
      assert.ok(sample.art.bottom + sample.ring <= sample.track.bottom + 1, `${label}:焦点框下边裁切`)
      assert.ok(sample.art.left - sample.ring >= sample.canvas.left - 1, `${label}:选中封面左边裁切`)
      assert.equal(sample.hittable, true, `${label}:封面可点击`)
    }
  }

  await call('apply_theme', {ref: 'switch'})
  await home.waitFor()
  assert.equal(await dock.locator('.switch-start').isDisabled(), true, '空主屏禁止打开不存在的页面')
  await call('install_addon', {id: 'hot'})
  await call('install_addon', {id: 'feeds'})
  await call('apply_theme', {ref: 'switch'})
  await home.waitFor()
  const avatarSeed = () => page.evaluate(() => JSON.parse(localStorage.getItem('fp.settings') || '{}').avatarSeed)
  const avatarSignature = () => page.locator('.switch-avatar svg').evaluate(svg => [...svg.querySelectorAll('*')].map(e => [
    e.tagName,
    [...e.attributes].filter(a => !['id', 'mask', 'clip-path'].includes(a.name)).map(a => [a.name, a.value]),
  ]))
  await page.waitForFunction(() => Boolean(JSON.parse(localStorage.getItem('fp.settings') || '{}').avatarSeed))
  const originalSeed = await avatarSeed(), originalAvatar = await avatarSignature()
  assert.equal(typeof originalSeed, 'string', '首次进入主机生成持久化头像种子')
  await page.reload({waitUntil: 'domcontentloaded'}); await home.waitFor(); await settle()
  assert.equal(await avatarSeed(), originalSeed, '刷新不重新生成头像种子')
  assert.deepEqual(await avatarSignature(), originalAvatar, '刷新保持相同头像图形')
  await page.locator('.switch-avatar').click()
  await page.getByRole('button', {name: '换一个', exact: true}).click()
  const savedSeed = await avatarSeed()
  assert.notEqual(savedSeed, originalSeed, '换一个更新头像种子')
  await board()
  const savedAvatar = await avatarSignature()
  assert.notDeepEqual(savedAvatar, originalAvatar, '换一个显示新的头像图形')
  await page.reload({waitUntil: 'domcontentloaded'}); await home.waitFor(); await settle()
  assert.equal(await avatarSeed(), savedSeed, '新头像种子跨刷新保存')
  assert.deepEqual(await avatarSignature(), savedAvatar, '新头像图形跨刷新保存')
  assert.equal(await dock.getByRole('button', {name: '搭搭', exact: true}).count(), 1, '首页只有一个搭搭入口')
  assert.equal(await dock.getByRole('button', {name: '主屏', exact: true}).count(), 0, '首页不显示重复主屏入口')
  const firstMenuButton = dock.locator('.switch-dock-btn').first()
  assert.equal(await firstMenuButton.getAttribute('aria-label'), '搭搭', '第一个圆形入口是搭搭')
  assert.ok((await firstMenuButton.locator('img').getAttribute('src')).endsWith('brand/dada-logo.png'), '搭搭入口使用既有品牌图片')
  assert.equal(await firstMenuButton.locator('img').evaluate(e => e.complete && e.naturalWidth > 0), true, '品牌图片实际加载成功')
  const colors = {}
  for (const mode of ['light', 'dark']) {
    await call('set_theme', {mode})
    assert.equal(await avatarSeed(), savedSeed, '切换明暗保持头像种子')
    assert.deepEqual(await avatarSignature(), savedAvatar, '切换明暗保持头像图形')
    colors[mode] = await home.evaluate(e => ({background: getComputedStyle(e).backgroundColor, text: getComputedStyle(e).color}))
    await snapshot(mode)
    await settings()
    assert.equal(await page.getByRole('heading', {name: '设置', exact: true}).count(), 1, '设置只出现一个系统标题')
    const footer = await dock.boundingBox()
    assert.ok(footer.height <= 90, '设置页使用紧凑系统操作条')
    const name = page.getByRole('textbox', {name: '称呼', exact: true})
    await name.fill('主题回归')
    await name.press('Enter')
    assert.equal(await name.inputValue(), '主题回归')
    assert.equal(await page.locator('.settings-page').count(), 1, '编辑框 Enter 不触发主屏导航')
    await snapshot(`settings-${mode}`)
    const inputFocus = []
    for (const label of ['称呼', '身份', '备注']) {
      const field = page.getByRole('textbox', {name: label, exact: true})
      await field.scrollIntoViewIfNeeded(); await field.focus(); await settle()
      const focus = await field.evaluate(input => {
        const row = input.closest('.ios-row'), describe = element => {
          const css = getComputedStyle(element)
          return {tag: element.tagName, className: element.className, outlineWidth: css.outlineWidth, outlineStyle: css.outlineStyle, outlineColor: css.outlineColor, boxShadow: css.boxShadow}
        }
        const chain = []
        for (let element = input; element && element !== row; element = element.parentElement) chain.push(describe(element))
        return {row: describe(row), chain, focused: input.matches(':focus-visible')}
      })
      assert.equal(focus.focused, true, `${label}输入获得可见焦点`)
      assert.equal(focus.row.outlineWidth, '3px', `${mode}${label}只在外层行显示焦点框`)
      assert.equal(focus.row.outlineStyle, 'solid', `${mode}${label}外行有实线焦点 ${JSON.stringify(focus)}`)
      for (const layer of focus.chain) {
        assert.ok(layer.outlineStyle === 'none' || layer.outlineWidth === '0px', `${mode}${label}内层无重复outline ${JSON.stringify(layer)}`)
        assert.equal(layer.boxShadow, 'none', `${mode}${label}内层无重复shadow ${JSON.stringify(layer)}`)
      }
      if (mode === 'dark' && label === '备注') await page.screenshot({path: '/tmp/dada-switch-focus.png'})
      inputFocus.push({label, ...focus})
    }
    const shuffle = page.getByRole('button', {name: '换一个', exact: true})
    await shuffle.scrollIntoViewIfNeeded(); await shuffle.focus(); await settle()
    const buttonFocus = await shuffle.evaluate(button => {
      const row = getComputedStyle(button.closest('.ios-row')), own = getComputedStyle(button)
      const ring = document.querySelector('[data-lobe-global-focus-ring]'), ringStyle = ring && getComputedStyle(ring)
      const buttonBox = button.getBoundingClientRect(), ringBox = ring?.getBoundingClientRect()
      return {
        rowOutlineWidth: row.outlineWidth, rowOutlineStyle: row.outlineStyle,
        focused: button.matches(':focus-visible'), outlineWidth: own.outlineWidth, outlineStyle: own.outlineStyle, boxShadow: own.boxShadow,
        managed: button.dataset.lobeFocusRing === 'managed',
        overlayVisible: Boolean(ring?.matches(':popover-open') && ringStyle.outlineStyle === 'solid' && Number.parseFloat(ringStyle.outlineWidth) > 0),
        overlayAligned: Boolean(ringBox && ['top', 'right', 'bottom', 'left'].every(edge => Math.abs(ringBox[edge] - buttonBox[edge]) <= 1)),
      }
    })
    assert.equal(buttonFocus.focused, true, '换一个按钮保留键盘焦点')
    assert.ok(buttonFocus.rowOutlineStyle === 'none' || buttonFocus.rowOutlineWidth === '0px', `${mode}按钮聚焦不让外行再画焦点框`)
    assert.ok(buttonFocus.managed ? buttonFocus.overlayVisible && buttonFocus.overlayAligned
      : (buttonFocus.outlineStyle !== 'none' && buttonFocus.outlineWidth !== '0px') || buttonFocus.boxShadow !== 'none', `${mode}按钮保留自身或Lobe管理的焦点视觉 ${JSON.stringify(buttonFocus)}`)
    focusSamples.push({mode, inputFocus, buttonFocus})
    await dock.getByRole('button', {name: '返回主屏', exact: true}).click()
    await home.waitFor()
    assert.equal(await avatarSeed(), savedSeed, '改称呼不改变头像种子')
    assert.deepEqual(await avatarSignature(), savedAvatar, '改称呼不改变头像图形')
  }
  assert.notEqual(colors.light.background, colors.dark.background, '主屏背景随明暗变化')
  assert.notEqual(colors.light.text, colors.dark.text, '主屏文字随明暗变化')

  const pageIds = await page.evaluate(() => window.__tada.workspace().pages.filter(item => item.id !== 'home').map(item => item.id))
  assert.ok(pageIds.length >= 2, '测试使用默认的两个页面入口')
  const covers = page.locator('.switch-cover')
  await covers.first().focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await covers.nth(1).getAttribute('aria-current'), 'true', '方向键选择第二张封面')
  assert.equal(await covers.nth(1).evaluate(e => e === document.activeElement), true, '方向键同步键盘焦点')
  await page.keyboard.press('Enter')
  await home.waitFor({state: 'hidden'})
  assert.equal(await page.locator('.canvas > .shell-content-stage > .page').getAttribute('data-page-id'), pageIds[1], 'Enter 打开当前封面')
  await board()
  await covers.nth(1).click()
  assert.equal(await home.count(), 1, '首次点击未选封面只选中')
  await covers.nth(1).click()
  await home.waitFor({state: 'hidden'})
  assert.equal(await page.locator('.canvas > .shell-content-stage > .page').getAttribute('data-page-id'), pageIds[1], '再次点击打开对应页面')
  await board()

  for (const viewport of [{width: 320, height: 720}, {width: 390, height: 844}, {width: 1280, height: 720}, {width: 1440, height: 900}, {width: 844, height: 390}]) {
    await page.setViewportSize(viewport); await settle()
    for (const mode of ['light', 'dark']) {
      await call('set_theme', {mode})
      const sample = await geometry(), label = `${viewport.width}×${viewport.height} ${mode}`
      assertGeometry(sample, label)
      samples.push({label, ...sample})
    }
    if (viewport.width === 390) await snapshot('mobile')
    if (viewport.width === 320) {
      await covers.first().focus(); await page.keyboard.press('End'); await settle()
      const lastCover = await geometry()
      assertGeometry(lastCover, '320px末张封面自动滚入')
      assert.ok(lastCover.art.right + lastCover.ring <= lastCover.canvas.right + 1, '末张选中框右边不裁切')
      await page.keyboard.press('Home'); await settle()
      await page.locator('.switch-covers').hover(); await page.mouse.wheel(0, 240)
      await page.waitForFunction(() => document.querySelector('.switch-covers').scrollLeft > 0)
      assert.equal(await home.count(), 1, '滚轮只横滚封面，不打开页面')
    }
    await settings()
    // 宽屏分类独立滚动；窄屏返回分类，再验证最后一项可命中。
    const side = page.locator('.settings-page .ios-side')
    if (!await side.isVisible()) await page.getByRole('button', {name: '返回设置列表', exact: true}).click()
    const last = side.getByRole('button').last()
    await last.scrollIntoViewIfNeeded(); await settle()
    const reachable = await last.evaluate(e => {
      const r = e.getBoundingClientRect(), side = e.closest('.ios-side').getBoundingClientRect(), dock = document.querySelector('.switch-dock').getBoundingClientRect()
      return {visible: r.top >= side.top - 1 && r.bottom <= Math.min(side.bottom, dock.top) + 1, hit: e.contains(document.elementFromPoint(r.left + r.width / 2, r.bottom - 2))}
    })
    assert.ok(reachable.visible && reachable.hit, `${viewport.width}设置末项可滚动和点击 ${JSON.stringify(reachable)}`)
    await last.click(); await settle()
    assertGeometry(await geometry(), `${viewport.width}设置详情`)
    await board()
  }

  await page.setViewportSize({width: 1440, height: 900}); await settle()
  await dock.getByRole('button', {name: '搭搭', exact: true}).click()
  const divider = page.getByRole('separator', {name: '调整页面与 AI 面板宽度'})
  await divider.waitFor(); await divider.focus(); await divider.press('Home'); await settle()
  const split = await geometry()
  assert.ok(split.canvas.width < 860, '实际进入 AI 窄分栏')
  assertGeometry(split, 'AI 分栏主屏')
  await settings()
  assertGeometry(await geometry(), 'AI 分栏设置')
  assert.equal(await page.getByRole('button', {name: '返回设置列表', exact: true}).isVisible(), true, '分栏设置保留返回分类操作')

  assert.deepEqual(errors, [], '无浏览器运行异常')
  console.log('通过：Switch 头像持久化与主动更换、搭搭品牌入口、双模式、键盘与点击打开、设置输入、五种尺寸与矮屏、分类滚动命中、AI 分栏边界')
  console.log(JSON.stringify({colors, focusSamples, samples}, null, 2))
} catch (error) {
  const page = context.pages()[0]
  await page.screenshot({path: '/tmp/dada-switch-failure.png'})
  console.error('失败视口', page.viewportSize(), '已通过样本', samples.map(s => s.label))
  throw error
} finally {await context.close(); await browser.close()}
