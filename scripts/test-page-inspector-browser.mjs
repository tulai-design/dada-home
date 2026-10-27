import assert from 'node:assert/strict'
import {createRequire} from 'node:module'

// Browser tooling comes from the caller, keeping it out of production dependencies.
// DADA_PLAYWRIGHT_PATH=/absolute/path/to/playwright/index.js node scripts/test-page-inspector-browser.mjs
const require = createRequire(import.meta.url)
const {chromium} = require(process.env.DADA_PLAYWRIGHT_PATH || 'playwright')
const base = (process.env.DADA_QA_URL || 'http://127.0.0.1:5175').replace(/\/$/, '')
const browser = await chromium.launch({headless: true})
let passed = 0

async function readReport(page) {
  await page.locator('#inspect').click()
  return JSON.parse(await page.locator('#report').innerText())
}

try {
  for (const width of [320, 375, 768, 1280]) {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({viewport: {width, height: 900}, hasTouch: width < 480, reducedMotion: theme === 'dark' ? 'reduce' : 'no-preference'})
      try {
        const page = await context.newPage()
        page.setDefaultTimeout(10_000)
        await page.addInitScript((theme) => {document.addEventListener('DOMContentLoaded', () => {document.documentElement.dataset.theme = theme})}, theme)
        await page.goto(`${base}/tests/page-inspector-regressions.html`)
        await page.waitForFunction(() => document.querySelector('#results')?.textContent?.startsWith('通过：'))
        const broken = await readReport(page)
        const issue = broken.issues.find((item) => item.componentId === 'wide-widget')
        assert.equal(issue?.code, 'horizontal-overflow')
        assert.ok(issue.measurement.overflowPixels > 0)
        const dimensions = await page.locator('#inspection-page').evaluate((element) => ({width: element.clientWidth, height: element.clientHeight}))
        assert.deepEqual(broken.page.viewport, dimensions, '报告使用实际容器尺寸')
        assert.equal(broken.theme, theme)
        assert.equal(broken.reducedMotion, theme === 'dark')
        assert.equal((await readReport(page)).issues.find((item) => item.componentId === 'wide-widget').id, issue.id)
        assert.ok(broken.unknown.some((item) => item.code === 'iframe-content'))
        assert.ok(broken.unknown.some((item) => item.code === 'canvas-content'))
        assert.equal(JSON.stringify(broken).includes('INSPECTOR_PRIVATE'), false)
        await page.locator('#fix').click()
        const fixed = await readReport(page)
        assert.equal(fixed.issues.length, 0, '修复后真实溢出问题应消失')
        assert.notEqual(fixed.revision, broken.revision)
        await page.locator('#hidden').click()
        const hidden = await readReport(page)
        assert.equal(hidden.status, 'unknown')
        assert.equal(hidden.page.visible, false)
        assert.ok(hidden.unknown.some((item) => item.code === 'page-hidden'))
        passed += 1
        console.log(`通过：${width}px ${theme}，真实溢出→定位→修复→复查，私密内容与未知边界`)
      } finally {await context.close()}
    }
  }
  console.log(`页面检查器浏览器回归全部通过：${passed}/${passed}`)
} catch (error) {
  console.error(`失败（已通过${passed}项）：`, error)
  process.exitCode = 1
} finally {await browser.close()}
