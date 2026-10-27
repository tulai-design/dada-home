import assert from 'node:assert/strict'
import {createRequire} from 'node:module'

const require = createRequire(import.meta.url)
const {chromium} = require(process.env.DADA_PLAYWRIGHT_PATH || 'playwright')
const base = (process.env.DADA_QA_URL || 'http://127.0.0.1:5175').replace(/\/$/, '')
const browser = await chromium.launch({headless: true})
const ids = ['intro', 'primary', 'reading', 'secondary', 'shortcut-a', 'shortcut-b', 'shortcut-c', 'unassigned']
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 1100}})
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(base + '/tests/page-sections-regressions.html')
  await page.locator('#demo-counter').waitFor()
  const fixture = page.locator('#fixture')
  const widget = (id) => page.locator('.widget[data-id="' + id + '"]')
  const box = (id) => widget(id).boundingBox()
  const settle = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const click = async (id) => {await page.locator('#' + id).click(); await settle()}
  const inspect = async () => {await click('inspect'); return JSON.parse(await page.locator('#report').textContent())}
  const order = () => fixture.locator('.page-grid > .widget').evaluateAll((nodes) => nodes.map((node) => node.dataset.id))
  const noIssues = async (label) => {
    const report = await inspect()
    assert.equal(report.status, 'ok', label + ': 检查器状态')
    assert.deepEqual(report.issues, [], label + ': 检查器无溢出/裁切')
  }
  const screenshot = async (name) => {
    // Expand only this isolated fixture for a full-content review image, then restore its real scroll viewport.
    await fixture.evaluate((element) => {element.scrollTop = 0; element.style.height = element.scrollHeight + 'px'})
    await fixture.screenshot({path: '/tmp/dada-page-sections-' + name + '.png'})
    await fixture.evaluate((element) => {element.style.height = '720px'})
  }
  const state = async (label) => {
    assert.equal(await page.getByLabel('保留输入').inputValue(), '状态不应丢失', label + ': 输入值保留')
    assert.equal(await page.locator('#demo-counter').textContent(), '已完成 1', label + ': 计数保留')
  }
  const layout = async (label) => {
    const actualWidth = await fixture.locator('.page-grid').evaluate((element) => {
      const style = getComputedStyle(element)
      return element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    })
    const primary = await box('primary')
    const secondary = await box('secondary')
    const reading = await box('reading')
    if (actualWidth < 720) {
      assert.ok(Math.abs(primary.x - secondary.x) < 1 && Math.abs(primary.width - secondary.width) < 1, label + ': 实际窄容器收成一列')
      assert.ok(reading.y >= primary.y + primary.height && secondary.y >= reading.y + reading.height, label + ': 主列内容完整排在辅助列之前')
    } else {
      assert.ok(primary.width > secondary.width * 1.8, label + ': 主辅分栏应按 2:1 呈现')
      assert.ok(Math.abs(primary.y - secondary.y) < 1, label + ': 主辅首行对齐')
      const shortcuts = await Promise.all(['shortcut-a', 'shortcut-b', 'shortcut-c'].map(box))
      assert.ok(shortcuts.every((item) => Math.abs(item.y - shortcuts[0].y) < 1 && Math.abs(item.width - shortcuts[0].width) < 1), label + ': 三列区域等宽同排')
    }
    assert.deepEqual(await order(), ids, label + ': DOM阅读顺序')
    assert.equal(await fixture.getByText('不应显示的空分区').count(), 0, label + ': 空分区不占标题')
    const scroll = await fixture.evaluate((element) => ({width: element.clientWidth, scrollWidth: element.scrollWidth, height: element.clientHeight, scrollHeight: element.scrollHeight, overflowY: getComputedStyle(element).overflowY}))
    assert.ok(scroll.scrollWidth <= scroll.width + 1, label + ': 没有横向溢出')
    assert.equal(scroll.overflowY, 'auto', label + ': 长页面可纵向滚动')
    await noIssues(label)
  }

  // Initial regression: the old PageView renders both sides with the same span.
  await layout('桌面初始')
  await page.getByLabel('保留输入').fill('状态不应丢失')
  await page.locator('#demo-counter').click()
  const originalInput = await page.getByLabel('保留输入').elementHandle()
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({width, height: 1100})
    await settle()
    for (const theme of ['light', 'dark']) {
      if ((await page.locator('html').getAttribute('data-theme') || 'light') !== theme) await click('theme')
      await layout(width + 'px ' + theme)
      await state(width + 'px ' + theme)
    }
  }
  await click('theme') // light
  await click('narrow')
  await layout('1440px窗口中的360px容器')
  await state('容器缩窄')

  // The tab sequence follows primary → secondary rather than visual row pairing.
  await page.getByLabel('保留输入').focus()
  const tabOrder = []
  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press('Tab')
    tabOrder.push(await page.evaluate(() => document.activeElement?.getAttribute('data-focus')))
  }
  assert.deepEqual(tabOrder, ['primary', 'reading', 'secondary', 'shortcut-a', 'shortcut-b', 'unassigned'], '键盘顺序与窄容器阅读顺序一致')

  await click('wide')
  await click('rearrange')
  await state('跨分区调整')
  assert.deepEqual(await order(), ['intro', 'reading', 'primary', 'secondary', 'shortcut-a', 'shortcut-b', 'shortcut-c', 'unassigned'])
  await click('flat')
  await state('清除分区')
  assert.equal(await fixture.locator('.page-grid[data-sections]').count(), 0)
  await click('reset')
  await state('恢复分区')
  assert.equal(await originalInput.evaluate((element) => element.isConnected), true, '布局变化后仍是同一个输入DOM实例')

  for (const side of ['empty-primary', 'empty-secondary']) {
    await click(side)
    assert.equal(await fixture.locator('.widget').count(), ids.length, side + ': 空侧不丢其他组件')
    assert.equal(await fixture.locator('.page-section-heading').count(), 1)
    await noIssues(side)
    await state(side)
  }
  await click('empty-sections')
  assert.equal(await fixture.locator('.page-section-heading').count(), 0, '全空分区隐藏全部标题')
  assert.deepEqual(await order(), ids, '全空分区保留未分组组件')
  const full = await box('unassigned')
  const half = await box('primary')
  assert.ok(full.width > half.width * 1.8, '未分组组件保持原有span')
  await noIssues('全空分区')
  await state('全空分区')
  await click('variants')
  assert.ok(Math.abs((await box('primary')).width - (await box('secondary')).width) < 1, '等比分栏选项')
  assert.ok((await box('shortcut-c')).y > (await box('shortcut-a')).y, '两列分区第三项自动换行')
  assert.equal(await fixture.locator('.page-section-heading[data-section-kind="hero"]').evaluate((element) => getComputedStyle(element).textAlign), 'center', 'hero标题可选居中')
  await noIssues('布局选项')
  await state('布局选项')
  await click('untitled')
  assert.equal(await fixture.locator('.page-section-heading').count(), 0, '可省略所有分区标题')
  assert.ok(Math.abs((await box('primary')).y - (await box('secondary')).y) < 1, '无标题分栏仍按同行对齐')
  await click('narrow')
  assert.equal(await widget('secondary').evaluate((element) => getComputedStyle(element).marginTop), '0px', '窄容器无标题组仅首项增加分区间距')
  await noIssues('无标题分区窄容器')
  await state('无标题分区')

  await click('narrow')
  await click('long')
  await noIssues('长标题/长词窄容器')
  assert.equal(await fixture.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true)
  await state('长标题')

  // Real inspector can locate an intentional regression and clear it after repair.
  await widget('primary').evaluate((element) => {element.style.width = '1400px'; element.style.maxWidth = 'none'})
  const broken = await inspect()
  assert.ok(broken.issues.some((issue) => issue.componentId === 'primary' && issue.code === 'horizontal-overflow'), '检查器定位到故意溢出的组件')
  await widget('primary').evaluate((element) => {element.style.removeProperty('width'); element.style.removeProperty('max-width')})
  await noIssues('修复溢出后')

  await click('reset')
  await click('wide')
  await screenshot('desktop')
  await click('narrow')
  await screenshot('narrow')
  await click('wide')
  await click('theme')
  await screenshot('dark')

  await click('stage')
  assert.equal(await fixture.locator('.page-grid[data-stage]').count(), 1, '旧单组件舞台保留')
  assert.ok((await box('stage')).width <= 421, '旧舞台保持宽度上限')
  await click('section-stage')
  assert.equal(await fixture.locator('.page-grid[data-stage]').count(), 0, '显式分区不触发整页舞台')
  assert.ok((await box('stage')).width > 700)
  await noIssues('单组件hero')
  await click('legacy-home')
  assert.equal(await fixture.locator('.page-grid[data-align="center"]:not([data-sections])').count(), 1, '旧首页保留居中布局')
  const home = await Promise.all(['clock', 'search', 'links'].map(box))
  assert.ok(home.every((item) => item.width > 0 && item.height > 0), '旧首页三块正常渲染')
  assert.ok(home[1].y >= home[0].y + home[0].height && home[2].y >= home[1].y + home[1].height, '旧首页三块没有重叠')
  await noIssues('旧首页')
  await click('empty-page')
  assert.equal(await fixture.locator('.page-grid').count(), 0)
  assert.equal(await fixture.getByText('这一页还是空的').count(), 1, '空页面保留原有空态')
  assert.deepEqual(errors, [], '没有浏览器运行时异常')
  console.log('通过：PageView 分区宽度/主题矩阵、窄容器、键盘顺序、状态保留、空侧/空分区、检查器与旧布局回归')
  console.log('截图：/tmp/dada-page-sections-{desktop,narrow,dark}.png')
} finally {await browser.close()}
