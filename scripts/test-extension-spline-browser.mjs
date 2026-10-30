import assert from 'node:assert/strict'
import {cp, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const {chromium} = require(process.env.DADA_PLAYWRIGHT_PATH || 'playwright')
const temporary = await mkdtemp(path.join(tmpdir(), 'dada-spline-regression-'))
const extension = path.join(temporary, 'extension')
await cp(new URL('../dist-extension/', import.meta.url), extension, {recursive: true})
const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'))
delete manifest.chrome_url_overrides
delete manifest.action
manifest.background = {service_worker: 'background.js'}
await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest))
await writeFile(path.join(extension, 'background.js'), 'chrome.runtime.onInstalled.addListener(()=>{})')
await writeFile(path.join(extension, 'probe.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><iframe src="spline.html" sandbox="allow-scripts" style="width:640px;height:480px;border:0"></iframe><script src="probe.js"></script></body></html>')
const scene = process.env.DADA_SPLINE_SCENE || 'https://prod.spline.design/6Wq1Q7YGyM-iab9i/scene.splinecode'
await writeFile(path.join(extension, 'probe.js'), `
const frame=document.querySelector('iframe');window.messages=[];
frame.onload=()=>frame.contentWindow.postMessage({dadaSpline:1,session:'spline-probe',kind:'load',scene:${JSON.stringify(scene)}},'*');
addEventListener('message',event=>{if(event.source===frame.contentWindow)messages.push(event.data)});
`)
const context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
  channel: 'chromium', headless: true,
  viewport: {width: 900, height: 700},
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--enable-unsafe-swiftshader'],
})
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {if (message.type() === 'error') errors.push(message.text())})
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/probe.html`)
  await page.waitForFunction(() => window.messages.some(message => message.kind === 'loaded' || message.kind === 'error'), null, {timeout: 45000})
  const messages = await page.evaluate(() => window.messages)
  assert.ok(messages.some(message => message.kind === 'loaded'), JSON.stringify({messages, errors}, null, 2))
  const frame = page.frames().find(frame => frame.url().endsWith('/spline.html'))
  assert.ok(frame)
  const dimensions = () => frame.evaluate(() => {
    const canvas = document.querySelector('canvas')
    return {width: canvas.width, height: canvas.height, extensionApi: typeof globalThis.chrome?.runtime}
  })
  // Decode browser-composited pixels; the renderer may use WebGPU rather than WebGL.
  const screenshotPixels = async name => {
    const buffer = await page.locator('iframe').screenshot({path: `/tmp/dada-extension-spline-${name}.png`})
    return page.evaluate(async base64 => {
      const image = new Image()
      image.src = `data:image/png;base64,${base64}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width; canvas.height = image.height
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0)
      const {data} = context.getImageData(0, 0, canvas.width, canvas.height)
      const colors = new Set()
      let dark = 0
      for (let index = 0; index < data.length; index += 4) {
        colors.add(`${data[index] >> 4},${data[index + 1] >> 4},${data[index + 2] >> 4}`)
        if (Math.max(data[index], data[index + 1], data[index + 2]) < 180) dark++
      }
      return {width: canvas.width, height: canvas.height, colors: colors.size, dark}
    }, buffer.toString('base64'))
  }
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const desktop = await dimensions()
  assert.ok(desktop.width >= 600 && desktop.height >= 400, JSON.stringify(desktop))
  assert.equal(desktop.extensionApi, 'undefined')
  const desktopPixels = await screenshotPixels('desktop')
  assert.ok(desktopPixels.colors > 20 && desktopPixels.dark > 100, JSON.stringify(desktopPixels))
  await page.setViewportSize({width: 390, height: 600})
  await page.locator('iframe').evaluate(element => {element.style.width = '360px'; element.style.height = '280px'})
  await frame.waitForFunction(() => {const canvas = document.querySelector('canvas'); return canvas.width === 360 && canvas.height === 280})
  const mobile = await dimensions()
  const mobilePixels = await screenshotPixels('mobile')
  assert.ok(mobilePixels.colors > 20 && mobilePixels.dark > 100, JSON.stringify(mobilePixels))
  assert.equal(errors.some(error => /Content Security Policy|unsafe-eval|Refused to/.test(error)), false, JSON.stringify(errors))
  console.log(JSON.stringify({scene, messages, desktop, desktopPixels, mobile, mobilePixels, errors}, null, 2))
} finally {
  await context.close()
  await rm(temporary, {recursive: true, force: true})
}
