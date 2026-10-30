import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {routeBuiltinFixtures} from './browser-builtin-fixtures.mjs'
const {chromium}=createRequire(import.meta.url)(process.env.DADA_PLAYWRIGHT_PATH||'playwright')
const mode=process.env.DADA_QA_MODE||'pwa',base=process.env.DADA_QA_URL||'http://127.0.0.1:5204',out=process.env.DADA_QA_OUTPUT||`/tmp/dada-theme-preview-${mode}`
await mkdir(out,{recursive:true})
const results=[],errors=[],csp=[],profile=await mkdtemp(path.join(tmpdir(),'dada-theme-preview-packaged-'))
let context,browser,page
async function check(name,fn){try{await fn();results.push({name,ok:true});console.log(`通过：${name}`)}catch(error){results.push({name,ok:false,error:error.message});console.error(`失败：${name} ${error.message}`);await page?.screenshot({path:`${out}/failure-${results.length}.png`}).catch(()=>{})}}
async function select(label,option){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:option,exact:true}).click()}
async function openAuthor(){
  await page.keyboard.press('Meta+,');await page.locator('.settings-nav').filter({has:page.locator('.settings-nav-name',{hasText:/^外观$/})}).click();await page.getByRole('button',{name:'创建变体',exact:true}).click();await page.getByRole('dialog',{name:'主题作者',exact:true}).waitFor()
  await select('主题字段分组','字体资源')
  await page.getByRole('textbox',{name:'字体资源',exact:true}).fill('[]');await page.locator('[data-theme-field="fonts"]').getByRole('button',{name:'修改',exact:true}).click()
  await page.locator('.theme-author-status').getByText('资源检查完成',{exact:true}).waitFor({timeout:15000})
}
try{
  if(mode==='extension'){
    const extension=path.resolve(process.env.DADA_EXTENSION_DIR||'dist-extension')
    context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1440,height:1000},reducedMotion:'reduce',args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]})
    await context.route('**/*',route=>/^https?:/.test(route.request().url())?route.abort():route.continue())
    const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker')
    page=await context.newPage();await page.goto(`chrome-extension://${new URL(worker.url()).host}/index.html`)
  }else{
    browser=await chromium.launch({headless:true});context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'})
    await routeBuiltinFixtures(context,new URL(base).origin)
    page=await context.newPage();await page.goto(base)
  }
  page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&/Content Security Policy|Refused to execute|script-src/.test(message.text()))csp.push(message.text())})
  await page.locator('.app').waitFor({state:'attached'})
  if(mode==='extension')for(let attempt=0;attempt<8;attempt++){
    const reject=page.getByRole('button',{name:'暂不连接',exact:true})
    if(!await reject.isVisible()) {await page.waitForTimeout(250);if(!await reject.isVisible())break}
    await reject.click();await page.waitForTimeout(100)
  }
  await check(`${mode}正式构建无开发工具桥`,async()=>assert.equal(await page.evaluate(()=>!!window.__tada),false))
  if(mode==='pwa')await check('PWA激活后离线新页面仍能启动正式App',async()=>{
    await page.evaluate(()=>navigator.serviceWorker.ready)
    await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller)
    await context.setOffline(true)
    const old=page;page=await context.newPage();page.setDefaultTimeout(10000);await page.goto(base);await page.locator('.app').waitFor({state:'attached'});await old.close()
  })
  await check(`${mode}真实UI创建并通过独立预览消息/资源检查`,async()=>{await openAuthor();const child=page.frames().find(frame=>frame.url().includes('/theme-preview.html'));assert.ok(child);assert.equal(await child.locator('[data-preview-fixture]').count(),1);assert.equal(await child.evaluate(()=>!!document.querySelector('.app')),false);assert.equal(await child.evaluate(()=>document.documentElement.dataset.skin),'ios');assert.equal(await child.evaluate(()=>document.querySelectorAll('link[data-theme-font]').length),0)})
  await check(`${mode}真实iframe内Lobe portal可用且不落父body`,async()=>{const child=page.frames().find(frame=>frame.url().includes('/theme-preview.html'));const before=await page.locator('.lobe-modal').count();await child.getByRole('button',{name:'打开弹窗',exact:true}).click();await child.locator('#preview-portals .lobe-modal').waitFor();assert.equal(await page.locator('.lobe-modal').count(),before);await child.getByRole('button',{name:'关闭',exact:true}).click()})
  await check(`${mode}真实Lobe Drawer portal可用且归iframe`,async()=>{const child=page.frames().find(frame=>frame.url().includes('/theme-preview.html')),before=await page.locator('.lobe-drawer').count();await child.getByRole('button',{name:'打开抽屉',exact:true}).click();await child.locator('#preview-portals .lobe-drawer').waitFor();assert.equal(await page.locator('.lobe-drawer').count(),before);await child.getByRole('button',{name:'关闭抽屉样本',exact:true}).click();await child.locator('#preview-portals .lobe-drawer').waitFor({state:'hidden'});await page.screenshot({path:`${out}/packaged-author-desktop.png`})})
  await check(`${mode}真实UI应用与取消都可用`,async()=>{await page.getByRole('button',{name:'应用此方案',exact:true}).click();await page.locator('.theme-authoring').waitFor({state:'detached'});await page.getByRole('button',{name:'创建变体',exact:true}).click();await page.getByRole('button',{name:'取消草稿',exact:true}).click();await page.locator('.theme-authoring').waitFor({state:'detached'});assert.equal(await page.locator('iframe[title="隔离主题预览"]').count(),0)})
  await check(`${mode}无未处理脚本/CSP错误`,()=>{assert.deepEqual(errors,[]);assert.deepEqual(csp,[])})
}finally{
  await writeFile(`${out}/results.json`,JSON.stringify({mode,base,results,errors,csp},null,2));await context?.close();await browser?.close();await rm(profile,{recursive:true,force:true})
}
console.log(`正式主题预览 ${mode} ${results.filter(result=>result.ok).length}/${results.length}`)
if(results.some(result=>!result.ok))process.exitCode=1
