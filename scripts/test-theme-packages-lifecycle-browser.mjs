import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {routeBuiltinFixtures} from './browser-builtin-fixtures.mjs'
const {chromium}=createRequire(import.meta.url)(process.env.DADA_PLAYWRIGHT_PATH||'playwright')
const base=process.env.DADA_QA_URL||'http://127.0.0.1:5201',out=process.env.DADA_QA_OUTPUT||'/tmp/dada-theme-packages-lifecycle'
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
  const font=readFileSync('node_modules/.pnpm/katex@0.16.47/node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2'),hash=bytes=>createHash('sha256').update(bytes).digest('hex')
  const canonical=value=>JSON.stringify(value,(_key,child)=>child&&typeof child==='object'&&!Array.isArray(child)?Object.fromEntries(Object.entries(child).sort(([a],[b])=>a.localeCompare(b))):child)
  const manifest={packageId:'qa.lifecycle',version:'1.0.0',kind:'declarative-theme',schemaVersion:1,name:'复古本地包',description:'Win98跨壳运行状态验收',requiredRenderers:[{skin:'win98',shell:'win98',skinVersion:1,shellVersion:1}],contributions:[{id:'retro',kind:'theme',design:{name:'复古本地包',description:'真实WOFF2与跨壳',skin:'win98',shell:'win98',overrides:{},light:{main:'#753344'},dark:{main:'#ddaacc'},fonts:[{family:'QA Local',role:'sans',resourceId:'face'}]}}],resources:[{id:'face',mime:'font/woff2',bytes:font.length,sha256:hash(font)}]};manifest.digest=hash(canonical(manifest))
  await page.keyboard.press('Meta+,');await page.locator('.settings-nav').filter({has:page.locator('.settings-nav-name',{hasText:/^外观$/})}).click()
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'导入主题包',exact:true}).click();await (await chooser).setFiles({name:'lifecycle.dada-theme.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({manifest,resources:[{id:'face',base64:font.toString('base64')}]}))})
  await page.getByRole('button',{name:'安装，保持停用',exact:true}).click();await page.getByRole('dialog',{name:'安装本地主题包',exact:true}).waitFor({state:'hidden'})
  // 取真实已加载的模块URL，避免HMR后重复实例；不添加生产测试入口。
  await page.evaluate(async identity=>{const url=performance.getEntriesByType('resource').map(item=>item.name).find(name=>/\/src\/lib\/themePackages\/index\.ts(?:\?|$)/.test(name));if(!url)throw new Error('真实包API模块未加载');window.packageApi=await import(url);window.packageIdentity=identity},{packageId:manifest.packageId,version:manifest.version,digest:manifest.digest})
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
  async function preserved(){assert.equal(await todoNode.evaluate(node=>node.isConnected),true);assert.equal(await todo.inputValue(),'主题事务期间未提交待办');assert.equal(await iframe.evaluate(node=>node.isConnected),true);assert.equal(await appFrame.getByRole('textbox',{name:'作者应用草稿',exact:true,includeHidden:true}).inputValue(),'生成应用未提交文本');await appFrame.getByText('初始化 1',{exact:true}).waitFor({state:'attached'});assert.equal(await chat.inputValue(),'应用主题以后再发的助手草稿');assert.equal(await approval.evaluate(node=>node.isConnected),true);assert.equal((await ws()).pages.some(page=>page.id===pageId),true);assert.equal(await page.evaluate(()=>window.modelRequests.length),1)}
  await check('包资源准备与启用不切主题且保留全部运行状态',async()=>{await page.evaluate(()=>window.packageApi.setThemePackageEnabled(window.packageIdentity,true));assert.equal((await ws()).theme.active,original.theme.active);await preserved()})
  await check('激活Win98包跨壳保留todo/app iframe-init/助手草稿与审批',async()=>{await page.evaluate(()=>window.packageApi.activateThemePackage(window.packageIdentity,'retro'));await settle();assert.equal(await page.evaluate(()=>document.documentElement.dataset.skin),'win98');await preserved()})
  const active=(await ws()).theme.active
  let draft=await call('create_theme_draft',{from:active,intent:'derive',name:'包状态草稿'})
  await check('当前包草稿先取得精确版本资源ready',async()=>{assert.equal((await call('inspect_theme_draft',{draftId:draft.id,expectedRevision:draft.revision})).ready,true)})
  await check('停用包跨壳回退paper/standard且保请求与全部运行状态',async()=>{await page.evaluate(()=>window.packageApi.setThemePackageEnabled(window.packageIdentity,false));await settle();assert.equal(await page.evaluate(()=>document.documentElement.dataset.skin??'paper'),'paper');assert.equal(await page.evaluate(()=>document.documentElement.dataset.shell),'standard');assert.equal((await ws()).theme.active,active);assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--font-sans').includes('TadaLocal_')),false);await preserved()})
  await check('停用generation立即使旧预览ready失效，不能应用旧资源',async()=>{const current=await call('get_theme_draft');assert.notEqual(current.preview.readiness.status,'ready');const report=await call('inspect_theme_draft',{draftId:draft.id,expectedRevision:draft.revision});assert.equal(report.ready,false);await assert.rejects(call('finish_theme_draft',{draftId:draft.id,expectedRevision:draft.revision,action:'apply'}));assert.equal((await ws()).theme.active,active);await preserved()})
  await call('finish_theme_draft',{draftId:draft.id,expectedRevision:draft.revision,action:'discard'})
  await check('再次启用恢复Win98完整设计而不重建业务实例',async()=>{await page.evaluate(()=>window.packageApi.setThemePackageEnabled(window.packageIdentity,true));await settle();assert.equal(await page.evaluate(()=>document.documentElement.dataset.skin),'win98');assert.equal((await ws()).theme.active,active);assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--main').trim()),'#753344');await preserved();await page.screenshot({path:`${out}/win98-package-lifecycle.png`})})
  await check('主题事务后停止仍取消待决操作且不删页面',async()=>{await page.getByRole('button',{name:'停止',exact:true}).click();await page.locator('.approval-card').waitFor({state:'detached'});assert.equal((await ws()).pages.some(page=>page.id===pageId),true)})
  await check('没有未处理错误',()=>assert.deepEqual(errors,[]))
}finally{writeFileSync(`${out}/results.json`,JSON.stringify({base,results,errors},null,2));await browser.close()}
console.log(`本地主题包跨壳生命周期 ${results.filter(result=>result.ok).length}/${results.length}`)
if(results.some(result=>!result.ok))process.exitCode=1
