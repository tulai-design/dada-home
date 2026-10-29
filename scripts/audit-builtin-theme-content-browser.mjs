import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {writeFile} from 'node:fs/promises'
import {routeBuiltinFixtures, seedBuiltinFixtures} from './browser-builtin-fixtures.mjs'

// 通过公开工具构建内容，用真实导航和 DOM 几何回归各主题；只运行在全新隔离 context。
const require = createRequire(import.meta.url)
const {chromium} = require(process.env.DADA_PLAYWRIGHT_PATH || 'playwright')
const base = (process.env.DADA_QA_URL || 'http://127.0.0.1:5175').replace(/\/$/, '')
const requested = process.env.DADA_QA_THEMES?.split(',').filter(Boolean)
const browser = await chromium.launch({headless: true})
const context = await browser.newContext({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce', timezoneId: 'Asia/Shanghai'})
const samples = [], failures = [], errors = [], calendarInteractions = []
let builtinThemes = []
const cases = [
  {label: '热榜', slug: 'hot', target: '.hot-grid li a', text: '.hot-grid li a', control: '.hot-grid li a'},
  {label: '订阅', slug: 'feeds', target: '.feed-card', text: '.feed-card', control: '.feed-card'},
  {label: '书签', slug: 'bookmarks', target: '.mark-link', text: '.mark-name', control: '.mark-link'},
  {label: '书桌', slug: 'desk', target: '.note-area', text: '.note-area textarea, textarea.note-area', control: '.note-area textarea, textarea.note-area'},
  {label: '日历', slug: 'calendar', target: '.cd-row', text: '.cd-title', control: '.cal-cell'},
  {label: '专注', slug: 'focus', target: '.pomo-stats', text: '.pomo-sub', control: '.pomo-label input'},
  {label: '音乐', slug: 'music', target: '.music-row', text: '.music-row-title', control: '.music-row'},
]

try {
  await routeBuiltinFixtures(context, base)
  // 外部字体服务不访问；返回空样式表使审计采用本机 fallback，避免网络错误 toast 遮挡内容。
  await context.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType: 'text/css', body: ''}))
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(base, {waitUntil: 'domcontentloaded'})
  await page.waitForFunction(() => window.__tada?.workspace())
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const call = async (name, args) => {
    const result = await page.evaluate(({name, args}) => window.__tada.call(name, args), {name, args})
    assert.ok(typeof result !== 'string' || !/^(没有成功|没有工具)/.test(result), `${name}: ${result}`)
    await settle(); return result
  }
  await seedBuiltinFixtures(page, call)
  builtinThemes = await page.evaluate(() => window.__tada.workspace().themes.filter(t => t.builtin).map(({id, name}) => ({id, name})))
  const themes = builtinThemes.filter(theme => requested ? requested.includes(theme.id) : ['default', 'ios', 'pixel'].includes(theme.id))
  assert.ok(themes.length, `没有匹配的内置主题：${requested}`)
  if (requested) assert.deepEqual(themes.map(t => t.id).sort(), [...requested].sort(), '所指定主题必须存在于 workspace')
  const open = async label => {
    await page.keyboard.press('Meta+k')
    await page.locator('.cmdk input').fill(label)
    await page.locator('.cmdk-section').filter({has: page.locator('.cmdk-group').getByText('页面', {exact: true})}).locator('.cmdk-row').filter({has: page.locator('.cmdk-label').getByText(label, {exact: true})}).click()
    await page.locator('.cmdk').waitFor({state: 'hidden'}); await settle()
  }
  const measure = async (label, item) => {
    const previousFailureCount = failures.length
    const end = page.locator(item.target).last()
    await end.waitFor()
    await end.scrollIntoViewIfNeeded()
    await end.evaluate(element => {
      for (let parent = element.parentElement; parent && !parent.classList.contains('canvas'); parent = parent.parentElement) {
        if (parent.scrollHeight > parent.clientHeight && /auto|scroll/.test(getComputedStyle(parent).overflowY)) parent.scrollTop = parent.scrollHeight
      }
    })
    await settle()
    const sample = await page.evaluate(({label, item}) => {
      const box = e => {const r = e.getBoundingClientRect(); return {top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height}}
      const root = document.querySelector('.canvas > .page'), canvas = document.querySelector('.canvas')
      const last = [...document.querySelectorAll(item.target)].at(-1), end = box(last), bounds = box(root)
      const dock = [...document.querySelectorAll('.switch-dock, .dock')].find(e => e.getBoundingClientRect().height > 0)
      const footer = dock && box(dock), dockOverlapsX = footer && end.left < footer.right && end.right > footer.left
      const visibleBottom = Math.min(innerHeight, bounds.bottom, dockOverlapsX ? footer.top : bounds.bottom)
      const hit = document.elementFromPoint(end.left + Math.min(end.width / 2, 100), end.top + Math.min(end.height / 2, 12))
      const text = document.querySelector(item.text) || last, css = getComputedStyle(text)
      const range = document.createRange(); range.selectNodeContents(text)
      const textBox = range.getBoundingClientRect(), textBounds = text.getBoundingClientRect()
      const sample = {label, root: bounds, canvas: box(canvas), footer, visibleBottom, overflow: root.scrollWidth - root.clientWidth, documentOverflow: document.documentElement.scrollWidth - innerWidth, end, hittable: last.contains(hit), text: {fontSize: Number.parseFloat(css.fontSize), lineHeight: css.lineHeight, color: css.color, background: css.backgroundColor, textOverflow: css.textOverflow, rangeWiderThanBox: textBox.width > textBounds.width + 1}}
      if (item.slug === 'focus') {
        const pomo = document.querySelector('.pomo'), css = getComputedStyle(pomo)
        sample.focusLayout = {width: pomo.clientWidth - Number.parseFloat(css.paddingLeft) - Number.parseFloat(css.paddingRight), timer: box(pomo.querySelector('.pomo-timer')), workspace: box(pomo.querySelector('.pomo-workspace'))}
      }
      return sample
    }, {label, item})
    if (sample.overflow > 1 || sample.documentOverflow > 1) failures.push(`${label}: 横向溢出 ${sample.overflow}/${sample.documentOverflow}`)
    if (sample.end.top < sample.root.top - 1 || sample.end.bottom > sample.visibleBottom + 1 || !sample.hittable) failures.push(`${label}: 末项不可达，bottom ${sample.end.bottom} / limit ${sample.visibleBottom}，hit ${sample.hittable}`)
    if (sample.text.fontSize < 12) failures.push(`${label}: 主内容字号低于 12px (${sample.text.fontSize})`)
    if (sample.focusLayout) {
      const {width, timer, workspace} = sample.focusLayout
      if (width >= 680 ? timer.right > workspace.left + 1 : timer.bottom > workspace.top + 1) failures.push(`${label}: 专注横纵布局交叠`)
    }
    if (failures.length > previousFailureCount || page.viewportSize().width < 500 && ['hot', 'feeds', 'bookmarks', 'calendar'].includes(item.slug)) await page.screenshot({path: `/tmp/dada-builtin-${label.replaceAll(' ', '-')}-end.png`})
    const control = page.locator(item.control).first()
    if (await control.count()) {
      await control.scrollIntoViewIfNeeded(); await control.focus(); await page.keyboard.press('Shift')
      sample.keyboardFocus = await control.evaluate(element => {
        const css = getComputedStyle(element), overlay = document.querySelector('[data-lobe-global-focus-ring]')
        const ancestors = []; for (let parent = element.parentElement; parent && !parent.classList.contains('page-pane'); parent = parent.parentElement) {const style = getComputedStyle(parent); ancestors.push({className: parent.className, border: style.border, outline: style.outline, boxShadow: style.boxShadow})}
        return {active: document.activeElement === element, focusVisible: element.matches(':focus-visible'), outline: css.outline, boxShadow: css.boxShadow, globalRing: !!overlay && overlay.matches(':popover-open') && overlay.getBoundingClientRect().width > 0, ancestors}
      })
    }
    samples.push(sample)
  }
  const calendarInteraction = async label => {
    const calendar = page.locator('.cal-day'), input = calendar.getByPlaceholder(/添一条日程/), time = calendar.getByPlaceholder('全天')
    const add = calendar.getByRole('button', {name: '添加', exact: true})
    const clickTitle = `${label} 点击添加`, enterTitle = `${label} 回车添加`
    await input.fill(clickTitle)
    const controls = []
    for (const [name, control] of [['日程', input], ['时间', time], ['添加', add]]) {
      // 浮动 Dock 不参与 IntersectionObserver，显式滚入中央再验实际命中，模拟用户把表单滚到可操作位置。
      await control.evaluate(element => element.scrollIntoView({block: 'center', inline: 'nearest'})); await settle()
      const geometry = await control.evaluate(element => {
        const rect = e => {const b = e.getBoundingClientRect(); return {left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height}}
        const panel = rect(element.closest('.cal-day')), box = rect(element), root = rect(document.querySelector('.canvas > .page'))
        const frame = rect(element.closest('.cal-add-title, .cal-add-time, .cal-add-submit') || element)
        const dock = [...document.querySelectorAll('.switch-dock,.dock')].find(e => e.getBoundingClientRect().height > 0), footer = dock && rect(dock)
        const visibleBottom = Math.min(root.bottom, innerHeight, footer && box.left < footer.right && box.right > footer.left ? footer.top : root.bottom)
        const points = [box.top + 2, (box.top + box.bottom) / 2, box.bottom - 2].map(y => document.elementFromPoint((box.left + box.right) / 2, y))
        return {box, frame, panel, root, visibleBottom, hittable: points.every(hit => element === hit || element.contains(hit))}
      })
      controls.push({name, ...geometry})
      const {box, frame, panel, root, visibleBottom, hittable} = geometry
      if (Math.min(box.left, frame.left) < Math.max(panel.left, root.left) - 1 || Math.max(box.right, frame.right) > Math.min(panel.right, root.right) + 1 || box.top < root.top - 1 || box.bottom > visibleBottom + 1 || !hittable) failures.push(`${label}: ${name}控件裁切或无法点击 ${JSON.stringify(geometry)}`)
    }
    await add.click()
    assert.equal(await input.inputValue(), '', `${label}: 点击添加后清空输入`)
    const firstEvents = await call('list_events', {})
    assert.ok(firstEvents.includes(`｜${clickTitle}｜`), `${label}: 点击提交已持久化日程`)
    await input.fill(enterTitle); await input.press('Enter')
    assert.equal(await input.inputValue(), '', `${label}: 回车添加后清空输入`)
    const secondEvents = await call('list_events', {})
    assert.ok(secondEvents.includes(`｜${enterTitle}｜`), `${label}: 回车提交已持久化日程`)
    await calendar.getByRole('button', {name: `删除「${clickTitle}」`, exact: true}).click()
    await calendar.getByRole('button', {name: `删除「${enterTitle}」`, exact: true}).click()
    await calendar.locator('.cal-add').evaluate(element => element.scrollIntoView({block: 'center', inline: 'nearest'})); await settle()
    await page.screenshot({path: `/tmp/dada-builtin-${label.replaceAll(' ', '-')}-calendar-form.png`})
    calendarInteractions.push({label, clickSaved: true, enterSaved: true, controls})
  }
  for (const theme of themes) {
    await call('apply_theme', {ref: theme.id})
    for (const viewport of [{width: 1440, height: 900}, {width: 390, height: 844}]) {
      await page.setViewportSize(viewport)
      for (const mode of ['light', 'dark']) {
        await call('set_theme', {mode})
        for (const item of cases) {
          await open(item.label)
          await measure(`${theme.id} ${viewport.width} ${mode} ${item.slug}`, item)
          await page.evaluate(() => {
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
            document.querySelectorAll('.page, .page-list, .sys-body').forEach(e => {e.scrollTop = 0})
          })
          await page.mouse.move(0, 0); await settle()
          await page.screenshot({path: `/tmp/dada-builtin-${theme.id}-${item.slug}-${mode}-${viewport.width}.png`})
          if (item.slug === 'calendar' && viewport.width < 500) await calendarInteraction(`${theme.id} ${viewport.width} ${mode}`)
        }
      }
    }
    // 更窄设备验证长内容末项及日历表单实际交互；保留各主题自己的视觉密度。
    for (const width of [320, 360]) {
      await page.setViewportSize({width, height: 844})
      for (const mode of ['light', 'dark']) {
        await call('set_theme', {mode})
        for (const item of cases.filter(item => ['hot', 'feeds', 'bookmarks', 'calendar'].includes(item.slug))) {
          await open(item.label); await measure(`${theme.id} ${width} ${mode} ${item.slug}`, item)
          if (item.slug === 'calendar') await calendarInteraction(`${theme.id} ${width} ${mode}`)
        }
      }
    }
  }
  const report = {builtinThemes, auditedThemes: themes, fontNote: '外网被隔离，Google 字体用本机 fallback；视觉结论限于此条件。', errors, failures, samples, calendarInteractions}
  await writeFile('/tmp/dada-builtin-theme-content-report.json', JSON.stringify(report, null, 2))
  assert.deepEqual(errors, [], '浏览器无运行异常')
  assert.deepEqual(failures, [], '内置主题内容可达、无横溢且日历表单可操作')
  console.log(`通过：${themes.length} 个内置主题，${samples.length} 个页面/视口/模式场景；${calendarInteractions.length} 组手机日历点击及回车添加；无横溢、底栏遮挡或运行异常。详情 /tmp/dada-builtin-theme-content-report.json`)
} catch (error) {
  await context.pages()[0]?.screenshot({path: '/tmp/dada-builtin-theme-failure.png'})
  await writeFile('/tmp/dada-builtin-theme-content-report.json', JSON.stringify({builtinThemes, errors, failures, samples, calendarInteractions}, null, 2))
  console.error(JSON.stringify({errors, failures, completedScenarios: samples.length}, null, 2))
  throw error
} finally {await context.close(); await browser.close()}
