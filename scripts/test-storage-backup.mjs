import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// 公开备份接口 + 原子存储替身；所有数据为合成数据，不连接浏览器或外网。
const source = ts.transpileModule(readFileSync(new URL('../src/lib/storage.ts', import.meta.url), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText
// 复用真实聊天兼容边界，避免在测试中重写一套旧轮次格式校验。
const chatModule={exports:{}}
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/chat.ts', import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:chatModule,exports:chatModule.exports,require:()=>({})})
const clone = value => structuredClone(value)
const conv = {id:'c1',title:'合成会话',createdAt:1,updatedAt:2}
const turn = {id:'t1',convId:'c1',prompt:'问题',answer:'回答',reasoning:'思考',tools:[],error:'',startedAt:1,endedAt:2}
const makeBackup = (extra={}) => ({app:'dada-backup',version:1,'fp.settings':'{"name":"备份"}',indexedDB:{kv:[{k:'note',v:'备份便签'}],chat:{convs:[conv],turns:[turn]}},...extra})
function harness() {
  const ls = new Map([['fp.settings','{"name":"原配置"}'],['unrelated','keep']])
  const tables = {kv:new Map([['note',{k:'note',v:'原便签'}]]),convs:new Map(),turns:new Map(),recovery:new Map()}
  const log=[];const failures={batch:false,set:false,rollback:false};let reloads=0;let exclusive=false;let flushData=async()=>{};let flushChat=async()=>{};let retry=async()=>{}
  const navigator={locks:{request:async(_name,_options,work)=>work()}}
  const storage = {
    get length(){return ls.size},key:i=>[...ls.keys()][i]??null,getItem:k=>ls.get(k)??null,
    setItem(k,v){if(failures.set){failures.set=false;throw new Error('模拟配置quota')}ls.set(k,String(v))},
    removeItem:k=>ls.delete(k),clear:()=>ls.clear(),
  }
  const db={
    async get(store,key){return clone(tables[store].get(key))},
    async all(store){return clone([...tables[store].values()])},
    async snapshot(){log.push('snapshot');return Object.fromEntries(['kv','convs','turns'].map(k=>[k,clone([...tables[k].values()])]))},
    async batch(ops){
      log.push('batch')
      if(failures.batch){failures.batch=false;throw new Error('模拟事务abort')}
      if(failures.rollback && ops.some(o=>o.type==='put' && o.store==='kv' && o.value.v==='原便签'))throw new Error('模拟回退失败')
      const next=Object.fromEntries(Object.entries(tables).map(([s,rows])=>[s,new Map(rows)]))
      for(const o of ops){if(o.type==='clear')next[o.store].clear();else if(o.type==='delete')next[o.store].delete(o.key);else next[o.store].set(o.store==='kv'||o.store==='recovery'?o.value.k:o.value.id,clone(o.value))}
      for(const s of Object.keys(tables))tables[s]=next[s]
    },
    async del(s,k){tables[s].delete(k)},
  }
  const module={exports:{}}
  const errors=new Map()
  const mocks={
    './db':{db,openDb:async()=>({})},
    './chat':{validateLegacyTurns:chatModule.exports.validateLegacyTurns,initChat:async()=>log.push('initChat'),flush:async()=>{log.push('flushChat');await flushChat()},clearChat:async()=>{},exportChat:async()=>({convs:[...tables.convs.values()],turns:[...tables.turns.values()]})},
    './componentData':{initComponentData:async()=>log.push('initData'),flush:async()=>{log.push('flushData');await flushData()},dropPendingData(){}},
    './sync':{waitForSyncIdle:async()=>{}},
    './persistence':{
      async withPersistenceExclusive(work,options={}){assert.equal(exclusive,false);if(errors.has('backup-restore')&&!options.recovering)throw new Error('数据恢复尚未完成');exclusive=true;try{return await work()}finally{exclusive=false}},
      async retryPersistence(){log.push('retry');await retry()},assertPersistenceHealthy(){if(errors.size)throw new Error('仍有未保存内容')},
      reportPersistenceError(s,e){errors.set(s,e)},clearPersistenceError(s){errors.delete(s)},
    },
  }
  const commitModule={exports:{}}
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/storageCommit.ts', import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:commitModule,exports:commitModule.exports,require:id=>mocks[id]??{},localStorage:storage,navigator,TextEncoder,structuredClone,console})
  mocks['./storageCommit']=commitModule.exports
  vm.runInNewContext(source,{module,exports:module.exports,require:id=>mocks[id]??{},localStorage:storage,navigator,location:{reload(){reloads++}},TextEncoder,structuredClone,console},{filename:'storage.ts'})
  return {api:module.exports,commit:commitModule.exports,ls,tables,log,failures,navigator,get reloads(){return reloads},get exclusive(){return exclusive},errors,setFlushData(fn){flushData=fn},setFlushChat(fn){flushChat=fn},setRetry(fn){retry=fn}}
}
let passed=0
async function test(name,run){await run();passed++;console.log(`通过：${name}`)}

await test('不可信备份在替换前严格验证，合法旧格式保持兼容',async()=>{
  const h=harness()
  for(const bad of [
    {indexedDB:true},{app:'dada-backup',version:99,indexedDB:{}},
    makeBackup({'fp.settings':7}),makeBackup({'fp.settings':'{broken'}),
    makeBackup({indexedDB:{kv:[],chat:{convs:[conv],turns:[{...turn,convId:'missing'}]}}}),
    makeBackup({indexedDB:{kv:[{k:'same',v:1},{k:'same',v:2}],chat:{convs:[],turns:[]}}}),
    makeBackup({indexedDB:{kv:[],chat:{convs:[conv],turns:[{...turn,tools:[{name:'x',ok:true}]}]}}}),
  ]){
    assert.throws(()=>h.api.parseBackup(JSON.stringify(bad)))
    await assert.rejects(()=>h.api.importBackup(bad))
    assert.equal(h.tables.kv.get('note').v,'原便签');assert.equal(h.reloads,0)
  }
  assert.deepEqual(JSON.parse(JSON.stringify(h.api.parseBackup(JSON.stringify({'fp.settings':'{}'})).summary)),{keys:1,convs:0,turns:0,data:0})
  assert.equal(h.api.parseBackup(JSON.stringify(makeBackup())).summary.turns,1)
})

await test('工作空间不能以合法JSON空壳覆盖现有库，旧版页面与扩展字段仍兼容',async()=>{
  const h=harness()
  for(const workspace of [[],null,{}, {pages:[]}, {pages:[{id:'home'}]}]){
    const bad=makeBackup({'fp.workspace':JSON.stringify(workspace)})
    assert.throws(()=>h.api.parseBackup(JSON.stringify(bad)),/工作空间/)
    await assert.rejects(()=>h.api.importBackup(bad),/工作空间/)
    assert.equal(h.tables.kv.get('note').v,'原便签');assert.equal(h.reloads,0)
  }
  const old={'fp.workspace':JSON.stringify({version:0,pages:[{id:'old-home',components:[]}],customLegacyField:true})}
  assert.equal(h.api.parseBackup(JSON.stringify(old)).summary.keys,1)
})

await test('旧聊天备份在清库前复用迁移格式校验，合法旧轮次仍能导入',async()=>{
  const h=harness()
  for(const turns of [[turn,{...turn,answer:'另一轮'}],[{...turn,tools:[{name:'broken'}]}],{}]){
    const bad={'fp.chatTurns.v2':JSON.stringify(turns)}
    assert.throws(()=>h.api.parseBackup(JSON.stringify(bad)),/旧聊天/)
    await assert.rejects(()=>h.api.importBackup(bad),/旧聊天/)
    assert.equal(h.tables.kv.get('note').v,'原便签');assert.equal(h.tables.recovery.size,0);assert.equal(h.reloads,0)
    assert.equal(h.log.includes('batch'),false)
  }
  const good={'fp.chatTurns.v2':JSON.stringify([turn])}
  assert.equal(h.api.parseBackup(JSON.stringify(good)).summary.keys,1)
  await h.api.importBackup(good)
  assert.equal(h.ls.get('fp.chatTurns.v2'),JSON.stringify([turn]));assert.equal(h.reloads,1)
})

await test('导出先等待保存屏障，包含最新配置和业务数据',async()=>{
  const h=harness()
  h.setFlushData(async()=>{h.tables.kv.set('note',{k:'note',v:'刚编辑'})})
  h.setRetry(async()=>h.ls.set('fp.settings','{"name":"刚改名"}'))
  const dump=await h.api.exportBackupSnapshot()
  assert.equal(dump['fp.settings'],'{"name":"刚改名"}')
  assert.equal(dump.indexedDB.kv[0].v,'刚编辑')
  assert.equal(dump.app,'dada-backup');assert.equal(dump.version,1)
  assert.ok(h.log.indexOf('snapshot')>h.log.indexOf('flushData'))
  assert.ok(h.log.indexOf('snapshot')>h.log.indexOf('retry'))
})

await test('保存或读取失败不导出成功空快照',async()=>{
  const h=harness();h.setFlushChat(async()=>{throw new Error('模拟聊天未保存')})
  await assert.rejects(()=>h.api.exportBackupSnapshot(),/聊天未保存/)
  assert.equal(h.log.includes('snapshot'),false)
})

await test('生成中导出不持有写入门禁，后续片段仍能继续保存',async()=>{
  const h=harness();let release;const waiting=new Promise(resolve=>{release=resolve})
  h.setFlushChat(async()=>{assert.equal(h.exclusive,false);await waiting})
  const exporting=h.api.exportBackupSnapshot()
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(h.exclusive,false)
  h.tables.turns.set('t1',turn);h.tables.convs.set('c1',conv)
  release();const dump=await exporting
  assert.equal(dump.indexedDB.chat.turns[0].answer,'回答')
})

await test('合法恢复替换业务表与配置，保留非搭搭配置并清理恢复日志',async()=>{
  const h=harness();await h.api.importBackup(makeBackup())
  assert.equal(h.tables.kv.get('note').v,'备份便签')
  assert.equal(h.tables.turns.get('t1').answer,'回答')
  assert.equal(h.ls.get('fp.settings'),'{"name":"备份"}')
  assert.equal(h.ls.get('unrelated'),'keep');assert.equal(h.tables.recovery.size,0);assert.equal(h.reloads,1)
})

await test('目标事务abort不触碰原配置或原业务数据',async()=>{
  const h=harness();h.failures.batch=true
  await assert.rejects(()=>h.api.importBackup(makeBackup()),/abort/)
  assert.equal(h.tables.kv.get('note').v,'原便签');assert.equal(h.ls.get('fp.settings'),'{"name":"原配置"}')
  assert.equal(h.tables.recovery.size,0);assert.equal(h.reloads,0)
})

await test('配置quota失败回退原快照，重试导入仍可成功',async()=>{
  const h=harness();h.failures.set=true
  await assert.rejects(()=>h.api.importBackup(makeBackup()),/quota/)
  assert.equal(h.tables.kv.get('note').v,'原便签');assert.equal(h.ls.get('fp.settings'),'{"name":"原配置"}')
  assert.equal(h.tables.recovery.size,0);assert.equal(h.reloads,0)
  await h.api.importBackup(makeBackup());assert.equal(h.reloads,1)
})

await test('回退再失败保留恢复日志，同页重试在业务初始化前恢复原数据并解除门禁',async()=>{
  const h=harness();h.failures.set=true;h.failures.rollback=true
  await assert.rejects(()=>h.api.importBackup(makeBackup()))
  assert.equal(h.tables.recovery.size,1);assert.equal(h.reloads,0)
  await assert.rejects(()=>h.api.importBackup(makeBackup()),/恢复尚未完成/)
  await assert.rejects(()=>h.api.recoverStorage(),/回退失败/)
  assert.equal(h.errors.has('backup-restore'),true)
  h.failures.rollback=false
  await h.api.initStorage()
  assert.equal(h.tables.kv.get('note').v,'原便签');assert.equal(h.ls.get('fp.settings'),'{"name":"原配置"}')
  assert.equal(h.tables.recovery.size,0)
  assert.equal(h.errors.has('backup-restore'),false)
  assert.ok(h.log.lastIndexOf('batch')<h.log.indexOf('initData'))
  await h.api.importBackup(makeBackup());assert.equal(h.reloads,1)
})

await test('其他标签页已清理恢复日志时同页重新检查会解除旧恢复错误',async()=>{
  const h=harness();h.errors.set('backup-restore',new Error('之前回退失败'))
  await h.api.recoverStorage()
  assert.equal(h.errors.has('backup-restore'),false)
  await h.api.importBackup(makeBackup());assert.equal(h.reloads,1)
})

await test('重置也走可恢复替换，排空旧队列后只清搭搭数据',async()=>{
  const h=harness();h.setFlushData(async()=>h.tables.kv.set('late',{k:'late',v:'旧队列'}))
  await h.api.resetStorage()
  assert.equal(h.tables.kv.size,0);assert.equal(h.tables.convs.size,0);assert.equal(h.tables.turns.size,0)
  assert.equal(h.ls.has('fp.settings'),false);assert.equal(h.ls.get('unrelated'),'keep');assert.equal(h.reloads,1)
})

await test('救援导出保留坏旧配置，恢复日志也能原样回退坏配置与旧孤立轮次',async()=>{
  const h=harness();h.ls.set('fp.data.old','{broken')
  const dump=await h.api.exportBackupSnapshot()
  assert.equal(dump['fp.data.old'],'{broken')
  assert.throws(()=>h.api.parseBackup(JSON.stringify(dump)),/JSON/)
  h.tables.recovery.set('backup-restore',{k:'backup-restore',version:1,before:{local:{'fp.data.old':'{broken'},data:{kv:[{k:'old',v:7}],convs:[],turns:[{id:'orphan',convId:'removed'}]}}})
  await h.api.initStorage()
  assert.equal(h.ls.get('fp.data.old'),'{broken');assert.equal(h.tables.turns.get('orphan').convId,'removed')
  assert.equal(h.tables.recovery.size,0)
})

await test('缺少同源安全锁时可普通启动，但恢复拒绝且原数据不变',async()=>{
  const h=harness();delete h.navigator.locks
  await h.api.initStorage()
  await assert.rejects(()=>h.api.importBackup(makeBackup()),/Web Locks/)
  assert.equal(h.tables.kv.get('note').v,'原便签');assert.equal(h.reloads,0)
})
await test('仅配置提交的quota回退不读取或清空业务表',async()=>{
  const h=harness();h.failures.set=true
  await assert.rejects(()=>h.commit.commitStorage({local:{'fp.settings':'{"name":"远端"}'},operations:[]}),/quota/)
  assert.equal(h.ls.get('fp.settings'),'{"name":"原配置"}')
  assert.equal(h.tables.kv.get('note').v,'原便签');assert.equal(h.tables.recovery.size,0)
  assert.equal(h.log.includes('snapshot'),false)
})
await test('仅配置中断日志重新启动只恢复配置，保留期间的业务表',async()=>{
  const h=harness();h.ls.set('fp.settings','{"name":"中断"}')
  h.tables.kv.set('new',{k:'new',v:'业务继续保留'})
  h.tables.recovery.set('backup-restore',{k:'backup-restore',version:1,before:{local:{'fp.settings':'{"name":"原配置"}'},data:null}})
  await h.api.recoverStorage()
  assert.equal(h.ls.get('fp.settings'),'{"name":"原配置"}');assert.equal(h.tables.kv.get('new').v,'业务继续保留')
  assert.equal(h.tables.recovery.size,0);assert.equal(h.log.includes('batch'),false)
})
console.log(`备份公开行为 ${passed} 项通过`)
