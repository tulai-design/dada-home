import assert from 'node:assert/strict'
import {createRequire} from 'node:module'

// Browser tooling is supplied by the caller; this is not a production dependency.
// DADA_PLAYWRIGHT_PATH=/absolute/path/to/playwright/index.js node scripts/test-effect-theme-browser.mjs
const require = createRequire(import.meta.url)
const {chromium} = require(process.env.DADA_PLAYWRIGHT_PATH || 'playwright')
const base = process.env.DADA_QA_URL || 'http://127.0.0.1:5175'
const TIMEOUT = 10_000
const backgrounds = ['aurora', 'silk', 'beams', 'galaxy', 'iridescence', 'liquid-chrome', 'orb', 'particles', 'threads', 'waves', 'dot-grid']
const browser = await chromium.launch({headless: true})
let passed = 0
const fixtureUrl = (effect, extra = '') => `${base.replace(/\/$/, '')}/tests/effect-theme-regressions.html?effect=${encodeURIComponent(effect)}${extra}`

async function test(name, run) {
  await run()
  passed += 1
  console.log(`通过：${name}`)
}
async function newPage(context) {
  const page = await context.newPage()
  page.setDefaultTimeout(TIMEOUT)
  page.setDefaultNavigationTimeout(TIMEOUT)
  return page
}
async function context(options = {}) {
  return browser.newContext({viewport: {width: 1200, height: 900}, reducedMotion: 'no-preference', ...options})
}
const effectSelector = (effect) => `#fixture [data-fx-id="${effect}"]`
async function state(page, effect, value) {
  await page.locator(`${effectSelector(effect)}[data-fx-state="${value}"]`).waitFor({timeout: TIMEOUT})
}
async function color(page, selector, expected, property = 'color') {
  await page.waitForFunction(({selector, expected, property}) => {
    const element = document.querySelector(selector)
    return element && getComputedStyle(element)[property] === expected
  }, {selector, expected, property}, {timeout: TIMEOUT})
}
async function seedBusiness(page) {
  await page.getByRole('textbox', {name: '保留输入'}).fill('保存这段输入')
  await page.locator('#counter').click({timeout: TIMEOUT})
}
async function businessSurvived(page) {
  assert.equal(await page.getByRole('textbox', {name: '保留输入'}).inputValue(), '保存这段输入')
  assert.equal(await page.locator('#counter').innerText(), '计数 1')
}
async function readable(page) {
  const body = await page.locator('#effect-frame').innerText()
  assert.ok(body.includes('完整标题') && body.includes('正文保留'), body)
}
async function click(page, name) {
  await page.getByRole('button', {name, exact: true}).click({timeout: TIMEOUT})
}

