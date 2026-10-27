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
 await page.goto(base+'/tests/applet-charts-regressions.html')
 const host=page.locator('#chart-host')
 await host.getByRole('img').waitFor()
 await page.getByPlaceholder('保留输入').fill('大小和主题改变后保留')
 await page.waitForFunction(()=>window.__chartFixture.stats().fetch===1)
 const input=await page.getByPlaceholder('保留输入').elementHandle()
 const initial=await page.evaluate(()=>window.__chartFixture.stats())
 const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
 const change=async key=>{await page.locator('#case-'+key).click();await settle()}
 const geometry=async label=>{
  const measured=await host.evaluate(root=>{
   const svg=root.querySelector('svg[role="img"]')||root.querySelector('[role="img"] svg')||root.querySelector('svg')
   const box=root.getBoundingClientRect(),image=svg.getBoundingClientRect()
   const attrs=[...svg.querySelectorAll('*')].flatMap(element=>[...element.attributes].filter(a=>['x','y','x1','x2','y1','y2','cx','cy','r','d','points','viewBox'].includes(a.name)).map(a=>a.value))
   return {overflow:root.scrollWidth-root.clientWidth,image:{left:image.left,right:image.right,width:image.width,height:image.height},root:{left:box.left,right:box.right},finite:attrs.every(v=>!/NaN|Infinity|undefined/.test(v)),labels:[...svg.querySelectorAll('text')].map(e=>e.textContent),ticksInside:[...svg.querySelectorAll('text')].every(e=>{const tick=e.getBoundingClientRect();return tick.left>=image.left-1&&tick.right<=image.right+1&&tick.top>=image.top-1&&tick.bottom<=image.bottom+1})}
  })
  assert.ok(measured.overflow<=1,label+':图表不撑大容器')
  assert.ok(measured.image.width>0&&measured.image.height>0,label+':图形具有实际尺寸')
  assert.ok(measured.image.left>=measured.root.left-1&&measured.image.right<=measured.root.right+1,label+':图形在容器内')
  assert.equal(measured.finite,true,label+':坐标有限')
  assert.equal(measured.ticksInside,true,label+':所有实际刻度文字均在绘图区内')
  return measured
 }
 const exactData=async()=>{
  const summary=host.locator('summary')
  await summary.focus();await summary.press('Enter')
  await host.getByRole('table').waitFor({state:'visible'})
  const rows=host.getByRole('row')
  assert.equal(await rows.count(),13,'明细包含标题和全部12个点')
  assert.match(await rows.nth(1).innerText(),/0/)
  assert.match(await rows.nth(3).innerText(),/缺失/)
  assert.match(await rows.nth(12).innerText(),/42/)
  assert.match(await rows.nth(12).innerText(),/-18/)
  await summary.press('Space')
  assert.equal(await host.locator('details').getAttribute('open'),null,'Space可收起数据明细')
 }
 await exactData()
 const segments=await host.locator('.ap-line-chart-series').evaluateAll(groups=>groups.map(group=>({lines:group.querySelectorAll('polyline').length,points:group.querySelectorAll('circle').length})))
 assert.deepEqual(segments,[{lines:3,points:10},{lines:2,points:11}],'缺失值分段且零/负数仍保留数据点')
 let desktopTicks=0,narrowTicks=0
 for(const width of [320,375,768,1440]){
  await page.setViewportSize({width,height:1100});await settle()
  for(const theme of ['light','dark']){
   if(await page.locator('html').getAttribute('data-theme')!==theme){await page.locator('#theme').click();await settle()}
   const measured=await geometry(width+' '+theme)
   if(width===1440)desktopTicks=measured.labels.length
   if(width===320)narrowTicks=measured.labels.length
   assert.equal(await input.evaluate(element=>element.isConnected),true,'resize/theme保留原输入DOM')
   assert.equal(await page.getByPlaceholder('保留输入').inputValue(),'大小和主题改变后保留')
  }
 }
 assert.ok(narrowTicks<desktopTicks,'窄容器减少刻度，而不是缩小全部文字')
 const after=await page.evaluate(()=>window.__chartFixture.stats())
 assert.equal(after.init,initial.init,'resize/theme不重启iframe')
 assert.equal(after.fetch,1,'resize/theme不重复init取数')
 assert.deepEqual(after.errors,[])
 await page.locator('#narrow').click();await settle();await geometry('1440窗口内280px容器')
 await page.locator('#narrow').click();await settle()
 for(const key of ['precision','subnormal']){
  await change(key);await page.locator('#narrow').click();await settle();await geometry(key+' 科学计数法轴刻度280px')
  await page.locator('#narrow').click();await page.setViewportSize({width:224,height:1100});await settle();await geometry(key+' 192px实际窄容器')
  await host.locator('summary').click();assert.match(await host.getByRole('table').innerText(),key==='subnormal'?/-5e-324/:/-1e-100/,'极小数据明细保留完整数值');await host.locator('summary').click()
  await page.setViewportSize({width:1440,height:1100});await settle()
 }
 for(const key of ['single','flat']){await change(key);await geometry(key);await host.locator('summary').click();assert.ok(await host.getByRole('row').count()>1);await host.locator('summary').click()}
 await change('missing');assert.equal(await host.getByRole('img').count(),0);await host.locator('summary').click();assert.equal(await host.getByText('缺失',{exact:true}).count(),3)
 await change('empty');assert.equal(await host.getByRole('img').count(),0)
 for(const key of ['invalid','excessive']){await change(key);await host.getByRole('alert').waitFor();assert.equal(await host.getByRole('img').count(),0)}
 await change('long');await page.setViewportSize({width:320,height:1100});await settle();await geometry('长标题四系列320px')
 await host.locator('summary').click()
 assert.ok((await host.getByRole('table').innerText()).includes('12500.125'),'数据表保留精确值')
 assert.ok(await host.evaluate(e=>e.scrollWidth<=e.clientWidth+1),'长明细只在内部横滚')
 const tableScroll=await host.locator('.ap-line-chart-table-wrap').evaluate(element=>{element.scrollLeft=element.scrollWidth;return {left:element.scrollLeft,overflow:getComputedStyle(element).overflowX}})
 assert.ok(tableScroll.left>0&&tableScroll.overflow==='auto','长数据表具有实际独立横滚区')
 await host.locator('summary').click()
 assert.equal(await page.locator('#bars .ap-bar').count(),3,'旧Bars仍显示3个值')
 assert.equal(await page.locator('#bars [data-hot="true"]').count(),1,'旧Bars高亮保持')
 await change('mixed')
 if(await page.locator('html').getAttribute('data-theme')!=='light')await page.locator('#theme').click()
 await page.setViewportSize({width:1440,height:1100});await settle();await host.screenshot({path:'/tmp/dada-applet-charts-desktop.png'})
 await page.setViewportSize({width:320,height:1100});await settle();await host.screenshot({path:'/tmp/dada-applet-charts-mobile.png'})
 await page.locator('#theme').click();await settle();await host.screenshot({path:'/tmp/dada-applet-charts-dark.png'})
 assert.deepEqual(errors,[])
 const recovery=await context.newPage()
 await recovery.goto(base+'/tests/applet-charts-regressions.html?initial=invalid')
 await recovery.locator('#chart-host').getByRole('alert').waitFor()
 await recovery.locator('#case-mixed').click()
 await recovery.locator('#chart-host').getByRole('img').waitFor()
 const wideTicks=await recovery.locator('#chart-host .ap-line-chart-tick').count()
 await recovery.locator('#narrow').click()
 await recovery.waitForFunction(()=>document.querySelectorAll('#chart-host .ap-line-chart-tick').length<6)
 assert.ok(await recovery.locator('#chart-host .ap-line-chart-tick').count()<wideTicks,'初始错误恢复后仍按实际窄容器测量')
 assert.ok(await recovery.locator('#chart-host').evaluate(element=>element.scrollWidth<=element.clientWidth+1))
 await recovery.close()
 await context.close()
 const touchContext=await browser.newContext({viewport:{width:375,height:900},hasTouch:true,isMobile:true,reducedMotion:'reduce'})
 await touchContext.route('**/*',route=>route.request().url().startsWith(base+'/')&&!new URL(route.request().url()).pathname.startsWith('/__proxy')?route.continue():route.abort())
 const touch=await touchContext.newPage()
 await touch.goto(base+'/tests/applet-charts-regressions.html')
 await touch.locator('#chart-host summary').tap()
 await touch.locator('#chart-host').getByRole('table').waitFor({state:'visible'})
 assert.match(await touch.locator('#chart-host').getByRole('table').innerText(),/42/)
 await touchContext.close()
 console.log('通过：四宽双主题、280px实际容器、有限坐标与精确明细、键盘/触摸、空错缺失/单点/常量/超量、Bars兼容及runner状态存活')
}finally{await browser.close()}
