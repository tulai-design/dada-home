import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdirSync,writeFileSync} from 'node:fs'
import {routeBuiltinFixtures} from './browser-builtin-fixtures.mjs'
const {chromium}=createRequire(import.meta.url)(process.env.DADA_PLAYWRIGHT_PATH||'playwright')
const base=process.env.DADA_QA_URL||'http://127.0.0.1:5201',out=process.env.DADA_QA_OUTPUT||'/tmp/dada-theme-authoring-lifecycle'
mkdirSync(out,{recursive:true})
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),results=[],errors=[]
await routeBuiltinFixtures(context,new URL(base).origin)
await context.route('https://fonts.googleapis.com/**',r=>r.fulfill({contentType:'text/css',body:''}))
await context.addInitScript(()=>{
  if(window!==window.top)return
  localStorage.setItem('fp.assistantPanelMode','"split"');localStorage.setItem('fp.sidebarAi','"split"')
  window.modelPlans=[];window.modelRequests=[]
  const original=window.fetch.bind(window)
  window.fetch=async(input,init)=>{
    if(!String(input).includes('/__authoring_model__/'))return original(input,init)
    window.modelRequests.push(JSON.parse(init.body));const plan=window.modelPlans.shift()
    if(!plan)throw new Error('主题作者夹具出现额外模型请求')
    const encoder=new TextEncoder(),delta=plan.tools?{tool_calls:plan.tools.map((tool,index)=>({index,id:tool.id,type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.args)}}))}:{content:plan.text}
    return new Response(new ReadableStream({start(controller){for(const chunk of [{choices:[{index:0,delta,finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:plan.tools?'tool_calls':'stop'}]}])controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));controller.enqueue(encoder.encode('data: [DONE]\n\n'));controller.close()}}),{headers:{'content-type':'text/event-stream'}})
  }
})
const page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message))
const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
const call=async(name,args={})=>{const result=await page.evaluate(({name,args})=>window.__tada.call(name,args),{name,args});await settle();try{return JSON.parse(result)}catch{return result}}
const ws=()=>page.evaluate(()=>window.__tada.workspace())
async function ready(){await page.locator('.app').waitFor({state:'attached'});await page.waitForFunction(()=>window.__tada?.workspace())}
async function command(label){await page.locator('body').click({position:{x:8,y:8}});await page.keyboard.press('Escape');await page.keyboard.press('Meta+k');await page.locator('.cmdk-row').filter({has:page.locator('.cmdk-label',{hasText:new RegExp(`^${label}$`)})}).click();await settle()}
async function check(name,fn){try{await fn();results.push({name,ok:true});console.log(`通过：${name}`)}catch(error){results.push({name,ok:false,error:error.message});console.error(`失败：${name} ${error.message}`);await page.screenshot({path:`${out}/failure-${results.length}.png`}).catch(()=>{})}}
try{
  await page.goto(base);await ready();await page.evaluate(async()=>{const {defaultSettings}=await import('/src/lib/defaults.ts');const settings=defaultSettings();settings.ai={baseUrl:location.origin+'/__authoring_model__/v1',apiKey:'isolated-fixture',model:'test-model',protocol:'openai'};localStorage.setItem('fp.settings',JSON.stringify(settings))});await page.reload();await ready()
  await call('install_addon',{id:'desk'});await command('书桌')
  const todo=page.getByPlaceholder('添一件待办，回车确认',{exact:true});await todo.fill('主题事务期间未提交待办');const todoNode=await todo.elementHandle()
  await call('create_app',{title:'主题作者运行验收',openMode:'modal',html:'<output id="init"></output><input aria-label="作者应用草稿">',css:'',js:'const n=(await tada.store.get("init")??0)+1;await tada.store.set("init",n);document.getElementById("init").textContent="初始化 "+n'})
  const id=(await ws()).applications.find(app=>app.instance.title==='主题作者运行验收').id
  await command('主题作者运行验收')
  const runtime=page.locator(`.application-runtime[data-application="${id}"]`),appFrame=runtime.frameLocator('iframe.app-frame'),iframe=await runtime.locator('iframe').elementHandle()
  await appFrame.getByText('初始化 1',{exact:true}).waitFor();await appFrame.getByRole('textbox',{name:'作者应用草稿',exact:true}).fill('生成应用未提交文本')
  await call('add_page',{name:'作者审批夹具'});const pageId=(await ws()).pages.find(page=>page.name==='作者审批夹具').id
  await page.locator('body').click({position:{x:8,y:8}});await page.keyboard.press('Meta+j')
  await page.evaluate(pageId=>{window.modelPlans=[{tools:[{id:'authoring-approval',name:'remove_page',args:{pageId}}]}]},pageId)
  const chat=page.getByRole('textbox',{name:'消息内容',exact:true});await chat.fill('删除作者审批夹具');await page.getByRole('button',{name:'发送',exact:true}).click();await page.locator('.approval-card').waitFor();const approval=await page.locator('.approval-card').elementHandle();await chat.fill('应用主题以后再发的助手草稿')
  const original=await ws()
  let draft=await call('create_theme_draft',{from:'ios',intent:'derive',name:'生命周期主题'})
  draft=await call('update_theme_draft',{draftId:draft.id,expectedRevision:draft.revision,operations:[{path:'fonts',scope:'resource',value:[]},{path:'main',scope:'both',value:'#8855bb'}]})
  async function preserved(){assert.equal(await todoNode.evaluate(node=>node.isConnected),true);assert.equal(await todo.inputValue(),'主题事务期间未提交待办');assert.equal(await iframe.evaluate(node=>node.isConnected),true);assert.equal(await appFrame.getByRole('textbox',{name:'作者应用草稿',exact:true,includeHidden:true}).inputValue(),'生成应用未提交文本');await appFrame.getByText('初始化 1',{exact:true}).waitFor({state:'attached'});assert.equal(await chat.inputValue(),'应用主题以后再发的助手草稿');assert.equal(await approval.evaluate(node=>node.isConnected),true);assert.equal((await ws()).pages.some(page=>page.id===pageId),true);assert.equal(await page.evaluate(()=>window.modelRequests.length),1)}
  await check('create/patch/inspect保留页面输入、应用DOM/init、助手草稿和待决审批',async()=>{assert.equal((await call('inspect_theme_draft',{draftId:draft.id,expectedRevision:draft.revision})).ready,true);await preserved();assert.deepEqual(await ws(),original)})
  await check('apply一次提交后同iOS宿主保留全部业务运行状态',async()=>{await call('finish_theme_draft',{draftId:draft.id,expectedRevision:draft.revision,action:'apply'});await preserved();assert.equal((await ws()).themes.length,original.themes.length+1);assert.notEqual((await ws()).theme.active,original.theme.active);assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--main').trim()),'#8855bb')})
  await check('一次真实撤销恢复原主题与选择，运行器和审批仍保留',async()=>{await command('撤销上一步');assert.equal((await ws()).theme.active,original.theme.active);assert.equal((await ws()).themes.length,original.themes.length);await preserved()})
  await check('主题事务后停止仍取消待决操作且不删页面',async()=>{await page.getByRole('button',{name:'停止',exact:true}).click();await page.locator('.approval-card').waitFor({state:'detached'});assert.equal((await ws()).pages.some(page=>page.id===pageId),true)})
  await check('没有未处理错误',()=>assert.deepEqual(errors,[]))
}finally{writeFileSync(`${out}/results.json`,JSON.stringify({base,results,errors},null,2));await browser.close()}
console.log(`主题作者生命周期 ${results.filter(result=>result.ok).length}/${results.length}`)
if(results.some(result=>!result.ok))process.exitCode=1