try {
  for (const effect of ['split-text', 'glare-hover', 'waves']) {
    await test(`${effect}：两种主题、同模式变量和显式颜色分支保持业务状态`, async () => {
      const ctx = await context()
      try {
        const page = await newPage(ctx)
        await page.goto(fixtureUrl(effect))
        await state(page, effect, 'animated')
        const content = effect === 'waves' ? '#effect-frame .fx-banner-text' : effect === 'glare-hover' ? '#effect-frame .fx-card-text' : '#effect-frame .fx-text'
        await page.locator(content).waitFor({timeout: TIMEOUT})
        const light = await page.locator(content).evaluate((element) => getComputedStyle(element).color)
        await seedBusiness(page)
        await click(page, '深色')
        await page.waitForFunction(({selector, previous}) => getComputedStyle(document.querySelector(selector)).color !== previous, {selector: content, previous: light}, {timeout: TIMEOUT})
        await click(page, '同模式换色')
        await color(page, content, 'rgb(85, 102, 119)')
        await click(page, '模式配色')
        await color(page, content, 'rgb(237, 203, 169)')
        if (effect === 'glare-hover') await color(page, '#effect-frame .glare-hover', 'rgb(34, 17, 34)', 'backgroundColor')
        await click(page, '浅色')
        await color(page, content, 'rgb(18, 52, 86)')
        if (effect === 'glare-hover') await color(page, '#effect-frame .glare-hover', 'rgb(238, 238, 221)', 'backgroundColor')
        await businessSurvived(page)
        await readable(page)
      } finally { await ctx.close() }
    })
  }

  const unavailable = await context()
  try {
    await unavailable.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return /webgl/i.test(type) ? null : original.call(this, type, ...args)
      }
      window.__dadaQaRestoreWebGL = () => { HTMLCanvasElement.prototype.getContext = original }
    })
    const page = await newPage(unavailable)
    for (const effect of backgrounds) {
      await test(`${effect}：WebGL不可用时静态显示且横幅正文保留`, async () => {
        await page.goto(fixtureUrl(effect))
        await state(page, effect, 'failed')
        await readable(page)
        assert.equal(await page.locator(`${effectSelector(effect)} canvas`).count(), 0)
      })
    }
    await test('WebGL API恢复后重试重新显示装饰并保留业务输入', async () => {
      await seedBusiness(page)
      await page.evaluate(() => window.__dadaQaRestoreWebGL())
      await page.locator('#effect-frame .fx-failure').getByRole('button', {name: '重试', exact: true}).click({timeout: TIMEOUT})
      await page.locator(`${effectSelector('dot-grid')}[data-fx-state="animated"] canvas`).waitFor({timeout: TIMEOUT})
      await businessSurvived(page)
    })
  } finally { await unavailable.close() }

  const shader = await context()
  try {
    await shader.addInitScript(() => {
      for (const constructor of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
        if (!constructor) continue
        const original = constructor.prototype.getProgramParameter
        constructor.prototype.getProgramParameter = function (program, name) {
          return name === this.LINK_STATUS ? false : original.call(this, program, name)
        }
      }
    })
    const page = await newPage(shader)
    for (const effect of backgrounds) {
      await test(`${effect}：实际程序链接失败上报并保留正文`, async () => {
        await page.goto(fixtureUrl(effect))
        await state(page, effect, 'failed')
        await readable(page)
        assert.match(await page.locator(effectSelector(effect)).getAttribute('data-fx-reason'), /初始化失败/)
      })
    }
  } finally { await shader.close() }

  await test('原生WebGL上下文丢失可重试，业务输入与计数不重置', async () => {
    const ctx = await context()
    try {
      const page = await newPage(ctx)
      await page.goto(fixtureUrl('waves'))
      await page.locator(`${effectSelector('waves')}[data-fx-state="animated"] canvas`).waitFor({timeout: TIMEOUT})
      await seedBusiness(page)
      const supported = await page.locator(`${effectSelector('waves')} canvas`).evaluate((canvas) => {
        const extension = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')
        extension?.loseContext()
        return Boolean(extension)
      })
      assert.ok(supported, '本测试环境必须提供WEBGL_lose_context')
      await state(page, 'waves', 'failed')
      await readable(page)
      await page.locator('#effect-frame .fx-failure').getByRole('button', {name: '重试', exact: true}).click({timeout: TIMEOUT})
      await page.locator(`${effectSelector('waves')}[data-fx-state="animated"] canvas`).waitFor({timeout: TIMEOUT})
      await businessSurvived(page)
    } finally { await ctx.close() }
  })

  await test('懒加载失败保留卡片和可见重试，缓存失败提示刷新，切换效果恢复', async () => {
    const ctx = await context()
    try {
      const page = await newPage(ctx)
      const moduleUrl = /\/src\/fx\/vendor\/GlareHover\.tsx(?:\?|$)/
      let blocked = 0
      await page.route(moduleUrl, async (route) => { blocked += 1; await route.abort('failed') })
      await page.goto(fixtureUrl('glare-hover'))
      await state(page, 'glare-hover', 'failed')
      assert.ok(blocked > 0, '确实拦截了组件模块请求')
      await readable(page)
      await seedBusiness(page)
      const retry = page.locator('#effect-frame .fx-failure').getByRole('button', {name: '重试', exact: true})
      const [bounds, retryBounds] = await Promise.all([page.locator('#effect-frame').boundingBox(), retry.boundingBox()])
      assert.ok(bounds && retryBounds && retryBounds.y >= bounds.y && retryBounds.y + retryBounds.height <= bounds.y + bounds.height + 1, '重试按钮应位于卡片可见高度内')
      await page.unroute(moduleUrl)
      await retry.click({timeout: TIMEOUT})
      await page.getByText('仍无法加载时，可刷新页面再试。', {exact: true}).waitFor({timeout: TIMEOUT})
      await click(page, '文字')
      await page.locator(`${effectSelector('shiny-text')}[data-fx-state="animated"] .shiny-text`).waitFor({timeout: TIMEOUT})
      await businessSurvived(page)
    } finally { await ctx.close() }
  })

  await test('减少动画保留浅深分支配对的背景与正文颜色', async () => {
    const ctx = await context({reducedMotion: 'reduce'})
    try {
      const page = await newPage(ctx)
      await page.goto(fixtureUrl('waves'))
      await click(page, '模式配色')
      await click(page, '深色')
      await state(page, 'waves', 'static')
      await color(page, '#effect-frame .fx-static-backdrop', 'rgb(34, 17, 34)', 'backgroundColor')
      await color(page, '#effect-frame .fx-banner-text', 'rgb(237, 203, 169)')
      await readable(page)
      assert.equal(await page.locator('#effect-frame canvas').count(), 0)
    } finally { await ctx.close() }
  })

  await test('轮播高亮的实际文字沿用显式暗色分支', async () => {
    const ctx = await context()
    try {
      const page = await newPage(ctx)
      await page.goto(fixtureUrl('rotating-text'))
      await click(page, '模式配色')
      await click(page, '深色')
      await page.locator('#effect-frame .text-rotate-highlight').waitFor({timeout: TIMEOUT})
      await color(page, '#effect-frame .text-rotate-highlight', 'rgb(237, 203, 169)')
    } finally { await ctx.close() }
  })

  await test('图层失败从可访问说明重试，装饰aria-hidden中没有按钮', async () => {
    const ctx = await context()
    try {
      await ctx.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext
        HTMLCanvasElement.prototype.getContext = function (type, ...args) {
          return /webgl/i.test(type) ? null : original.call(this, type, ...args)
        }
        window.__dadaQaRestoreWebGL = () => { HTMLCanvasElement.prototype.getContext = original }
      })
      const page = await newPage(ctx)
      await page.goto(fixtureUrl('waves', '&layer=1'))
      await state(page, 'waves', 'failed')
      await seedBusiness(page)
      assert.equal(await page.locator('.fx-layers[aria-hidden="true"] button').count(), 0)
      await click(page, '特效已简化')
      const retry = page.getByRole('button', {name: '重试波纹线', exact: true})
      await retry.waitFor({timeout: TIMEOUT})
      assert.equal(await retry.evaluate((button) => Boolean(button.closest('[aria-hidden="true"]'))), false)
      await page.evaluate(() => window.__dadaQaRestoreWebGL())
      await retry.click({timeout: TIMEOUT})
      await page.locator(`.fx-layers ${effectSelector('waves').replace('#fixture ', '')}[data-fx-state="animated"] canvas`).waitFor({timeout: TIMEOUT})
      await businessSurvived(page)
    } finally { await ctx.close() }
  })
  console.log(`特效主题浏览器回归全部通过：${passed}/${passed}`)
} catch (error) {
  console.error(`失败（已通过${passed}项）：`, error)
  process.exitCode = 1
} finally {
  await browser.close()
}
