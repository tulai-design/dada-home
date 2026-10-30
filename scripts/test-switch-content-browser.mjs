import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {routeBuiltinFixtures, seedBuiltinFixtures} from './browser-builtin-fixtures.mjs'
const require = createRequire(import.meta.url)
const {chromium} = require(process.env.DADA_PLAYWRIGHT_PATH || 'playwright')
const base = (process.env.DADA_QA_URL || 'http://127.0.0.1:5175').replace(/\/$/, '')
const browser = await chromium.launch({headless: true})
const context = await browser.newContext({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce', timezoneId: 'Asia/Shanghai'})
const errors = [], samples = [], failures = []
const hotTextSamples = [], focusLayouts = []

try {
  await context.addInitScript(() => {localStorage.setItem('fp.sidebarAi', '"split"'); localStorage.setItem('fp.assistantPanelMode', '"split"')})
  await routeBuiltinFixtures(context, base)
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(base + '/', {waitUntil: 'domcontentloaded'})
  await page.locator('.app').waitFor({state: 'attached'})
  await page.waitForFunction(() => window.__tada?.workspace())
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const call = async (name, args) => {
    const result = await page.evaluate(({name, args}) => window.__tada.call(name, args), {name, args})
    assert.ok(typeof result !== 'string' || !/^(没有成功|没有工具)/.test(result), `${name}: ${result}`)
    await settle(); return result
  }
  await seedBuiltinFixtures(page, call)
  await call('apply_theme', {ref: 'switch'})
  const dock = page.getByRole('navigation', {name: '主机菜单'})
  const home = page.getByRole('region', {name: '主机主屏'})
  const open = async label => {
    if (!await home.count()) {await dock.getByRole('button', {name: '主屏', exact: true}).click(); await home.waitFor()}
    if (label === '市场' || label === '监控') await dock.getByRole('button', {name: label, exact: true}).click()
    else {
      const cover = home.getByRole('button', {name: new RegExp(`^${label}，`)})
      await cover.scrollIntoViewIfNeeded()
      if (await cover.getAttribute('data-on') !== 'true') await cover.click()
      await cover.click()
    }
    await home.waitFor({state: 'hidden'}); await settle()
  }
  const snapshot = async name => {
    await page.evaluate(() => {if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); document.querySelectorAll('.page, .page-list, .sys-body').forEach(e => {e.scrollTop = 0})})
    await page.mouse.move(0, 0); await settle()
    await page.screenshot({path: `/tmp/dada-switch-content-${name}.png`})
  }
  const measure = async (label, target) => {
    const end = page.locator(target).last()
    assert.ok(await end.count(), `${label}:末项测试目标必须存在 ${target}`)
    if (await end.count()) {
      await end.scrollIntoViewIfNeeded()
      await end.evaluate(element => {for (let parent = element.parentElement; parent && !parent.classList.contains('canvas'); parent = parent.parentElement) {if (parent.scrollHeight > parent.clientHeight && /auto|scroll/.test(getComputedStyle(parent).overflowY)) parent.scrollTop = parent.scrollHeight}})
    }
    await settle()
    const sample = await page.evaluate(({label, target}) => {
      const box = e => {const r = e.getBoundingClientRect(); return {top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height}}
      const canvas = document.querySelector('.canvas'), root = document.querySelector('.canvas > .page'), dock = document.querySelector('.switch-dock')
      const last = [...document.querySelectorAll(target)].at(-1), end = last && box(last), footer = box(dock)
      const panes = [...root.querySelectorAll('.page-pane:not(.hot-pane):not(.feeds-pane):not(.bookmarks-pane), .hot-board, .mark-group, .feed-card, .music-queue, .pomo-stats')].filter(e => getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)').map(e => ({...box(e), padding: getComputedStyle(e).paddingInlineStart}))
      const hit = last && document.elementFromPoint(end.left + Math.min(end.width / 2, 100), end.top + Math.min(end.height / 2, 12))
      return {label, root: box(root), canvas: box(canvas), footer, overflow: root.scrollWidth - root.clientWidth, documentOverflow: document.documentElement.scrollWidth - innerWidth, end, hittable: !last || last.contains(hit), panes}
    }, {label, target})
    samples.push(sample)
    if (target === '.pomo-stats') {
      const layout = await page.locator('.pomo').evaluate(pomo => {
        const box = e => {const r = e.getBoundingClientRect(); return {top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width}}
        return {width: pomo.clientWidth, timer: box(pomo.querySelector('.pomo-timer')), workspace: box(pomo.querySelector('.pomo-workspace'))}
      })
      focusLayouts.push({label, ...layout})
      if (layout.width >= 680 ? layout.timer.right > layout.workspace.left + 1 : layout.timer.bottom > layout.workspace.top + 1) failures.push(`${label}: 专注横纵布局重叠 ${JSON.stringify(layout)}`)
    }
    if (target === '.hot-grid li a') {
      const text = await page.locator(target).first().evaluate(link => {const css = getComputedStyle(link), row = link.closest('li').getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(link); const bounds = range.getBoundingClientRect(); return {fontSize: Number.parseFloat(css.fontSize), lineHeight: Number.parseFloat(css.lineHeight), textFitsRow: bounds.left >= row.left - 1 && bounds.right <= row.right + 1 && bounds.top >= row.top - 1 && bounds.bottom <= row.bottom + 1}})
      hotTextSamples.push({label, ...text})
      if (text.fontSize < 14 || !text.textFitsRow) failures.push(`${label}:标题字号或完整性不符合阅读要求 ${JSON.stringify(text)}`)
    }
    if (sample.overflow > 1 || sample.documentOverflow > 1) failures.push(`${label}: 横向溢出 ${sample.overflow}/${sample.documentOverflow}`)
    if (sample.end && (sample.end.top < sample.root.top - 1 || sample.end.bottom > Math.min(sample.root.bottom, sample.footer.top) + 1 || !sample.hittable)) failures.push(`${label}: 末项不可达 ${JSON.stringify(sample.end)} footer=${sample.footer.top} hit=${sample.hittable}`)
    for (const pane of sample.panes) if (Number.parseFloat(pane.padding) < 12) failures.push(`${label}: 内容面板横向padding过小 ${pane.padding}`)
  }
  const cases = [
    {label: '热榜', slug: 'hot', target: '.hot-grid li a'},
    {label: '订阅', slug: 'feeds', target: '.feed-card'},
    {label: '书签', slug: 'bookmarks', target: '.mark-link'},
    {label: '书桌', slug: 'desk', target: '.note-area'},
    {label: '日历', slug: 'calendar', target: '.cd-row'},
    {label: '专注', slug: 'focus', target: '.pomo-stats'},
    {label: '音乐', slug: 'music', target: '.music-row'},
    {label: '天气', slug: 'weather', target: '.weather-card'},
    {label: '市场', slug: 'market', target: '.catalog-open'},
    {label: '监控', slug: 'monitor', target: '.sys-body button'},
  ]
  for (const viewport of [{width: 1440, height: 900}, {width: 390, height: 844}]) {
    await page.setViewportSize(viewport)
    for (const mode of ['light', 'dark']) {
      await call('set_theme', {mode})
      for (const item of cases) {
        await open(item.label)
        if (item.slug === 'hot') await page.locator('.hot-grid li a').first().waitFor()
        if (item.slug === 'feeds') await page.locator('.feed-card').first().waitFor()
        if (item.slug === 'weather') await page.locator('.weather-temp').waitFor()
        await measure(`${viewport.width} ${mode} ${item.slug}`, item.target)
        await snapshot(`${item.slug}-${mode}${viewport.width < 500 ? '-mobile' : ''}`)
      }
    }
  }
  // 真实控件交互：页面内容不是纯截图夹具。
  await page.setViewportSize({width: 1440, height: 900}); await call('set_theme', {mode: 'light'})
  await open('热榜')
  const hotLink = page.locator('.hot-grid li a').first(), hotUrl = await hotLink.getAttribute('href')
  const hotPopup = page.waitForEvent('popup'); await hotLink.click(); const hotPage = await hotPopup
  await hotPage.waitForLoadState('domcontentloaded'); assert.equal(hotPage.url(), hotUrl); await hotPage.close()
  await open('订阅')
  assert.equal(await page.locator('.feed-card').count(), 24)
  await page.locator('.widget[data-type="feeds"]').getByText('设计周刊', {exact: true}).first().click()
  assert.equal(await page.locator('.feed-card').count(), 12, '来源筛选只显示对应文章')
  await page.locator('.feed-card').first().click()
  await page.getByRole('dialog').first().waitFor(); await page.keyboard.press('Escape')
  await open('书签')
  const bookmark = page.locator('.mark-link').first(), bookmarkUrl = await bookmark.getAttribute('href')
  const bookmarkPopup = page.waitForEvent('popup'); await bookmark.click(); const bookmarkPage = await bookmarkPopup
  await bookmarkPage.waitForLoadState('domcontentloaded'); assert.equal(bookmarkPage.url(), bookmarkUrl); await bookmarkPage.close()
  await open('书桌')
  const todoInput = page.getByPlaceholder('添一件待办，回车确认')
  await todoInput.fill('检查输入和保存'); await todoInput.press('Enter')
  assert.ok((await call('list_todos', {})).includes('检查输入和保存'))
  const note = page.getByPlaceholder('随手记下什么，AI 也可以往这里写。')
  await note.fill('便签输入保存验收\n第二行保持可编辑')
  assert.ok((await call('read_note', {})).includes('便签输入保存验收'))
  await open('专注')
  const focus = page.locator('.pomo'), task = focus.getByRole('textbox', {name: '本轮任务'})
  await task.fill('验收横向专注计时')
  await focus.getByRole('button', {name: '开始专注', exact: true}).click()
  await focus.getByRole('button', {name: '暂停', exact: true}).waitFor()
  assert.ok(await task.evaluate(input => input.readOnly), '开始后任务输入只读')
  await focus.getByRole('button', {name: '暂停', exact: true}).click()
  await focus.getByText('已暂停', {exact: true}).waitFor()
  assert.ok(await task.evaluate(input => input.readOnly), '暂停期间任务输入仍只读')
  await focus.getByRole('button', {name: '继续', exact: true}).click()
  await focus.getByRole('button', {name: '暂停', exact: true}).waitFor()
  assert.equal(await task.inputValue(), '验收横向专注计时', '继续计时保持本轮任务')
  await focus.getByRole('button', {name: '放弃这一段', exact: true}).click()
  await focus.getByRole('button', {name: '开始专注', exact: true}).waitFor()
  assert.equal(await task.evaluate(input => input.readOnly), false, '停止后恢复编辑')
  await open('热榜')
  await dock.getByRole('button', {name: '搭搭', exact: true}).click()
  const divider = page.getByRole('separator', {name: '调整页面与 AI 面板宽度'})
  await divider.waitFor(); await divider.focus(); await divider.press('Home'); await settle()
  for (const item of cases) {
    await open(item.label)
    await measure(`AI 分栏 ${item.slug}`, item.target)
    await snapshot(`${item.slug}-split`)
  }
  assert.deepEqual(errors, [], '浏览器无运行异常')
  assert.deepEqual(failures, [], '布局与滚动验收')
  console.log('通过：全部内置内容页双模式、桌面/手机/AI分栏，热榜与书签链接、订阅筛选与阅读、待办与便签输入')
  console.log(JSON.stringify({samples, hotTextSamples, focusLayouts}, null, 2))
} catch (error) {
  await context.pages()[0]?.screenshot({path: '/tmp/dada-switch-content-failure.png'})
  console.error(JSON.stringify({errors, failures, samples}, null, 2))
  throw error
} finally {await context.close(); await browser.close()}
