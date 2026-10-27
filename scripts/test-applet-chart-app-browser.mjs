import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {chromium}=require(process.env.DADA_PLAYWRIGHT_PATH||'playwright')
const base=(process.env.DADA_QA_URL||'http://127.0.0.1:5175').replace(/\/$/,'')
const browser=await chromium.launch({headless:true})
try{
 const context=await browser.newContext({viewport:{width:1440,height:1100},reducedMotion:'reduce'})
 const page=await context.newPage(),errors=[]
 page.on('pageerror',error=>errors.push(error.message))
 await context.route('**/*',route=>route.request().url().startsWith(base+'/')&&!new URL(route.request().url()).pathname.startsWith('/__proxy')?route.continue():route.abort())
 await page.goto(base+'/',{waitUntil:'domcontentloaded'})
 await page.waitForFunction(()=>window.__tada?.workspace())
 const call=async(name,args)=>page.evaluate(({name,args})=>window.__tada.call(name,args),{name,args})
 const title=await page.evaluate(async()=>{
  const {TREND_APPLET_EXAMPLE}=await import('/src/lib/applet/chartExample.ts')
  const result=await window.__tada.call('create_applet',TREND_APPLET_EXAMPLE)
  if(!result.startsWith('已安装'))throw new Error(result)
  return TREND_APPLET_EXAMPLE.title
 })
 const installed=JSON.parse(await call('list_applications',{ref:title}))[0]
 assert.equal(installed.group,'效率');assert.equal(installed.openMode,'drawer');assert.equal(installed.dock,false);assert.equal(installed.status,false)
 assert.equal(installed.mountedPages.length,0,'共享例子默认仅安装进市场')
 const id=installed.id
 const open=async()=>{await page.keyboard.press('Meta+k');await page.locator('.cmdk-row').filter({has:page.locator('.cmdk-label',{hasText:title})}).click();await page.locator('.application-runtime[data-application="'+id+'"]').waitFor()}
 const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
 await open()
 const runtime=page.locator('.application-runtime[data-application="'+id+'"]')
 await runtime.getByText('暂无趋势数据',{exact:true}).waitFor()
 assert.equal(await runtime.locator('.ap-line-chart svg[role=img]').count(),0,'初始没有伪造记录')
 for(const [label,minutes] of [['10月26日',60],['10月27日',30],['10月28日',90]]){
  await runtime.getByPlaceholder('日期或标签').fill(label)
  await runtime.locator('.lobe-input-number input').fill(String(minutes))
  await runtime.getByRole('button',{name:'添加记录',exact:true}).click()
  await runtime.getByPlaceholder('日期或标签').waitFor()
  await page.waitForFunction(()=>document.querySelector('.application-runtime input[placeholder="日期或标签"]').value==='')
 }
 await runtime.getByText('最近 7 条 · 已保存 3 条',{exact:true}).waitFor()
 await runtime.locator('summary').click()
 assert.match(await runtime.getByRole('table').innerText(),/90/)
 await runtime.locator('summary').click()
 const input=await runtime.getByPlaceholder('日期或标签').elementHandle()
 await runtime.getByPlaceholder('日期或标签').fill('未提交输入仍在')
 for(const width of [320,375,768,1440]){
  await page.setViewportSize({width,height:1100});await settle()
  for(const mode of ['light','dark']){
   await call('set_theme',{mode});await settle()
   assert.ok(await runtime.evaluate(element=>element.scrollWidth<=element.clientWidth+1),`${width} ${mode}抽屉无横溢`)
   assert.equal(await input.evaluate(element=>element.isConnected),true,'resize/theme保留输入实例')
   assert.equal(await runtime.getByPlaceholder('日期或标签').inputValue(),'未提交输入仍在')
  }
 }
 await call('configure_application',{ref:id,settings:{unit:'hours',range:'30'}})
 await runtime.getByText('最近 30 条 · 已保存 3 条',{exact:true}).waitFor()
 await runtime.locator('summary').click()
 assert.match(await runtime.getByRole('table').innerText(),/1\.5/,'设置实际把90分钟换算为1.5小时')
 assert.match(await runtime.getByRole('table').innerText(),/小时/)
 await runtime.locator('summary').click()
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__tada?.workspace())
 await open()
 await runtime.getByText('最近 30 条 · 已保存 3 条',{exact:true}).waitFor()
 await runtime.locator('summary').click();assert.match(await runtime.getByRole('table').innerText(),/1\.5/);await runtime.locator('summary').click()
 await page.keyboard.press('Escape');await runtime.waitFor({state:'detached'})
 await call('mount_application',{ref:id,pageId:'home',span:'full'})
 const widget=page.locator('.widget[data-id="'+id+'"]')
 await widget.getByText('最近 30 条 · 已保存 3 条',{exact:true}).waitFor()
 assert.equal(await widget.locator('.ap-line-chart svg[role=img]').count(),1,'同一应用以widget形态读取已存记录')
 await call('mount_application',{ref:id,pageId:null})
 await call('configure_application',{ref:id,status:true,statusMode:'compact'})
 const status=page.locator('.application-status[data-compact="true"]')
 await status.getByText('1.5 小时',{exact:true}).waitFor()
 assert.equal(await status.locator('.ap-line-chart svg[role=img]').count(),0,'状态紧凑只显示摘要')
 assert.ok(await status.evaluate(element=>element.getBoundingClientRect().height<=33),'状态栏限高')
 assert.deepEqual(errors,[])
 console.log('通过：共享AI示例经create_applet安装、抽屉空态/记录/四宽双主题、设置换算、刷新persist、widget和status形态')
 await context.close()
}finally{await browser.close()}
