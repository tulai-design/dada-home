import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {chromium}=require(process.env.DADA_PLAYWRIGHT_PATH||'playwright')
const base=(process.env.DADA_QA_URL||'http://127.0.0.1:5175').replace(/\/$/,'')
const browser=await chromium.launch({headless:true})
try{
 const context=await browser.newContext({viewport:{width:1440,height:1100},reducedMotion:'reduce'})
 await context.route('**/*',route=>route.request().url().startsWith(base+'/')&&!new URL(route.request().url()).pathname.startsWith('/__proxy')?route.continue():route.abort())
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.goto(base+'/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__tada?.workspace())
 const call=async(name,args)=>page.evaluate(({name,args})=>window.__tada.call(name,args),{name,args})
 const title=await page.evaluate(async()=>{const {RECORD_APPLET_EXAMPLE}=await import('/src/lib/applet/dataTableExample.ts');const result=await window.__tada.call('create_applet',RECORD_APPLET_EXAMPLE);if(!result.startsWith('已安装'))throw new Error(result);return RECORD_APPLET_EXAMPLE.title})
 const installed=JSON.parse(await call('list_applications',{ref:title}))[0],id=installed.id
 assert.equal(installed.group,'生活');assert.equal(installed.openMode,'drawer');assert.equal(installed.dock,false);assert.equal(installed.status,false);assert.equal(installed.mountedPages.length,0)
 const open=async()=>{await page.keyboard.press('Meta+k');await page.locator('.cmdk-row').filter({has:page.locator('.cmdk-label',{hasText:title})}).click();await page.locator('.application-runtime[data-application="'+id+'"]').waitFor()}
 const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
 await open();const runtime=page.locator('.application-runtime[data-application="'+id+'"]'),table=runtime.locator('.ap-data-table'),search=table.getByRole('textbox',{name:'搜索记录'})
 await table.getByText('暂无记录',{exact:true}).waitFor()
 for(const [index,amount] of [10,2,0,8,4,30,20].entries()){
  await runtime.getByPlaceholder('项目',{exact:true}).fill('项目'+String(index+1).padStart(2,'0'))
  await runtime.locator('.lobe-input-number input').fill(String(amount))
  await runtime.getByPlaceholder('备注（选填）').fill(index===2?'隐藏关键词，零金额也是真实记录':'第'+(index+1)+'笔备注')
  await runtime.getByRole('button',{name:'添加记录',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('.application-runtime input[placeholder="项目"]').value==='')
 }
 await table.getByText('共 7 条',{exact:true}).waitFor()
 await page.setViewportSize({width:375,height:1100});await settle();await search.fill('隐藏关键词')
 await table.getByRole('button',{name:'查看 项目03 的详情',exact:true}).click()
 const detail=table.getByRole('region',{name:'项目03详情',exact:true});await detail.waitFor();assert.match(await detail.innerText(),/金额（元）\s+0/);assert.match(await detail.innerText(),/隐藏关键词，零金额也是真实记录/)
 await table.getByRole('checkbox',{name:'选择 项目03',exact:true}).click();await table.getByRole('button',{name:'清空搜索',exact:true}).click()
 await table.getByRole('combobox',{name:'排序字段',exact:true}).click();await page.getByRole('option',{name:'金额（元）',exact:true}).click()
 await table.getByRole('button',{name:'下一页',exact:true}).click();await table.getByRole('checkbox',{name:'选择 项目06',exact:true}).click()
 await table.getByText('已选 2 条',{exact:true}).waitFor();await runtime.getByRole('button',{name:'删除所选',exact:true}).click();await table.getByText('共 5 条',{exact:true}).waitFor();assert.equal(await table.getByRole('button',{name:'下一页',exact:true}).isDisabled(),true)
 await search.fill('项目');await runtime.getByPlaceholder('项目',{exact:true}).fill('尚未提交的项目')
 const input=await runtime.getByPlaceholder('项目',{exact:true}).elementHandle(),searchInput=await search.elementHandle()
 for(const width of [320,375,768,1440]){
  await page.setViewportSize({width,height:1100});await settle()
  for(const mode of ['light','dark']){
   await call('set_theme',{mode});await settle()
   assert.ok(await runtime.evaluate(el=>el.scrollWidth<=el.clientWidth+1),`${width} ${mode}抽屉无横向溢出`)
   assert.equal(await input.evaluate(el=>el.isConnected),true);assert.equal(await searchInput.evaluate(el=>el.isConnected),true)
   assert.equal(await runtime.getByPlaceholder('项目',{exact:true}).inputValue(),'尚未提交的项目');assert.equal(await search.inputValue(),'项目')
  }
 }
 await call('configure_application',{ref:id,settings:{pageSize:'10'}})
 await page.waitForFunction(()=>[...document.querySelectorAll('.application-runtime [role="combobox"]')].some(el=>el.textContent==='10 条'))
 await table.getByText('第 1 / 1 页',{exact:true}).waitFor()
 await table.getByRole('checkbox',{name:'选择 项目02',exact:true}).click()
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__tada?.workspace());await open();await table.getByText('共 5 条',{exact:true}).waitFor()
 assert.equal(await search.inputValue(),'','刷新不恢复临时搜索');assert.equal(await runtime.getByPlaceholder('项目',{exact:true}).inputValue(),'','未提交表单不作为业务记录保存')
 await table.getByText('已选 0 条',{exact:true}).waitFor();assert.equal(await table.getByRole('combobox',{name:'排序字段',exact:true}).innerText(),'原顺序');assert.equal(await table.getByRole('combobox',{name:'每页条数',exact:true}).innerText(),'10 条','用户设置刷新后仍生效')
 assert.equal(await table.getByRole('checkbox',{name:'选择 项目03',exact:true}).count(),0);assert.equal(await table.getByRole('checkbox',{name:'选择 项目06',exact:true}).count(),0,'删除通过持久记录恢复')
 await page.keyboard.press('Escape');await runtime.waitFor({state:'detached'})
 await call('mount_application',{ref:id,pageId:'home',span:'full'})
 const widget=page.locator('.widget[data-id="'+id+'"]');await widget.getByText('共 5 条',{exact:true}).waitFor();await widget.getByRole('button',{name:'查看 项目07 的详情',exact:true}).click();assert.match(await widget.getByRole('region',{name:'项目07详情',exact:true}).innerText(),/第7笔备注/)
 await call('mount_application',{ref:id,pageId:null});await call('configure_application',{ref:id,status:true,statusMode:'compact'})
 const status=page.locator('.application-status[data-compact="true"]');await status.getByText('5 笔记录',{exact:true}).waitFor();assert.equal(await status.locator('.ap-data-table').count(),0);assert.ok(await status.evaluate(el=>el.getBoundingClientRect().height<=33))
 assert.deepEqual(errors,[]);await context.close()
 console.log('通过：共享记录示例create_applet→抽屉空态/添加→隐藏字段筛选/排序/窄屏详情/跨页选择删除→四宽双主题→设置→刷新恢复业务并重置临时视图→widget/status')
}finally{await browser.close()}
