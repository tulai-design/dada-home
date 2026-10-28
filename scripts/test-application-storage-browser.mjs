import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdirSync} from 'node:fs'
mkdirSync('/tmp/dada-application-storage-browser',{recursive:true})
const require = createRequire(import.meta.url)
const {chromium} = require(process.env.DADA_PLAYWRIGHT_PATH || 'playwright')
const base = (process.env.DADA_QA_URL || 'http://127.0.0.1:5176').replace(/\/$/, '')
const browser = await chromium.launch({headless:true})
let passed = 0
async function test(name, fn) {await fn(); passed++; console.log(`通过：${name}`)}
const source = `applet({state:{payload:'',count:0},persist:['payload','count'],view(s,ctx){return ui.Stack({},[
 ui.Text({text:'业务长度 '+s.payload.length+' 次数 '+s.count+' 设置 '+ctx.settings.label+' 形态 '+ctx.surface}),
 ui.Button({label:'保存大数据',onClick(){s.payload='中文🙂'.repeat(40000);s.count++}}),
 ui.Button({label:'递增',onClick(){s.count++}}),
 ui.Button({label:'超过预算',onClick(){s.payload='界'.repeat(3000000)}})
])}})`
const app = {
 html:'<button id="save">保存大数据</button><button id="increment">递增</button><button id="over">超过预算</button><output id="state"></output>',css:'',
 js:`let data={payload:'',count:0};const output=document.getElementById('state');const show=()=>output.textContent='业务长度 '+data.payload.length+' 次数 '+data.count+' 设置 '+tada.settings.label+' 形态 '+tada.surface;
 const save=async(next)=>{output.textContent='正在保存';try{await tada.store.set('data',next);data=next;show()}catch(e){output.textContent='保存失败 '+e.message}};
 document.getElementById('save').onclick=()=>save({payload:'中文🙂'.repeat(40000),count:data.count+1});
 document.getElementById('increment').onclick=()=>save({...data,count:data.count+1});
 document.getElementById('over').onclick=()=>save({payload:'界'.repeat(3000000),count:data.count});
 try{data=await tada.store.get('data')??data;show()}catch(e){output.textContent='读取失败 '+e.message}`,
}
try {
 const context = await browser.newContext({viewport:{width:1100,height:850},reducedMotion:'reduce'})
 await context.route('**/*',r=>r.request().url().startsWith(base+'/')&&!new URL(r.request().url()).pathname.startsWith('/__proxy')?r.continue():r.abort())
 const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message))
 const ready=async()=>{await page.goto(base+'/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__tada?.workspace())}
 const call=(name,args)=>page.evaluate(({name,args})=>window.__tada.call(name,args),{name,args})
 const create=async(kind,title)=>{
  const result=await call('create_'+kind,{title,...(kind==='app'?app:{source}),openMode:'drawer',settingsSchema:{label:{kind:'string',label:'标记',default:'初始'}},settings:{label:'初始'}})
  assert.match(result,/已安装/)
  return JSON.parse(await call('list_applications',{ref:title}))[0].id
 }
 const open=async(id)=>{const title=JSON.parse(await call('list_applications',{ref:id}))[0].instance.title;await page.keyboard.press('Meta+k');await page.locator('.cmdk-row').filter({has:page.locator('.cmdk-label',{hasText:title})}).click();await page.locator(`[data-application="${id}"].application-runtime`).waitFor()}
 const close=async(id)=>{await page.locator('.application-window').getByRole('button',{name:/close|关闭/i}).first().click();await page.locator(`[data-application="${id}"].application-runtime`).waitFor({state:'detached'})}
 const runtime=id=>page.locator(`[data-application="${id}"].application-runtime`)
 const body=(kind,id)=>kind==='app'?runtime(id).frameLocator('iframe.app-frame'):runtime(id)
 const waitState=async(kind,id,text)=>{if(kind==='app')await body(kind,id).locator('#state').filter({hasText:text}).waitFor();else await body(kind,id).getByText(text,{exact:true}).waitFor()}
 const flush=()=>page.evaluate(async()=>{await (await import('/src/lib/applicationData.ts')).flushApplicationData()})
 const stored=(kind,id)=>page.evaluate(async({kind,id})=>{const {db}=await import('/src/lib/db.ts');return (await db.get('apps',kind+':'+id))?.v},{kind,id})
 const inject=mode=>page.evaluate(mode=>{const proto=IDBObjectStore.prototype;window.restoreAppFault=()=>{proto.put=original};const original=proto.put;proto.put=function(...args){if(this.name==='apps'){if(mode==='quota')throw new DOMException('测试浏览器配额不足','QuotaExceededError');const result=original.apply(this,args);this.transaction.abort();return result}return original.apply(this,args)}},mode)
 const recover=()=>page.evaluate(()=>window.restoreAppFault())
 await ready()
 for(const kind of ['app','applet']) {
  const title=`存储验收 ${kind}`,id=await create(kind,title)
  await test(`${kind} 中文/emoji 超过旧100000字符，关闭/重开/刷新完整读回`,async()=>{
   await open(id);await waitState(kind,id,'业务长度 0 次数 0 设置 初始 形态 drawer')
   await body(kind,id).getByRole('button',{name:'保存大数据',exact:true}).click();await flush();await waitState(kind,id,'业务长度 160000 次数 1 设置 初始 形态 drawer')
   let saved=await stored(kind,id);assert.equal((kind==='app'?saved.data:saved).payload,'中文🙂'.repeat(40000))
   await close(id);await open(id);await waitState(kind,id,'业务长度 160000 次数 1 设置 初始 形态 drawer');await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__tada?.workspace());await open(id);await waitState(kind,id,'业务长度 160000 次数 1 设置 初始 形态 drawer')
  })
  await test(`${kind} 设置变化/重新挂载/卸载撤销保留独立业务数据`,async()=>{
   await call('configure_application',{ref:id,settings:{label:'修改'}});await waitState(kind,id,'业务长度 160000 次数 1 设置 修改 形态 drawer')
   await close(id);await call('mount_application',{ref:id,pageId:'home',span:'full'});const widget=page.locator(`.widget[data-id="${id}"]`);await widget.waitFor();if(kind==='app')await widget.frameLocator('iframe.app-frame').locator('#state').filter({hasText:'业务长度 160000 次数 1 设置 修改 形态 widget'}).waitFor();else await widget.getByText('业务长度 160000 次数 1 设置 修改 形态 widget',{exact:true}).waitFor()
   await call('mount_application',{ref:id,pageId:null});await call('uninstall_application',{ref:id});assert.ok(await stored(kind,id));assert.equal(await page.evaluate(async()=>(await import('/src/lib/workspaceStore.ts')).undo()),true);await open(id);await waitState(kind,id,'业务长度 160000 次数 1 设置 修改 形态 drawer')
  })
  await test(`${kind} 真IDB事务abort/quota故障不确认，重试保存最新值`,async()=>{
   await inject(kind==='app'?'abort':'quota');await body(kind,id).getByRole('button',{name:'递增',exact:true}).click()
   if(kind==='app')await body(kind,id).locator('#state').filter({hasText:'保存失败'}).waitFor();else await runtime(id).getByRole('alert').filter({hasText:'更改尚未保存'}).waitFor()
   const old=await stored(kind,id);assert.equal((kind==='app'?old.data:old).count,1)
   for(const width of [320,1100])for(const mode of ['light','dark']){
    await page.setViewportSize({width,height:850});await call('set_theme',{mode});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    assert.ok(await page.locator('.persistence-notice').evaluate(el=>el.scrollWidth<=el.clientWidth+1),`${kind} ${width} ${mode}错误提示无溢出`)
    if(kind==='applet'){assert.ok(await runtime(id).evaluate(el=>el.scrollWidth<=el.clientWidth+1),`Applet ${width} ${mode}保存错误无溢出`);if(width===320)await page.screenshot({path:`/tmp/dada-application-storage-browser/applet-error-${mode}.png`})}
   }
   await recover();await page.locator('.persistence-notice').getByRole('button',{name:'重试保存',exact:true}).click();await flush();if(kind==='applet')await runtime(id).getByRole('alert').filter({hasText:'更改尚未保存'}).waitFor({state:'detached'});await close(id);await open(id);await waitState(kind,id,'业务长度 160000 次数 2 设置 修改 形态 drawer')
  })
  await test(`${kind} UTF-8 8MiB超额拒绝且原值未截断`,async()=>{
   await body(kind,id).getByRole('button',{name:'超过预算',exact:true}).click()
   if(kind==='app')await body(kind,id).locator('#state').filter({hasText:/8 MiB/}).waitFor();else await runtime(id).getByRole('alert').filter({hasText:/8 MiB/}).waitFor()
   const saved=await stored(kind,id),value=kind==='app'?saved.data:saved;assert.equal(value.payload,'中文🙂'.repeat(40000));assert.equal(value.count,2)
   await close(id)
  })
  await test(`${kind} 点击修改后立即关窗，重开不会回退为旧值`,async()=>{
   await open(id);await waitState(kind,id,'业务长度 160000 次数 2 设置 修改 形态 drawer')
   await body(kind,id).getByRole('button',{name:'递增',exact:true}).click();await close(id);await open(id);await waitState(kind,id,'业务长度 160000 次数 3 设置 修改 形态 drawer');await flush();await close(id)
  })
 }
 await test('读取失败不执行Applet init，重新读取恢复原始值',async()=>{
  const id=await create('applet','读取故障');await page.evaluate(()=>{const original=IDBObjectStore.prototype.get;window.restoreReadFault=()=>{IDBObjectStore.prototype.get=original};IDBObjectStore.prototype.get=function(...args){if(this.name==='apps')throw new DOMException('测试读取不可用','UnknownError');return original.apply(this,args)}})
  await open(id);await runtime(id).getByRole('alert').filter({hasText:'无法读取应用数据'}).waitFor();assert.equal(await runtime(id).getByRole('button',{name:'保存大数据',exact:true}).count(),0)
  await page.evaluate(()=>window.restoreReadFault());await runtime(id).getByRole('button',{name:'重新读取',exact:true}).click();await waitState('applet',id,'业务长度 0 次数 0 设置 初始 形态 drawer');await close(id)
 })
 await test('应用不存在IndexedDB能力时不能伪装保存成功',async()=>{
  const isolated=await browser.newContext();await isolated.addInitScript(()=>Object.defineProperty(window,'indexedDB',{value:undefined}));const p=await isolated.newPage();await p.goto(base+'/tests/storage-regressions.html');await p.waitForFunction(()=>window.storageQA);const result=await p.evaluate(async()=>{const a=await import('/src/lib/applicationData.ts');try{await a.setApplicationValue({kind:'app',id:'unavailable'},'value',1);return 'saved'}catch(e){return e.message}});assert.match(result,/数据库|IndexedDB/);assert.notEqual(result,'saved');await isolated.close()
 })
 assert.deepEqual(errors,[]);await context.close();console.log(`全部通过：${passed}项应用存储浏览器验收`)
} finally {await browser.close()}
