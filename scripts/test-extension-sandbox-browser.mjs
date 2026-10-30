import assert from 'node:assert/strict'
import {cp, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const {chromium} = require(process.env.DADA_PLAYWRIGHT_PATH || 'playwright')
const root = new URL('../', import.meta.url)
const cache = new Map()
function load(relative) {
  if (cache.has(relative)) return cache.get(relative)
  const module = {exports: {}}
  cache.set(relative, module.exports)
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(relative, root), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText, {
    module, exports: module.exports,
    require: id => relative === 'src/lib/applet/runner.ts' && id === './catalog' ? load('src/lib/applet/catalog.ts') : id === '../lib/registry' ? {registerComponent() {}} : {},
    document: {documentElement: {}}, getComputedStyle: () => ({getPropertyValue: () => ''}),
  })
  return module.exports
}
const {buildSrcdoc} = load('src/widgets/app.tsx')
const {buildRunnerDoc} = load('src/lib/applet/runner.ts')
const temporary = await mkdtemp(path.join(tmpdir(), 'dada-sandbox-regression-'))
const extension = path.join(temporary, 'extension')
await cp(new URL('browser-extension/', root), extension, {recursive: true})
const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'))
delete manifest.icons
delete manifest.action
delete manifest.chrome_url_overrides
manifest.background = {service_worker: 'background.js'}
await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest))
await writeFile(path.join(extension, 'background.js'), 'chrome.runtime.onInstalled.addListener(()=>{})')
await writeFile(path.join(extension, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><title>搭搭沙盒回归</title></head><body><script src="fixture.js"></script></body></html>')
await writeFile(path.join(extension, 'fixture.js'), `
window.saved={app:{count:4},applet:{count:7}};window.messages=[];window.errors=[];window.views=[];
window.mount=(kind,document,session)=>new Promise(resolve=>{
  document=String(document);window.currentSession=session;
  window.currentFrame?.remove();
  const frame=window.currentFrame=window.document.createElement('iframe');frame.setAttribute('sandbox','allow-scripts');frame.src='sandbox.html';
  frame.onload=()=>{frame.contentWindow.postMessage({dadaSandbox:1,session,document},'*');resolve()};
  window.document.body.append(frame);
});
window.post=payload=>currentFrame.contentWindow.postMessage({session:currentSession,...payload},'*');
addEventListener('message',event=>{
 if(event.source!==window.currentFrame?.contentWindow||event.data?.session!==window.currentSession)return;
 const m=event.data;messages.push(m);
 if(m.tada===1){
  if(m.op==='error'){errors.push(m.message);return}
  if(m.op==='get')post({tada:1,id:m.id,result:saved.app[m.key]??null});
  if(m.op==='set'){saved.app[m.key]=m.value;post({tada:1,id:m.id,result:true})}
 }
 if(m.applet===1){
  if(m.k==='ready')post({applet:1,k:'init',saved:saved.applet,settings:{label:'设置'},surface:'widget',viewport:{width:400,compact:true},dark:false});
  if(m.k==='view')views.push(m.tree);
  if(m.k==='save'){saved.applet=m.data;post({applet:1,k:'save-reply',id:m.id})}
  if(m.k==='error')errors.push(m.message);
 }
});
`)

const context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
  channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
})
try {
  await context.route('https://esm.sh/dada-regression', route => route.fulfill({status: 200, headers: {'access-control-allow-origin': '*', 'content-type': 'text/javascript'}, body: 'export const increment=value=>value+1'}))
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
  const page = await context.newPage()
  page.setDefaultTimeout(6000)
  const consoleErrors = []
  page.on('pageerror', error => consoleErrors.push(error.message))
  page.on('console', message => {if (message.type() === 'error') consoleErrors.push(message.text())})
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/index.html`)
  const app = buildSrcdoc({html: '<button id="increment">增加</button><output id="state"></output>', css: '', js: `
import {increment} from 'https://esm.sh/dada-regression';
let count=await tada.store.get('count');
const draw=()=>document.getElementById('state').textContent=count+' / '+tada.settings.label+' / '+tada.surface;
document.getElementById('increment').onclick=async()=>{count=increment(count);await tada.store.set('count',count);draw()};draw();
parent.postMessage({tada:1,session:'app-one',id:999,op:'probe',extensionApi:typeof chrome?.runtime},'*');
`, height: 240, settings: {label: '设置'}, surface: 'widget'}, [], false, 'app-one')
  await page.evaluate(({document, session}) => window.mount('app', document, session), {document: app, session: 'app-one'})
  const body = page.frameLocator('iframe')
  await body.locator('#state').filter({hasText: '4 / 设置 / widget'}).waitFor()
  await body.getByRole('button', {name: '增加'}).click()
  await body.locator('#state').filter({hasText: '5 / 设置 / widget'}).waitFor()
  assert.equal(await page.evaluate(() => window.saved.app.count), 5)
  assert.equal(await page.evaluate(() => window.messages.find(m => m.op === 'probe').extensionApi), 'undefined')
  await page.evaluate(() => window.post({tada: 1, op: 'theme', dark: true, variables: {'--text': '#ffffff'}}))
  await body.locator('html[data-theme="dark"]').waitFor()
  assert.equal(await body.locator('#state').textContent(), '5 / 设置 / widget')

  const source = `import {increment} from 'https://esm.sh/dada-regression';applet({state:{count:0},persist:['count'],view:(s,ctx)=>ui.Button({onClick:()=>s.count=increment(s.count)},s.count+' / '+ctx.settings.label+' / '+ctx.surface)})`
  await page.evaluate(({document, session}) => window.mount('applet', document, session), {document: buildRunnerDoc(source, 'applet-one'), session: 'applet-one'})
  await page.waitForFunction(() => window.views.at(-1)?.c?.[0]?.p?.text === '7 / 设置 / widget')
  const fn = await page.evaluate(() => window.views.at(-1).p.onClick.$fn)
  await page.evaluate(fn => window.post({applet: 1, k: 'event', fn}), fn)
  await page.waitForFunction(() => window.saved.applet.count === 8 && window.views.at(-1)?.c?.[0]?.p?.text === '8 / 设置 / widget')
  await page.evaluate(({document, session}) => window.mount('applet', document, session), {document: buildRunnerDoc(source, 'applet-two'), session: 'applet-two'})
  await page.waitForFunction(() => window.views.at(-1)?.c?.[0]?.p?.text === '8 / 设置 / widget')
  assert.deepEqual(await page.evaluate(() => window.errors), [])
  assert.deepEqual(consoleErrors, [])
  console.log('真实 MV3 沙盒通过：App SDK/持久桥/交互/主题，Applet 积木/事件/保存/恢复，远程 ESM 合成响应，扩展 API 隔离。')
} finally {
  await context.close()
  await rm(temporary, {recursive: true, force: true})
}
