import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const clone = value => structuredClone(value)
const deferred = () => {let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
const tick = () => new Promise(resolve=>setImmediate(resolve))
function compare(a,b) {
 if(Array.isArray(a)&&Array.isArray(b)){for(let i=0;i<Math.min(a.length,b.length);i++){const c=compare(a[i],b[i]);if(c)return c}return a.length-b.length}
 if(Array.isArray(a))return 1;if(Array.isArray(b))return -1
 return a<b?-1:a>b?1:0
}
function backend() {
 const tables=Object.fromEntries(['kv','apps','convs','turns','toolDetails'].map(s=>[s,new Map()]))
 return {tables,reads:[],batches:[],pageGate:null,writeGate:null,readError:null,writeError:null,
  async page(store,index,options){this.reads.push({method:'page',store,index,options:clone(options)});if(this.readError)throw this.readError;const key=r=>index==='recent'?[r.updatedAt,r.id]:[r.convId,r.startedAt,r.id];const rows=[...tables[store].values()].filter(row=>(options.lower===undefined||compare(key(row),options.lower)>(options.lowerOpen?0:-1))&&(options.upper===undefined||compare(key(row),options.upper)<(options.upperOpen?0:1))).sort((a,b)=>compare(key(a),key(b))*(options.direction==='prev'?-1:1)).slice(0,options.limit).map(clone);const gate=this.pageGate;this.pageGate=null;if(gate)await gate;return rows},
  async get(store,id){this.reads.push({method:'get',store,id});if(this.readError)throw this.readError;return tables[store].has(id)?clone(tables[store].get(id)):undefined},
  async keysByIndex(store,index,key){this.reads.push({method:'keys',store,index,key});if(this.readError)throw this.readError;return [...tables[store].values()].filter(r=>r[index]===key).map(r=>r.id)},
  async batch(operations){this.batches.push(clone(operations));const gate=this.writeGate;this.writeGate=null;if(gate)await gate;if(this.writeError)throw this.writeError;for(const op of operations){if(op.type==='clear')tables[op.store].clear();else if(op.type==='delete')tables[op.store].delete(op.key);else tables[op.store].set(op.value.id??op.value.k,clone(op.value))}},
  async snapshot(){return Object.fromEntries(Object.entries(tables).map(([s,rows])=>[s,[...rows.values()].map(clone)]))},
 }
}
function runtime(db,saved='') {
 const modules=new Map(),settings=new Map([['conv',saved]]),timers=new Map();let timer=0
 function load(path){if(modules.has(path))return modules.get(path);const module={exports:{}};modules.set(path,module.exports);const code=ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const require=id=>{if(id==='react')return{useSyncExternalStore:(_,get)=>get()};if(id==='./db')return{db};if(id==='./store')return{readStored:(k,f)=>settings.get(k)??f,writeStored:(k,v)=>settings.set(k,v)};if(id.startsWith('.'))return load(new URL(id+'.ts','file:///'+path).pathname.slice(1));throw new Error(id)}
 vm.runInNewContext(code,{module,exports:module.exports,require,TextEncoder,Error,window:{setTimeout:fn=>{timers.set(++timer,fn);return timer},clearTimeout:id=>timers.delete(id),addEventListener(){}},document:{addEventListener(){},visibilityState:'visible'}},{filename:path});return module.exports}
 return{chat:load('src/lib/chat.ts'),schema:load('src/lib/chatStorageSchema.ts'),persistence:load('src/lib/persistence.ts')}
}
const conv=(id='c',time=1)=>({id,title:'会话 '+id,createdAt:time,updatedAt:time})
const full=(id='t',convId='c',time=1)=>({id,convId,prompt:'问题 '+id,answer:'答复 '+id,reasoning:'完整思考 '+id,tools:[{name:'test',title:'工具',ok:true,text:'正文中文🙂 '+id}],error:'',startedAt:time,endedAt:time+1})
function seed(db,app,{convs=1,turns=0}={}){for(let i=0;i<convs;i++){const c=conv('c'+String(i).padStart(4,'0'),i);db.tables.convs.set(c.id,c)}for(let i=0;i<turns;i++){const s=app.schema.splitTurn(full('t'+String(i).padStart(5,'0'),'c0000',Math.floor(i/2)));db.tables.turns.set(s.turn.id,s.turn);for(const d of s.details)db.tables.toolDetails.set(d.id,d)}}
let passed=0
async function test(name,run){await run();passed++;console.log('通过：'+name)}
await test('1000会话/10000轮启动只读51索引和41轮，不读工具正文；saved会话不在第一页仍打开',async()=>{
 const db=backend(),app=runtime(db,'c0000');seed(db,app,{convs:1000,turns:10000});await app.chat.initChat();const s=app.chat.getChatState();assert.equal(s.convs.length,50);assert.equal(s.currentConv.id,'c0000');assert.equal(s.turns.length,40);assert.equal(s.turns[0].id,'t09960');assert.equal(s.hasOlderTurns,true);assert.equal(db.reads.some(r=>r.store==='toolDetails'),false);assert.deepEqual(db.reads.filter(r=>r.method==='page').map(r=>r.options.limit),[51,41])
})
await test('同毫秒游标翻完全部历史顺序无重复/遗漏；读取不产生写入或删除',async()=>{
 const db=backend(),app=runtime(db,'c0000');seed(db,app,{convs:124,turns:125});await app.chat.initChat();while(app.chat.getChatState().hasOlderTurns)await app.chat.loadOlderTurns();while(app.chat.getChatState().hasMoreConvs)await app.chat.loadMoreConvs();const s=app.chat.getChatState();assert.equal(s.turns.length,125);assert.equal(new Set(s.turns.map(r=>r.id)).size,125);assert.equal(s.turns[0].id,'t00000');assert.equal(s.convs.length,124);assert.equal(db.batches.length,0)
})
await test('工具正文按单条引用读取，完整中文emoji不截断，缺失/字节坏值不伪装为空',async()=>{
 const db=backend(),app=runtime(db,'c0000');seed(db,app,{turns:1});await app.chat.initChat();const ref=app.chat.getChatState().turns[0].tools[0].detailId;assert.equal(await app.chat.readToolDetail(ref),'正文中文🙂 t00000');assert.equal(db.reads.filter(r=>r.store==='toolDetails').length,1);db.tables.toolDetails.get(ref).bytes=0;await assert.rejects(app.chat.readToolDetail(ref),/字节/);db.tables.toolDetails.delete(ref);await assert.rejects(app.chat.readToolDetail(ref),/无法读取/)
})
await test('活动轮跨会话和翻页持续更新，返回不settle或覆盖新输出；禁止删除生成中会话',async()=>{
 const db=backend(),app=runtime(db,'c0000');seed(db,app,{convs:2,turns:85});await app.chat.initChat();const id=app.chat.getChatState().convId;const t={...app.chat.beginTurn('流式'),id:'live'};app.chat.appendTurn(id,t);app.chat.appendTool(id,t.id,{name:'x',title:'完整结果',ok:true,text:'大'.repeat(100000)});await app.chat.openConv('c0001');app.chat.patchTurn(id,t.id,{answer:'第一段'});await assert.rejects(app.chat.deleteConv(id),/停止/);await app.chat.openConv(id);assert.equal(app.chat.getChatState().turns.at(-1).answer,'第一段');assert.equal(app.chat.getChatState().activeTurnIds.includes(t.id),true);await app.chat.loadOlderTurns();app.chat.patchTurn(id,t.id,{answer:'完整输出',endedAt:Date.now()});await app.chat.flush();assert.equal(app.chat.getChatState().turns.length,80);assert.equal(db.tables.turns.get(t.id).answer,'完整输出');assert.equal((await app.chat.exportChat()).turns.at(-1).tools[0].text.length,100000)
})
await test('上下文独立最新100轮查询，UI翻页不影响内容且不读取工具正文',async()=>{
 const db=backend(),app=runtime(db,'c0000');seed(db,app,{turns:130});await app.chat.initChat();const a=await app.chat.loadContextTurns('c0000',100);await app.chat.loadOlderTurns();const b=await app.chat.loadContextTurns('c0000',100);assert.deepEqual(a,b);assert.equal(a.length,100);assert.equal(a[0].id,'t00030');assert.equal(db.reads.some(r=>r.store==='toolDetails'),false);assert.equal(app.chat.contextTurns([{prompt:'文'.repeat(40000),answer:'大'}]).length,1);const article={title:'参考',link:'https://example.test',context:'原文'};assert.match(app.chat.turnContent({prompt:'问题',article}),/原文\n\n用户的问题：\n问题/)
})
await test('新工具引用和正文同事务确认，失败保留最新；后续answer片段不重写旧正文',async()=>{
 const db=backend(),app=runtime(db);await app.chat.initChat();const id=app.chat.getChatState().convId,t={...app.chat.beginTurn('事务'),id:'atomic'};app.chat.appendTurn(id,t);app.chat.appendTool(id,t.id,{name:'x',title:'动作',ok:true,text:'原始全文'});db.writeError=new Error('quota');await assert.rejects(app.chat.flush(),/quota/);assert.equal(db.tables.turns.size,0);assert.equal(db.tables.toolDetails.size,0);app.chat.patchTurn(id,t.id,{answer:'最新片段'});db.writeError=null;await app.persistence.retryPersistence();assert.equal(db.tables.turns.get(t.id).answer,'最新片段');assert.equal(db.tables.toolDetails.size,1);assert.ok(db.batches.at(-1).some(op=>op.store==='turns'));assert.ok(db.batches.at(-1).some(op=>op.store==='toolDetails'));app.chat.patchTurn(id,t.id,{answer:'再一段'});await app.chat.flush();assert.equal(db.batches.at(-1).some(op=>op.store==='toolDetails'),false)
})
await test('旧事务确认不能清除新轮次和新工具正文',async()=>{
 const db=backend(),app=runtime(db);await app.chat.initChat();const id=app.chat.getChatState().convId,t={...app.chat.beginTurn('并发'),id:'newer'};app.chat.appendTurn(id,t);const gate=deferred();db.writeGate=gate.promise;const flush=app.chat.flush();await tick();app.chat.appendTool(id,t.id,{name:'x',title:'新工具',ok:true,text:'新正文'});app.chat.patchTurn(id,t.id,{answer:'新答案'});gate.resolve();await flush;assert.equal(db.tables.turns.get(t.id).tools.length,1);assert.equal(db.tables.toolDetails.size,1);assert.equal(db.tables.turns.get(t.id).answer,'新答案')
})
await test('翻页失败保留旧页和游标，重试真实读取；迟到导航不会覆盖新选择',async()=>{
 const db=backend(),app=runtime(db,'c0000');seed(db,app,{convs:3,turns:100});await app.chat.initChat();db.readError=new Error('读取失败');await assert.rejects(app.chat.loadOlderTurns(),/读取失败/);assert.equal(app.chat.getChatState().turns.length,40);assert.equal(app.chat.getChatState().hasOlderTurns,true);db.readError=null;await app.chat.loadOlderTurns();assert.equal(app.chat.getChatState().turns.length,80);const gate=deferred();db.pageGate=gate.promise;const old=app.chat.openConv('c0001');await tick();await app.chat.openConv('c0002');gate.resolve();await old;assert.equal(app.chat.getChatState().convId,'c0002')
})
await test('打开会话的旧快照迟到时，已结束并flush的完整输出与finally清理仍保留',async()=>{
 const db=backend(),app=runtime(db,'c0000');seed(db,app,{convs:2,turns:1});await app.chat.initChat();const t={...app.chat.beginTurn('查询竞态'),id:'finishing'};app.chat.appendTurn('c0000',t);app.chat.patchTurn('c0000',t.id,{answer:'早期输出',pending:{request:{tool:'x',summary:'确认'}}});await app.chat.openConv('c0001');const gate=deferred();db.pageGate=gate.promise;const opening=app.chat.openConv('c0000');await tick();app.chat.appendTool('c0000',t.id,{name:'x',title:'迟到结果',ok:true,text:'完整正文'});app.chat.patchTurn('c0000',t.id,{answer:'最终完整输出',endedAt:Date.now()});app.chat.patchTurn('c0000',t.id,{pending:undefined});await app.chat.flush();assert.equal(app.chat.getChatState().activeTurnIds.length,0);gate.resolve();await opening;const result=app.chat.getChatState().turns.find(row=>row.id===t.id);assert.equal(result.answer,'最终完整输出');assert.equal(result.pending,undefined);assert.equal(result.aborted,undefined);assert.equal(result.tools.length,1);assert.equal(app.chat.getChatState().currentConv.updatedAt,db.tables.convs.get('c0000').updatedAt)
})
await test('更多会话旧分页不得覆盖查询期间已提交的新会话顺序和元数据',async()=>{
 const db=backend(),app=runtime(db,'c0000');seed(db,app,{convs:80,turns:1});await app.chat.initChat();const gate=deferred();db.pageGate=gate.promise;const loading=app.chat.loadMoreConvs();await tick();const t={...app.chat.beginTurn('查询期间更新'),id:'new-order'};app.chat.appendTurn('c0000',t);app.chat.patchTurn('c0000',t.id,{answer:'完成',endedAt:Date.now()});await app.chat.flush();const updated=db.tables.convs.get('c0000').updatedAt;gate.resolve();await loading;assert.equal(app.chat.getChatState().convs[0].id,'c0000');assert.equal(app.chat.getChatState().convs[0].updatedAt,updated);assert.equal(app.chat.getChatState().convs.length,80)
})
await test('上下文查询合并查询期间已结束并确认的更新，不回退旧答案',async()=>{
 const db=backend(),app=runtime(db,'c0000');seed(db,app,{turns:1});await app.chat.initChat();const t={...app.chat.beginTurn('上下文竞态'),id:'context-live'};app.chat.appendTurn('c0000',t);await app.chat.flush();const gate=deferred();db.pageGate=gate.promise;const loading=app.chat.loadContextTurns('c0000');await tick();app.chat.patchTurn('c0000',t.id,{answer:'最终上下文',endedAt:Date.now()});await app.chat.flush();gate.resolve();assert.equal((await loading).at(-1).answer,'最终上下文')
})
await test('重选当前会话取消待定导航，打开失败不污染更早分页的重试状态',async()=>{
 const db=backend(),app=runtime(db,'c0000');seed(db,app,{convs:2,turns:100});await app.chat.initChat();const gate=deferred();db.pageGate=gate.promise;const opening=app.chat.openConv('c0001');await tick();await app.chat.openConv('c0000');gate.resolve();await opening;assert.equal(app.chat.getChatState().convId,'c0000');assert.equal(app.chat.getChatState().turnsLoading,false);await assert.rejects(app.chat.openConv('missing'),/不存在/);assert.equal(app.chat.getChatState().turnsError,'');assert.equal(app.chat.getChatState().turns.length,40);await app.chat.loadOlderTurns();assert.equal(app.chat.getChatState().turns.length,80)
})
await test('删除未加载旧页及所有正文用key索引，原子清除且不读正文',async()=>{
 const db=backend(),app=runtime(db,'c0000');seed(db,app,{convs:2,turns:100});await app.chat.initChat();const before=db.reads.length;await app.chat.deleteConv('c0000');assert.equal(db.tables.turns.size,0);assert.equal(db.tables.toolDetails.size,0);assert.equal(db.tables.convs.size,1);assert.ok(db.reads.slice(before).every(r=>r.method==='keys'));assert.equal(app.chat.getChatState().turns.length,0)
})
await test('删除其他会话成功或失败均不取消当前更早页，也不残留loading',async()=>{
 for(const fails of [false,true]){const db=backend(),app=runtime(db,'c0000');seed(db,app,{convs:2,turns:100});await app.chat.initChat();const gate=deferred();db.pageGate=gate.promise;const loading=app.chat.loadOlderTurns();await tick();if(fails){db.writeError=new Error('删除失败');await assert.rejects(app.chat.deleteConv('c0001'),/删除失败/);db.writeError=null}else await app.chat.deleteConv('c0001');assert.equal(app.chat.getChatState().turnsLoading,true);gate.resolve();await loading;assert.equal(app.chat.getChatState().turns.length,80);assert.equal(app.chat.getChatState().turnsLoading,false);assert.equal(app.chat.getChatState().hasOlderTurns,true)}
})
await test('删除事务期间导航到另一会话，其独立loading和结果不会被清除',async()=>{
 const db=backend(),app=runtime(db,'c0000');seed(db,app,{convs:3,turns:100});await app.chat.initChat();const writeGate=deferred();db.writeGate=writeGate.promise;const deleting=app.chat.deleteConv('c0001');await tick();const pageGate=deferred();db.pageGate=pageGate.promise;const opening=app.chat.openConv('c0002');await tick();writeGate.resolve();await deleting;assert.equal(app.chat.getChatState().turnsLoading,true);pageGate.resolve();await opening;assert.equal(app.chat.getChatState().convId,'c0002');assert.equal(app.chat.getChatState().turnsLoading,false)
})
await test('删除待定导航目标使旧读取失效，删除当前会话不阻止另一导航完成',async()=>{
 for(const target of ['c0001','c0000']){const db=backend(),app=runtime(db,'c0000');seed(db,app,{convs:2,turns:100});await app.chat.initChat();const gate=deferred();db.pageGate=gate.promise;const opening=app.chat.openConv('c0001');await tick();await app.chat.deleteConv(target);assert.equal(app.chat.getChatState().turnsLoading,target==='c0000');gate.resolve();await opening;assert.equal(app.chat.getChatState().convId,target==='c0001'?'c0000':'c0001');assert.equal(app.chat.getChatState().turnsLoading,false)}
})
await test('纯schema整轮拆装等价，重复/缺失/跨轮引用和孤立正文拒绝',async()=>{
 const app=runtime(backend()),value=full();value.pending={request:{tool:'x',summary:'请确认',remember:'允许x'}};const {turn,details}=app.schema.splitTurn(value);assert.deepEqual(JSON.parse(JSON.stringify(app.schema.hydrateTurn(turn,new Map(details.map(d=>[d.id,d]))))),value);app.schema.validateStoredChat([conv()],[turn],details);assert.throws(()=>app.schema.validateStoredChat([conv()],[turn],[]),/缺失/);assert.throws(()=>app.schema.validateStoredChat([conv()],[turn],[...details,...details]),/重复/);assert.throws(()=>app.schema.validateStoredChat([conv()],[turn],[{...details[0],convId:'other'}]),/归属/);assert.throws(()=>app.schema.validateStoredChat([conv()],[],details),/引用/)
})
await test('恢复门禁阻止新写，既有轮次和正文仍可排空',async()=>{
 const db=backend(),app=runtime(db);await app.chat.initChat();const id=app.chat.getChatState().convId,t=app.chat.beginTurn('已有');app.chat.appendTurn(id,t);await app.persistence.withPersistenceExclusive(async()=>{assert.throws(()=>app.chat.patchTurn(id,t.id,{answer:'越界'}),/恢复/);await app.chat.flush()});assert.equal(db.tables.turns.size,1)
})
await test('清空期间不接受会被事务删除的新写，失败保留数据并恢复可写',async()=>{
 for(const fails of [false,true]){const db=backend(),app=runtime(db,'c0000');seed(db,app,{turns:1});await app.chat.initChat();const gate=deferred();db.writeGate=gate.promise;if(fails)db.writeError=new Error('清空失败');const clearing=app.chat.clearChat();await tick();assert.throws(()=>app.chat.appendTurn('c0000',app.chat.beginTurn('不能丢')),/清空/);gate.resolve();if(fails){await assert.rejects(clearing,/清空失败/);db.writeError=null;assert.equal(db.tables.turns.size,1);assert.equal(app.chat.getChatState().turns.length,1)}else{await clearing;assert.equal(db.tables.turns.size,0);assert.equal(db.tables.toolDetails.size,0);assert.equal(app.chat.getChatState().turns.length,0)}const id=app.chat.getChatState().convId;app.chat.appendTurn(id,app.chat.beginTurn('恢复可写'));await app.chat.flush();assert.equal(db.tables.turns.size,fails?2:1)}
})
await test('清空后在途轮次/会话分页不能回流旧数据，loading与新会话写入正常',async()=>{
 const db=backend(),app=runtime(db,'c0000');seed(db,app,{convs:80,turns:100});await app.chat.initChat();const turnsGate=deferred();db.pageGate=turnsGate.promise;const older=app.chat.loadOlderTurns();await tick();const convsGate=deferred();db.pageGate=convsGate.promise;const more=app.chat.loadMoreConvs();await tick();await app.chat.clearChat();turnsGate.resolve();convsGate.resolve();await Promise.all([older,more]);const state=app.chat.getChatState();assert.equal(state.turns.length,0);assert.equal(state.convs.length,0);assert.equal(state.turnsLoading,false);assert.equal(state.convsLoading,false);const t=app.chat.beginTurn('清空后');app.chat.appendTurn(state.convId,t);await app.chat.flush();assert.equal(db.tables.turns.size,1);assert.equal(db.tables.toolDetails.size,0);assert.equal(db.tables.convs.size,1)
})
console.log(`聊天分页与明细回归全部通过：${passed}/${passed}`)
