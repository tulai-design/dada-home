import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdirSync,writeFileSync} from 'node:fs'
import {routeBuiltinFixtures} from './browser-builtin-fixtures.mjs'
const require=createRequire(import.meta.url),{chromium}=require(process.env.DADA_PLAYWRIGHT_PATH||'playwright')
const base=(process.env.DADA_QA_URL||'http://127.0.0.1:5201').replace(/\/$/,''),out=process.env.DADA_QA_OUTPUT||'/tmp/dada-theme-preview-browser'
mkdirSync(out,{recursive:true})
const browser=await chromium.launch({headless:true}),results=[],errors=[]
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'})
await routeBuiltinFixtures(context,new URL(base).origin)
await context.route('https://fonts.googleapis.com/**',route=>route.fulfill({status:404,contentType:'text/css',body:'fixture missing font'}))
await context.addInitScript(()=>{
  window.__previewHeld=[];window.__previewGate=false
  window.addEventListener('message',event=>{if(window.__previewGate&&event.data?.type==='report'&&event.data?.protocol==='dada-theme-preview-v1'){window.__previewHeld.push(event.data);event.stopImmediatePropagation()}},true)
})
const page=await context.newPage()
page.on('pageerror',error=>errors.push(error.message))
const previewRequests=[]
page.on('request',request=>{try{if(request.frame().url().includes('theme-preview.html'))previewRequests.push(request.url())}catch{}})
const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
const call=async(name,args={})=>{const result=await page.evaluate(({name,args})=>window.__tada.call(name,args),{name,args});await settle();try{return JSON.parse(result)}catch{return result}}
const workspace=()=>page.evaluate(()=>window.__tada.workspace())
const draft=()=>call('get_theme_draft')
const update=async operations=>{const current=await draft();return call('update_theme_draft',{draftId:current.id,expectedRevision:current.revision,operations})}
const inspect=async()=>{const current=await draft();return call('inspect_theme_draft',{draftId:current.id,expectedRevision:current.revision})}
const finish=async action=>{const current=await draft();return call('finish_theme_draft',{draftId:current.id,expectedRevision:current.revision,action})}
const frame=()=>page.frames().find(frame=>frame.url().includes('theme-preview.html'))
async function check(name,fn){try{await fn();results.push({name,ok:true});console.log(`通过：${name}`)}catch(error){results.push({name,ok:false,error:error.message});console.error(`失败：${name} ${error.message}`);await page.screenshot({path:`${out}/failure-${results.length}.png`,fullPage:true}).catch(()=>{})}}
async function select(label,option){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:option,exact:true}).click()}
async function modeWidth(mode,width){await page.locator('.theme-author-toolbar').getByText(mode==='light'?'浅色':'深色',{exact:true}).click();await select('预览宽度',`${width}px${width===480?' · 窄分栏':''}`);await settle();return inspect()}
try{
  await page.goto(base);await page.locator('.app').waitFor({state:'attached'});await page.waitForFunction(()=>window.__tada?.workspace())
  await call('set_theme',{light:{main:'#2468ac'},dark:{main:'#13579b'}})
  const original=await workspace(),rootBefore=await page.evaluate(()=>({style:document.documentElement.getAttribute('style'),skin:document.documentElement.dataset.skin,mode:document.documentElement.dataset.theme,fonts:[...document.querySelectorAll('link[data-theme-font]')].map(link=>link.href).sort()}))
  const parentRoot=await page.locator('.app').elementHandle()
  await check('真实工具create自动显示稳定作者面板，零正式写入',async()=>{await call('create_theme_draft',{from:'switch',intent:'derive',name:'隔离预览'});await page.getByRole('dialog',{name:'主题作者',exact:true}).waitFor();assert.deepEqual(await workspace(),original)})
  await update([{path:'fonts',scope:'resource',value:[]},{path:'main',scope:'light',value:'#993355'},{path:'main',scope:'dark',value:'#77cc99'},{path:'button.radius',scope:'recipe',value:13},{path:'input.radius',scope:'recipe',value:9},{path:'coverScale',scope:'shell',value:120}])
  await check('inspect真实iframe当前revision/资源与有限几何可用',async()=>{const report=await inspect();assert.equal(report.ready,true);assert.equal(report.revision,(await draft()).revision);assert.equal(report.geometry.viewport,390);assert.equal(report.geometry.overflow,false);assert.ok(report.limits.some(text=>text.includes('unknown')));assert.equal((await draft()).preview.readiness.status,'ready')})
  await check('父iOS与预览Switch同时不同色且父root与字体links不变',async()=>{const child=await frame().evaluate(()=>({skin:document.documentElement.dataset.skin,main:getComputedStyle(document.documentElement).getPropertyValue('--main').trim()}));assert.equal(child.skin,'switch');assert.equal(child.main,'#993355');assert.deepEqual(await page.evaluate(()=>({style:document.documentElement.getAttribute('style'),skin:document.documentElement.dataset.skin,mode:document.documentElement.dataset.theme,fonts:[...document.querySelectorAll('link[data-theme-font]')].map(link=>link.href).sort()})),rootBefore);assert.equal(await parentRoot.evaluate(node=>node.isConnected),true)})
  await check('正式recipe adapter在真实Lobe按钮/输入生效且封面比例被消费',async()=>{const value=await frame().evaluate(()=>({button:getComputedStyle(document.querySelector('.preview-controls .lobe-button')).borderRadius,input:getComputedStyle(document.querySelector('.preview-card .lobe-input')).borderRadius,cover:document.querySelector('.preview-switch-cover').getBoundingClientRect().width}));assert.equal(value.button,'13px');assert.equal(value.input,'9px');assert.equal(value.cover,180)})
  await check('Lobe modal和通知portal归iframe而非父body',async()=>{const before=await page.locator('.lobe-modal').count();await frame().getByRole('button',{name:'打开弹窗',exact:true}).click();await frame().locator('#preview-portals .lobe-modal').waitFor();assert.equal(await page.locator('.lobe-modal').count(),before);assert.equal(await frame().locator('#preview-portals [data-preview-portal]').count(),1);await frame().getByRole('button',{name:'关闭',exact:true}).click()})
  await check('真实Lobe Drawer portal归iframe且可关闭',async()=>{const before=await page.locator('.lobe-drawer').count();await frame().getByRole('button',{name:'打开抽屉',exact:true}).click();await frame().locator('#preview-portals .lobe-drawer').waitFor();assert.equal(await page.locator('.lobe-drawer').count(),before);await frame().getByRole('textbox',{name:'抽屉预览输入',exact:true}).fill('仅预览');await frame().getByRole('button',{name:'关闭抽屉样本',exact:true}).click();await frame().locator('#preview-portals .lobe-drawer').waitFor({state:'hidden'})})
  await check('Agent metadata更新同步表单',async()=>{const current=await draft();await call('update_theme_draft',{draftId:current.id,expectedRevision:current.revision,name:'Agent改名',description:'新说明'});assert.equal(await page.getByLabel('主题草稿名称',{exact:true}).inputValue(),'Agent改名');assert.equal(await page.getByLabel('主题草稿说明',{exact:true}).inputValue(),'新说明')})
  await check('iframe重载使旧ready失效并自动重新渲染当前revision',async()=>{await inspect();const child=frame();await Promise.all([child.waitForNavigation({waitUntil:'load'}),child.evaluate(()=>location.reload())]);await page.frameLocator('iframe[title="隔离主题预览"]').locator('[data-preview-fixture]').waitFor();const report=await inspect();assert.equal(report.ready,true);assert.equal(report.revision,(await draft()).revision);assert.equal((await draft()).preview.readiness.status,'ready')})
  await check('收起保留iframe，检查明确不可用，patch自动重展',async()=>{const child=frame(),handle=await child.locator('[data-preview-fixture]').elementHandle();await page.getByRole('button',{name:'收起预览'}).click();await assert.rejects(inspect(),/已收起/);assert.equal((await draft()).preview.readiness.status,'unavailable');assert.equal(await handle.evaluate(node=>node.isConnected),true);await update([{path:'main',scope:'both',value:'#aa3388'}]);await page.getByRole('dialog',{name:'主题作者',exact:true}).waitFor();assert.equal(frame(),child);assert.equal((await inspect()).ready,true)})
  await check('source/origin/channel/id/revision/requestId坏回执全部拒绝',async()=>{
    await page.evaluate(async()=>{window.__previewHeld=[];window.__previewGate=true;window.__inspectionState='pending';const draft=JSON.parse(await window.__tada.call('get_theme_draft',{}));window.__tada.call('inspect_theme_draft',{draftId:draft.id,expectedRevision:draft.revision}).then(value=>{window.__inspectionState='resolved';window.__inspectionValue=JSON.parse(value)},error=>{window.__inspectionState='failed';window.__inspectionValue=error.message})})
    await page.waitForFunction(()=>window.__previewHeld.length>0)
    const held=await page.evaluate(()=>{window.__previewGate=false;return window.__previewHeld.at(-1)})
    await page.evaluate(held=>{window.postMessage(held,location.origin);const iframe=document.querySelector('iframe[title="隔离主题预览"]');window.dispatchEvent(new MessageEvent('message',{data:held,source:iframe.contentWindow,origin:'https://wrong.invalid'}))},held)
    for(const patch of [{channel:'wrong'},{draftId:'wrong'},{revision:0},{requestId:'wrong'}])await frame().evaluate(({held,patch})=>parent.postMessage({...held,...patch},location.origin),{held,patch})
    await page.waitForTimeout(120);assert.equal(await page.evaluate(()=>window.__inspectionState),'pending')
    await frame().evaluate(held=>parent.postMessage(held,location.origin),held)
    await page.waitForFunction(()=>window.__inspectionState==='resolved');assert.equal(await page.evaluate(()=>window.__inspectionValue.ready),true)
  })
  await finish('discard')
  for(const skin of process.env.DADA_QA_SKIP_MATRIX==='1'?[]:['default','ios','pixel','switch','win98']){
    await call('create_theme_draft',{from:skin,intent:'derive'})
    await update([{path:'fonts',scope:'resource',value:[]},{path:'main',scope:'light',value:'#993355'},{path:'main',scope:'dark',value:'#77cc99'},...(skin==='win98'?[{path:'windowGap',scope:'shell',value:20}]:[])])
    for(const mode of ['light','dark'])for(const width of [1440,390,320,480])await check(`${skin} ${mode} ${width}px真实静态夹具`,async()=>{
      const report=await modeWidth(mode,width);assert.equal(report.ready,true);assert.equal(report.mode,mode);assert.equal(report.width,width);assert.equal(report.geometry.viewport,width);assert.equal(report.geometry.overflow,false)
      const value=await frame().evaluate(()=>({main:getComputedStyle(document.documentElement).getPropertyValue('--main').trim(),skin:document.documentElement.dataset.skin??'paper',motion:document.documentElement.dataset.previewMotion,button:getComputedStyle(document.querySelector('.preview-controls .lobe-button')).boxShadow,margin:document.querySelector('.preview-win98')?getComputedStyle(document.querySelector('.preview-win98')).marginLeft:null}))
      assert.equal(value.main,mode==='light'?'#993355':'#77cc99');assert.equal(value.skin,skin==='default'?'paper':skin);assert.equal(value.motion,'reduce');if(skin==='win98'){assert.equal(value.margin,'20px');assert.notEqual(value.button,'none')}
      assert.deepEqual(await workspace(),original)
      if((skin==='switch'&&mode==='dark'&&width===320)||(skin==='win98'&&mode==='light'&&width===480))await page.screenshot({path:`${out}/${skin}-${mode}-${width}.png`,fullPage:true})
    })
    await finish('discard')
  }
  await check('非法批次不修改草稿、不影响正式数据',async()=>{await call('create_theme_draft',{from:'ios',intent:'derive'});const before=await draft();await assert.rejects(update([{path:'main',scope:'both',value:'#abcdef'},{path:'url',scope:'shared',value:'evil'}]));assert.equal((await draft()).revision,before.revision);assert.deepEqual((await draft()).theme,before.theme);assert.deepEqual(await workspace(),original)})
  await update([{path:'fonts',scope:'resource',value:[{family:'Missing Preview Font',role:'sans'}]}])
  await check('字体404降级明确且apply失败保留正式主题和草稿',async()=>{const report=await inspect();assert.equal(report.ready,false);assert.equal(report.resources[0].status,'error');assert.match(report.resources[0].reason,/字体|样式表/);await assert.rejects(finish('apply'));assert.deepEqual(await workspace(),original);assert.ok(await draft())})
  await update([{path:'fonts',scope:'resource',value:[]}])
  await check('用户明确系统字体后可恢复ready且只在点击应用时正式提交',async()=>{assert.equal((await inspect()).ready,true);assert.deepEqual(await workspace(),original);await page.getByRole('button',{name:'应用此方案',exact:true}).click();await page.locator('.theme-authoring').waitFor({state:'detached'});assert.notEqual((await workspace()).theme.active,original.theme.active);assert.equal(await draft(),null)})
  await check('取消清除preview且不保存草稿，刷新不重建草稿',async()=>{await call('create_theme_draft',{from:'win98',intent:'derive'});await finish('discard');assert.equal(await page.locator('iframe[title="隔离主题预览"]').count(),0);await page.reload();await page.locator('.app').waitFor({state:'attached'});await page.waitForFunction(()=>window.__tada?.workspace());assert.equal(await draft(),null)})
  await call('create_theme_draft',{from:'win98',intent:'derive'})
  await update([{path:'fonts',scope:'resource',value:[]}])
  for(const width of [390,320])await check(`正式作者面板${width}px容器可用且无重叠/横向溢出`,async()=>{await page.setViewportSize({width,height:900});await settle();assert.equal((await inspect()).ready,true);const geometry=await page.locator('.theme-authoring').evaluate(node=>({left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right,scroll:node.querySelector('.theme-author-layout').scrollWidth,client:node.querySelector('.theme-author-layout').clientWidth,previewBottom:node.querySelector('.theme-author-preview').getBoundingClientRect().bottom,editorTop:node.querySelector('.theme-author-editor').getBoundingClientRect().top}));assert.ok(geometry.left>=0&&geometry.right<=width);assert.ok(geometry.scroll<=geometry.client+1);assert.ok(geometry.editorTop>=geometry.previewBottom,'表单与预览顺序排列，不互相覆盖');await page.screenshot({path:`${out}/author-panel-${width}.png`,fullPage:true});await page.getByLabel('主题草稿名称',{exact:true}).scrollIntoViewIfNeeded();await page.getByLabel('主题草稿名称',{exact:true}).click();assert.equal(await page.getByLabel('主题草稿名称',{exact:true}).evaluate(node=>document.activeElement===node),true)})
  await finish('discard')
  await check('设置入口键盘创建聚焦草稿，取消与收起恢复触发点',async()=>{await page.setViewportSize({width:1440,height:1000});await page.locator('body').click({position:{x:8,y:8}});await page.keyboard.press('Meta+,');await page.locator('.settings-nav').filter({has:page.locator('.settings-nav-name',{hasText:/^外观$/})}).click();const trigger=page.getByRole('button',{name:'创建变体',exact:true});await trigger.focus();await page.keyboard.press('Enter');await page.getByRole('dialog',{name:'主题作者',exact:true}).waitFor();assert.equal(await page.getByLabel('主题草稿名称',{exact:true}).evaluate(node=>document.activeElement===node),true);for(let i=0;i<5;i++)await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>!!document.activeElement?.closest('.theme-authoring')),true);await page.getByRole('button',{name:'收起预览',exact:true}).click();assert.equal(await trigger.evaluate(node=>document.activeElement===node),true);await page.getByRole('button',{name:/继续主题创作/}).click();await page.getByRole('button',{name:'取消草稿',exact:true}).click();assert.equal(await trigger.evaluate(node=>document.activeElement===node),true)})
  await check('预览模块图不启动业务App/store/sync/analytics/AI或隐式npm字体',async()=>{assert.ok(previewRequests.length>0);assert.deepEqual([...new Set(previewRequests)].filter(url=>/\/(App\.tsx|workspaceStore\.ts|analytics\.ts|sync\.ts|ai\.ts|main\.tsx|ApplicationHost\.tsx)(\?|$)/.test(url)||url.includes('registry.npmmirror.com')),[])})
  await check('没有未处理运行错误',()=>assert.deepEqual(errors,[]))
}finally{
  writeFileSync(`${out}/results.json`,JSON.stringify({base,results,errors,previewRequests},null,2));await browser.close()
}
console.log(`主题隔离预览 ${results.filter(result=>result.ok).length}/${results.length}`)
if(results.some(result=>!result.ok))process.exitCode=1
