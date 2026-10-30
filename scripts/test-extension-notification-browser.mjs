import assert from 'node:assert/strict'
import {copyFile, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const {chromium} = require(process.env.DADA_PLAYWRIGHT_PATH || 'playwright')
const temporary = await mkdtemp(path.join(tmpdir(), 'dada-notification-regression-'))
const manifest = JSON.parse(await readFile(new URL('../browser-extension/manifest.json', import.meta.url), 'utf8'))
// 只加载本轮真实权限与图标，避免启动完整主页或接触用户浏览器配置。
delete manifest.chrome_url_overrides
delete manifest.action
delete manifest.sandbox
delete manifest.content_security_policy.sandbox
manifest.background = {service_worker: 'background.js'}
await writeFile(path.join(temporary, 'manifest.json'), JSON.stringify(manifest))
for (const size of [16, 48, 128]) await copyFile(new URL(`../extension/icon${size}.png`, import.meta.url), path.join(temporary, `icon${size}.png`))
await writeFile(path.join(temporary, 'background.js'), 'chrome.runtime.onInstalled.addListener(()=>{})')
await writeFile(path.join(temporary, 'probe.html'), '<!doctype html><meta charset="utf-8"><button>测试专注通知</button><script src="probe.js"></script>')
await writeFile(path.join(temporary, 'probe.js'), `
window.result={permission:Notification.permission};
document.querySelector('button').onclick=async()=>{
  result.requested=await Notification.requestPermission();
  try {
    const notification=window.notification=new Notification('专注完成',{body:'隔离扩展通知回归',icon:chrome.runtime.getURL('icon128.png'),tag:'dada-focus-qa'});
    result.created={title:notification.title,body:notification.body,tag:notification.tag};
    notification.onshow=()=>{result.shown=true};
    notification.onerror=()=>{result.error='浏览器拒绝创建通知'};
  } catch(error) {result.error=error.message}
};
`)
let context
try {
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${temporary}`, `--load-extension=${temporary}`],
  })
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/probe.html`)
  await page.getByRole('button', {name: '测试专注通知', exact: true}).click()
  await page.waitForFunction(() => window.result.shown || window.result.error, null, {timeout: 10000})
  const result = await page.evaluate(() => window.result)
  assert.equal(result.permission, 'granted', JSON.stringify(result))
  assert.equal(result.requested, 'granted', JSON.stringify(result))
  assert.deepEqual(result.created, {title: '专注完成', body: '隔离扩展通知回归', tag: 'dada-focus-qa'})
  assert.equal(result.shown, true, JSON.stringify(result))
  assert.equal(result.error, undefined)
  assert.deepEqual(errors, [])
  await page.evaluate(() => window.notification.close())
  console.log(JSON.stringify({result, errors, limitation: '验证 Chromium 通知创建与 show 事件；未验证系统横幅、勿扰模式和其他平台。'}, null, 2))
} finally {
  await context?.close()
  await rm(temporary, {recursive: true, force: true})
}
