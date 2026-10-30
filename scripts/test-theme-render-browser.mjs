import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFileSync, mkdirSync} from 'node:fs'
import {routeBuiltinFixtures} from './browser-builtin-fixtures.mjs'

const require = createRequire(import.meta.url)
const {chromium} = require(process.env.DADA_PLAYWRIGHT_PATH || 'playwright')
const base = (process.env.DADA_QA_URL || 'http://127.0.0.1:5203').replace(/\/$/, '')
const output = process.env.DADA_QA_OUTPUT || '/tmp/dada-theme-render-browser'
const fontBytes = readFileSync(process.env.DADA_FONT_FIXTURE || '/System/Library/Fonts/Supplemental/Arial.ttf')
mkdirSync(output, {recursive: true})
const browser = await chromium.launch({headless: true})
const results = []
let page
async function check(name, run) {
  try {await run(); results.push({name, ok:true}); console.log(`通过：${name}`)}
  catch(error) {results.push({name,ok:false,error:error.message});console.error(`失败：${name}: ${error.message}`);await page?.screenshot({path:`${output}/failure-${results.length}.png`}).catch(()=>{})}
}
try {
  const context = await browser.newContext({viewport:{width:1440,height:960},reducedMotion:'reduce'})
  await routeBuiltinFixtures(context, base)
  const requests = []
  await context.route('https://fonts.googleapis.com/**', async route => {
    const family = new URL(route.request().url()).searchParams.get('family').split(':')[0]
    requests.push(family)
    if(family === 'Lease Missing') return route.fulfill({status:404,body:'missing'})
    if(family === 'Lease Timeout') return // 请求保持未完成，验证客户端自己的限时清理。
    const file=family==='Lease Broken'?'broken.ttf':'sample.ttf'
    return route.fulfill({contentType:'text/css',body:[400,500,600,700].map(weight=>`@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};src:url('https://fonts.gstatic.com/tada-fixture/${file}') format('truetype')}`).join('\n')})
  })
  await context.route('https://fonts.gstatic.com/**',route=>route.request().url().endsWith('broken.ttf')?route.abort():route.fulfill({contentType:'font/ttf',body:fontBytes,headers:{'access-control-allow-origin':'*'}}))
  page=await context.newPage()
  page.setDefaultTimeout(7000)
  await page.goto(base)
  await page.locator('.app').waitFor({state:'attached'})
  await page.waitForFunction(()=>!!window.__tada)
  await page.evaluate(()=>window.__tada.call('install_addon',{id:'desk'}))
  const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  const apply=async(from,patch)=>{
    const call=(name,args)=>page.evaluate(({name,args})=>window.__tada.call(name,args),{name,args})
    const draft=JSON.parse(await call('create_theme_draft',{intent:'derive',from,name:`渲染${Date.now().toString(36)}`}))
    const operations=[{path:'fonts',scope:'resource',value:patch.fonts??[]}]
    for(const [part,recipe] of Object.entries(patch.recipes??{}))operations.push({path:`${part}.radius`,scope:'recipe',value:recipe.radius})
    for(const [path,value] of Object.entries(patch.shellConfig??{}))operations.push({path,scope:'shell',value})
    const next=JSON.parse(await call('update_theme_draft',{draftId:draft.id,expectedRevision:draft.revision,operations}))
    await page.frameLocator('iframe[title="隔离主题预览"]').locator('[data-preview-fixture]').waitFor()
    await call('finish_theme_draft',{draftId:next.id,expectedRevision:next.revision,action:'apply'})
    await settle()
    await page.evaluate(async()=>{const ws=window.__tada.workspace();for(const theme of ws.themes)if(!theme.builtin&&theme.id!==ws.theme.active)await window.__tada.call('delete_theme',{ref:theme.id})})
  }
  await check('预备字体成功后正式layout接管同document lease，作者释放不卸当前字体',async()=>{
    await apply('ios',{fonts:[{family:'Lease Success',role:'sans'}]})
    await page.waitForTimeout(550)
    assert.equal(await page.locator('link[data-theme-font="Lease Success"]').count(),1)
    assert.match(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--font-sans')),/Lease Success/)
  })
  await check('真实字体需要stylesheet和FontFaceSet成功，prepare不接管root变量',async()=>{
    const result=await page.evaluate(async()=>{
      const {acquireThemeFonts}=await import('/src/lib/fonts.ts')
      const before=document.documentElement.getAttribute('style')
      const lease=acquireThemeFonts(document,[{family:'Lease Isolated',role:'sans'}],{timeoutMs:3000})
      const result=await lease.ready
      const after=document.documentElement.getAttribute('style')
      const actual=document.fonts.check('400 16px "Lease Isolated"','搭搭 Aa0123')
      lease.release()
      return {result,before,after,actual,remaining:document.querySelectorAll('link[data-theme-font="Lease Isolated"]').length}
    })
    assert.equal(result.result.ready,true);assert.equal(result.actual,true);assert.equal(result.after,result.before);assert.equal(result.remaining,0)
  })
  await check('真实浏览器资源404、字体二进制失败和超时都降级，零残留link',async()=>{
    for(const family of ['Lease Missing','Lease Broken','Lease Timeout']){
      const result=await page.evaluate(async family=>{
        const {acquireThemeFonts}=await import('/src/lib/fonts.ts')
        const lease=acquireThemeFonts(document,[{family}],{timeoutMs:120})
        const result=await lease.ready;lease.release()
        return {result,remaining:[...document.querySelectorAll('link[data-theme-font]')].filter(link=>link.dataset.themeFont===family).length}
      },family)
      assert.equal(result.result.ready,false,family);assert.equal(result.remaining,0,family)
    }
  })
  await check('明确系统字体正式应用后不再请求任何网络字体',async()=>{
    await apply('ios',{})
    const count=requests.length
    await page.keyboard.press('Meta+,');await settle()
    await page.waitForTimeout(100)
    assert.equal(requests.length,count)
    assert.equal(await page.locator('link[data-theme-font]').count(),0)
  })
  for(const mode of ['light','dark'])for(const skin of ['default','ios','pixel','switch','win98']){
    await check(`${skin}/${mode}按钮与输入recipe实际覆盖skin固定圆角且不修改专属chrome`,async()=>{
      await page.evaluate(mode=>window.__tada.call('set_theme',{mode}),mode)
      await apply(skin,{recipes:{button:{radius:19},input:{radius:13}}})
      await page.keyboard.press('Meta+,');await settle()
      await page.locator('.settings-page .settings-nav-name').getByText('外观',{exact:true}).click();await settle()
      const values=await page.evaluate(()=>{
        const button=[...document.querySelectorAll('.settings-page .lobe-button')].find(element=>element.getClientRects().length)
        const chrome=document.querySelector('.win98-window-actions button, .switch-dock button')
        return {button:button?getComputedStyle(button).borderRadius:null,chrome:chrome?getComputedStyle(chrome).borderRadius:null}
      })
      await page.locator('.settings-page .settings-nav-name').getByText('个人',{exact:true}).click();await settle()
      const input=await page.evaluate(()=>{
        const input=[...document.querySelectorAll('.settings-page .lobe-input, .settings-page .ios-input')].find(element=>element.getClientRects().length)
        return input?getComputedStyle(input).borderRadius:null
      })
      assert.equal(values.button,'19px');assert.equal(input,'13px')
      if(skin==='win98')assert.equal(values.chrome,'0px')
    })
  }
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:960})
    await check(`Switch封面比例80→120在${width}px实际改变几何且封面可达`,async()=>{
      const sizes=[]
      for(const scale of [80,120]){
        await apply('switch',{shellConfig:{coverScale:scale}})
        const cover=page.locator('.switch-cover-art').first();await cover.waitFor()
        sizes.push((await cover.boundingBox()).width)
        const rect=await cover.boundingBox(),canvas=await page.locator('.canvas').boundingBox()
        assert.ok(rect.width>0&&rect.width<=canvas.width&&rect.y>=canvas.y&&rect.y+rect.height<=canvas.y+canvas.height)
      }
      assert.ok(sizes[1]>sizes[0],`${sizes}`)
    })
    await check(`Win98窗口gap4→40在${width}px真实消费并保留安全空间`,async()=>{
      const gaps=[]
      for(const gap of [4,40]){
        await apply('win98',{shellConfig:{windowGap:gap}})
        await page.keyboard.press('Meta+,');await settle()
        const canvas=await page.locator('.canvas').boundingBox(),stage=await page.locator('.shell-content-stage').boundingBox()
        gaps.push(stage.x-canvas.x)
        assert.ok(stage.width>200&&stage.height>120)
        assert.ok(stage.x>=canvas.x&&stage.x+stage.width<=canvas.x+canvas.width+1)
        assert.ok(stage.y>=canvas.y&&stage.y+stage.height<=canvas.y+canvas.height+1)
      }
      if(width>760)assert.ok(gaps[1]>gaps[0]+30,`${gaps}`)
      else assert.ok(gaps.every(gap=>gap<=5),`${gaps}`)
    })
  }
  await page.screenshot({path:`${output}/win98-320.png`})
  console.log(`主题正式渲染/资源浏览器回归：${results.filter(item=>item.ok).length}/${results.length}`)
  if(results.some(item=>!item.ok))process.exitCode=1
} finally {await browser.close()}
