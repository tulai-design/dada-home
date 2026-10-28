import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdirSync,writeFileSync} from 'node:fs'
const require=createRequire(import.meta.url),{chromium}=require(process.env.DADA_PLAYWRIGHT_PATH||'playwright')
const base=(process.env.DADA_QA_URL||'http://127.0.0.1:5176').replace(/\/$/,'')
const out=process.env.DADA_QA_OUTPUT||'/tmp/dada-chat-history-browser';mkdirSync(out,{recursive:true})
const browser=await chromium.launch({headless:true}),results=[]
async function test(name,run){await run();results.push({name,ok:true});console.log('通过：'+name)}
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'})
 await context.route('**/*',r=>r.request().url().startsWith(base+'/')&&!new URL(r.request().url()).pathname.startsWith('/__proxy')?r.continue():r.abort())
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto(base+'/tests/chat-history-regressions.html');await page.waitForFunction(()=>window.chatQA)
 await page.evaluate(async()=>{
  const {database,schema}=window.chatQA
  const convs=Array.from({length:1000},(_,i)=>({id:'conv-'+String(i).padStart(4,'0'),title:'合成对话 '+i,createdAt:1000+i,updatedAt:20000+i}))
  const turns=Array.from({length:10000},(_,i)=>({id:'turn-'+String(i).padStart(5,'0'),convId:'conv-0999',prompt:'问题 '+i,answer:'回答 '+i,reasoning:'思考 '+i,tools:[{name:'fixture',title:'读取合成资料',ok:true,text:'工具正文🙂'.repeat(170)+i}],error:'',startedAt:30000+Math.floor(i/2),endedAt:40000+i,...(i%100===0?{article:{title:'参考',link:'https://example.test/article',context:'文章原文 '+i}}:{})}))
  const fieldBytes={prompt:0,answer:0,reasoning:0,tools:0,article:0},encode=v=>new TextEncoder().encode(v).byteLength
  for(const t of turns){for(const k of ['prompt','answer','reasoning'])fieldBytes[k]+=encode(t[k]);fieldBytes.tools+=encode(t.tools[0].text);fieldBytes.article+=encode(t.article?.context||'')}
  window.chatFieldBytes=fieldBytes
  for(let i=0;i<convs.length;i+=100)await database.db.putMany('convs',convs.slice(i,i+100))
  for(let i=0;i<turns.length;i+=200){const operations=[];for(const turn of turns.slice(i,i+200)){const split=schema.splitTurn(turn);operations.push({store:'turns',type:'put',value:split.turn},...split.details.map(value=>({store:'toolDetails',type:'put',value})))}await database.db.batch(operations)}
  localStorage.setItem('fp.conv',JSON.stringify('conv-0999'))
  window.chatReads=[];window.chatWrites=[]
  for(const name of ['all','byIndex','page','get']){const original=database.db[name];database.db[name]=async(...args)=>{const start=performance.now(),value=await original(...args);window.chatReads.push({method:name,store:args[0],rows:Array.isArray(value)?value.length:value===undefined?0:1,bytes:encode(JSON.stringify(value)??''),ms:performance.now()-start});return value}}
  const batch=database.db.batch;database.db.batch=async ops=>{window.chatWrites.push(ops.map(op=>({store:op.store,type:op.type,bytes:encode(JSON.stringify(op))})));return batch(ops)}
 })
 let benchmark
 await test('1000会话/10000轮启动只读取有界索引页，零工具正文预读',async()=>{
  benchmark=await page.evaluate(async()=>{const start=performance.now();await window.chatQA.chat.initChat();const state=window.chatQA.chat.getChatState();return {ms:performance.now()-start,reads:window.chatReads,loaded:{convs:state.convs.length,turns:state.turns.length},fieldBytes:window.chatFieldBytes}})
  assert.equal(benchmark.loaded.convs,50);assert.equal(benchmark.loaded.turns,40);assert.equal(benchmark.reads.filter(x=>x.store==='toolDetails').length,0)
  assert.ok(benchmark.reads.filter(x=>x.store==='turns').reduce((s,x)=>s+x.rows,0)<=41)
  assert.ok(benchmark.reads.filter(x=>x.store==='convs').reduce((s,x)=>s+x.rows,0)<=52)
  assert.ok(benchmark.reads.every(x=>x.method!=='all'&&x.method!=='byIndex'))
  writeFileSync(out+'/benchmark.json',JSON.stringify({dataset:{convs:1000,turns:10000,toolChars:1020},after:benchmark},null,2))
 })
 await test('同毫秒轮次游标翻完10000轮，无重复或遗漏且不加载明细',async()=>{
  const value=await page.evaluate(async()=>{const c=window.chatQA.chat;while(c.getChatState().hasOlderTurns)await c.loadOlderTurns();return {ids:c.getChatState().turns.map(t=>t.id),reads:window.chatReads.filter(x=>x.store==='toolDetails')}})
  assert.deepEqual(value.ids,Array.from({length:10000},(_,i)=>'turn-'+String(i).padStart(5,'0')));assert.equal(value.reads.length,0)
 })
 await test('模型上下文独立于UI页，遵守100轮及36000字符和文章语义',async()=>{
  const result=await page.evaluate(async()=>{const c=window.chatQA.chat,s=window.chatQA.schema,db=window.chatQA.database.db;const actual=await c.loadContextTurns('conv-0999',100);const all=await db.all('turns');const expected=c.contextTurns(all.filter(t=>t.convId==='conv-0999').sort((a,b)=>a.startedAt-b.startedAt||a.id.localeCompare(b.id)),100);const messages=ts=>ts.flatMap(t=>[{role:'user',content:c.turnContent(t)},...(t.answer?[{role:'assistant',content:t.answer}]:[])]);await c.openConv('conv-0998');await c.openConv('conv-0999');const latest=await c.loadContextTurns('conv-0999',100);return {actual:messages(actual),expected:messages(expected),latest:messages(latest),shown:c.getChatState().turns.length}})
  assert.equal(result.shown,40);assert.deepEqual(result.actual,result.expected);assert.deepEqual(result.latest,result.expected);assert.equal(result.actual.length,200)
 })
 await test('1000个会话按需分页不重复，当前会话可独立加载',async()=>{
  const ids=await page.evaluate(async()=>{const c=window.chatQA.chat;while(c.getChatState().hasMoreConvs)await c.loadMoreConvs();return c.getChatState().convs.map(x=>x.id)});assert.equal(ids.length,1000);assert.equal(new Set(ids).size,1000)
  await page.evaluate(async()=>{localStorage.setItem('fp.conv',JSON.stringify('conv-0001'))});await page.reload();await page.waitForFunction(()=>window.chatQA);const state=await page.evaluate(async()=>{await window.chatQA.chat.initChat();const s=window.chatQA.chat.getChatState();return {id:s.convId,title:s.currentConv.title,convs:s.convs.length}});assert.equal(state.id,'conv-0001');assert.equal(state.title,'合成对话 1');assert.equal(state.convs,50)
 })
 await test('工具正文单条读取、UTF8字节精确且错误不会补为空',async()=>{
  const result=await page.evaluate(async()=>{const {chat,schema,database}=window.chatQA;const id=schema.toolDetailId('turn-09999',0);const text=await chat.readToolDetail(id);const original=database.db.get;database.db.get=async(store,key)=>{if(store==='toolDetails')throw new Error('测试读取失败');return original(store,key)};let error;try{await chat.readToolDetail(schema.toolDetailId('turn-00001',0))}catch(e){error=e.message}database.db.get=original;const retry=await chat.readToolDetail(schema.toolDetailId('turn-00001',0));return {text,error,retry}})
  assert.equal(result.text,'工具正文🙂'.repeat(170)+'9999');assert.match(result.error,/测试读取失败/);assert.equal(result.retry,'工具正文🙂'.repeat(170)+'1')
 })
 await test('流式期间翻页/切换/返回保留原轮，answer更新不重写既有工具正文',async()=>{
  const result=await page.evaluate(async()=>{const {chat:c,database}=window.chatQA;await c.openConv('conv-0999');const t=c.beginTurn('流式测试');c.appendTurn('conv-0999',t);c.appendTool('conv-0999',t.id,{name:'large',title:'大结果',ok:true,text:'中文🙂'.repeat(40000)});await c.flush();const writes=[];const original=database.db.batch;database.db.batch=async ops=>{writes.push(...ops.map(x=>x.store));return original(ops)};await c.openConv('conv-0998');c.patchTurn('conv-0999',t.id,{answer:'第一段'});await c.flush();const other=c.getChatState().turns.length;await c.openConv('conv-0999');await c.loadOlderTurns();c.patchTurn('conv-0999',t.id,{answer:'第一段第二段',reasoning:'完整思考',endedAt:Date.now()});await c.flush();database.db.batch=original;const current=c.getChatState().turns.find(x=>x.id===t.id);const text=await c.readToolDetail(current.tools[0].detailId);return {other,answer:current.answer,reasoning:current.reasoning,text,writes,active:c.getChatState().activeTurnIds}})
  assert.equal(result.other,0);assert.equal(result.answer,'第一段第二段');assert.equal(result.reasoning,'完整思考');assert.equal(result.text,'中文🙂'.repeat(40000));assert.equal(result.writes.includes('toolDetails'),false);assert.deepEqual(result.active,[])
 })
 // Real App/UI verification follows on the same isolated database.
 await page.evaluate(()=>localStorage.setItem('fp.conv',JSON.stringify('conv-0999')))
 await context.addInitScript(()=>{
  const original=window.fetch.bind(window);window.modelRequests=[]
  window.fetch=async(input,init)=>{
   if(String(input).includes('/__chat_model__/')){
    window.modelRequests.push(JSON.parse(init.body));const encoder=new TextEncoder();let controller
    const stream=new ReadableStream({start(c){controller=c}})
    window.modelChunk=(text,done=false)=>{controller.enqueue(encoder.encode('data: '+JSON.stringify({id:'synthetic',object:'chat.completion.chunk',model:'test-model',choices:[{index:0,delta:{content:text},finish_reason:done?'stop':null}]})+'\n\n'));if(done){controller.enqueue(encoder.encode('data: [DONE]\n\n'));controller.close()}}
    return new Response(stream,{headers:{'content-type':'text/event-stream'}})
   }
   return original(input,init)
  }
 })
 await page.evaluate(async()=>{const {defaultSettings}=await import('/src/lib/defaults.ts');const settings=defaultSettings();settings.ai={baseUrl:location.origin+'/__chat_model__/v1',apiKey:'isolated-fixture',model:'test-model',protocol:'openai',contextTurns:100};localStorage.setItem('fp.settings',JSON.stringify(settings))})
 await page.goto(base+'/');await page.waitForFunction(()=>window.__tada?.workspace());await page.keyboard.press('Meta+j');await page.locator('.chat-log').waitFor()
 await test('真实聊天展开工具才读正文，折叠与翻页保留滚动锚点',async()=>{
  await page.evaluate(async()=>{const {db}=await import('/src/lib/db.ts');window.uiDetailReads=0;const get=db.get;db.get=async(...args)=>{if(args[0]==='toolDetails')window.uiDetailReads++;return get(...args)}})
  assert.equal(await page.evaluate(()=>window.uiDetailReads),0)
  const row=page.locator('.turn').last().locator('.tool-row').first();await row.locator('button').click();await row.locator('.tool-detail').waitFor();assert.equal(await row.locator('.tool-detail').innerText(),'中文🙂'.repeat(40000));assert.equal(await page.evaluate(()=>window.uiDetailReads),1);await row.locator('button').click()
  await page.locator('.chat-log').evaluate(el=>{el.scrollTop=0});const first=page.locator('.turn').first();const id=await first.getAttribute('id');const before=await first.evaluate(el=>el.getBoundingClientRect().top)
  await page.getByRole('button',{name:/加载更早|显示更早/}).click();await page.waitForFunction(()=>document.querySelectorAll('.turn').length>40)
  const after=await page.locator('#'+id).evaluate(el=>el.getBoundingClientRect().top);assert.ok(Math.abs(after-before)<8,`分页锚点移动 ${after-before}px`)
 })
 await test('真实发送在翻页之外构造模型上下文，流式中切会话再返回不丢输出',async()=>{
  await page.getByRole('button',{name:'全屏模式',exact:true}).click();await page.locator('.ai-full').waitFor()
  const before=await page.evaluate(async()=>{const c=await import('/src/lib/chat.ts');return (await c.loadContextTurns(c.getChatState().convId,100)).flatMap(t=>[{role:'user',content:c.turnContent(t)},...(t.answer?[{role:'assistant',content:t.answer}]:[])])})
  await page.getByRole('textbox',{name:'消息内容',exact:true}).fill('真实流式提问');await page.getByRole('button',{name:'发送',exact:true}).click();await page.waitForFunction(()=>window.modelRequests.length===1)
  const messages=await page.evaluate(()=>window.modelRequests[0].messages.filter(m=>m.role!=='system'));assert.deepEqual(messages.slice(0,-1),before);assert.equal(messages.at(-1).content,'真实流式提问')
  await page.evaluate(()=>window.modelChunk('第一段输出'));await page.locator('.turn').last().getByText('第一段输出',{exact:true}).waitFor()
  await page.locator('.ai-history-item').filter({hasText:'合成对话 998'}).click();await page.waitForFunction(async()=>(await import('/src/lib/chat.ts')).getChatState().convId==='conv-0998')
  await page.evaluate(()=>window.modelChunk('第二段输出'));assert.equal(await page.getByRole('button',{name:'停止',exact:true}).count(),1);assert.equal(await page.getByRole('button',{name:'发送',exact:true}).count(),0)
  await page.locator('.ai-history-item').filter({hasText:'合成对话 999'}).click();await page.locator('.turn').last().getByText('第一段输出第二段输出',{exact:true}).waitFor()
  await page.locator('.chat-log').evaluate(el=>el.scrollTop=0);await page.getByRole('button',{name:'加载更早的对话',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.turn').length>40)
  const top=await page.locator('.chat-log').evaluate(el=>el.scrollTop);await page.evaluate(()=>window.modelChunk('第三段输出',true));await page.getByRole('button',{name:'发送',exact:true}).waitFor();assert.ok(Math.abs((await page.locator('.chat-log').evaluate(el=>el.scrollTop))-top)<8)
  const answer=await page.evaluate(async()=>{const c=await import('/src/lib/chat.ts');await c.flush();return c.getChatState().turns.at(-1).answer});assert.equal(answer,'第一段输出第二段输出第三段输出')
 })
 await test('明细读取失败可原位重试，各形态与窄屏双主题无横向溢出',async()=>{
  await page.evaluate(async()=>{const {db}=await import('/src/lib/db.ts');const original=db.get;window.restoreDetailRead=()=>{db.get=original};db.get=async(...args)=>{if(args[0]==='toolDetails')throw new Error('暂时无法读取测试正文');return original(...args)}})
  const row=page.locator('.turn .tool-row').first();await row.locator('button').first().click();await row.getByRole('alert').waitFor();await page.evaluate(()=>window.restoreDetailRead());await row.getByRole('button',{name:'重新读取',exact:true}).click();await row.locator('.tool-detail').waitFor();assert.ok((await row.locator('.tool-detail').innerText()).startsWith('工具正文🙂'));await row.locator('button').first().click()
  for(const width of [320,375,768,1440])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:1000});await page.evaluate(theme=>window.__tada.call('set_theme',{mode:theme}),theme)
   for(const name of width>=768?['全屏','分栏','抽屉']:['全屏','抽屉']){
    const mode=page.getByRole('button',{name:name+'模式',exact:true});if(await mode.count()===0)continue;await mode.click();await page.locator('.chat-root').waitFor();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
    assert.ok(await page.locator('.chat-root').evaluate(el=>el.scrollWidth<=el.clientWidth+1),`${name} ${width} ${theme}无横向溢出`)
   }
  }
  await page.setViewportSize({width:320,height:900});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.screenshot({path:out+'/mobile-history-dark.png',fullPage:true})
 })
 await test('完整大历史导出到新设备等价恢复，删除会话清理未加载轮次与明细',async()=>{
  const dump=await page.evaluate(async()=>(await import('/src/lib/storage.ts')).exportBackupSnapshot())
  assert.equal(dump.indexedDB.chat.turns.length,10002);assert.equal(dump.indexedDB.chat.toolDetails.length,10001)
  const restoredContext=await browser.newContext()
  await restoredContext.route('**/*',r=>r.request().url().startsWith(base+'/')?r.continue():r.abort())
  try{
   const restored=await restoredContext.newPage();restored.on('pageerror',e=>errors.push(e.message))
   await restored.goto(base+'/tests/chat-history-regressions.html');await restored.waitForFunction(()=>window.chatQA)
   await Promise.all([restored.waitForNavigation({waitUntil:'domcontentloaded'}),restored.evaluate(dump=>window.chatQA.storage.importBackup(dump),dump)])
   await restored.waitForFunction(()=>window.chatQA)
   const actual=await restored.evaluate(async()=>{const {database}=window.chatQA;const data=await database.db.snapshot();return {convs:data.convs,turns:data.turns,toolDetails:data.toolDetails}})
   assert.deepEqual(actual,dump.indexedDB.chat)
   const deletion=await restored.evaluate(async()=>{
    const {chat,database}=window.chatQA;await chat.initChat();const shown=chat.getChatState().turns.length
    const reads=[],original=database.db.all;database.db.all=async(...args)=>{reads.push(args[0]);return original(...args)}
    await chat.deleteConv('conv-0999');database.db.all=original
    const data=await database.db.snapshot();return {shown,reads,convs:data.convs.length,turns:data.turns.length,details:data.toolDetails.length}
   })
   assert.equal(deletion.shown,40);assert.deepEqual(deletion.reads,[]);assert.equal(deletion.convs,999);assert.equal(deletion.turns,0);assert.equal(deletion.details,0)
  }finally{await restoredContext.close()}
 })
 assert.deepEqual(errors,[])
 writeFileSync(out+'/results.json',JSON.stringify({results,benchmark},null,2));await context.close();console.log(`聊天历史浏览器 ${results.length}/${results.length} 通过；${out}`)
}finally{await browser.close()}
