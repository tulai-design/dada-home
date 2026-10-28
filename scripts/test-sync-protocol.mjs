import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import {webcrypto} from 'node:crypto'

// 公开 runSync / testConnection + 真实 provider、协议、codec、提交门禁；仅存储与网络为合成替身。
const sources = new Map()
const copy = value => structuredClone(value)
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
const hash = async value => Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)))).toString('hex')
const row = async (value, counter=1, device='remote') => ({revision:{counter,device},hash:await hash({value}),value})
const tombstone = async (counter=2) => ({revision:{counter,device:'remote'},hash:await hash({deleted:true}),deleted:true})
const snapshot = records => JSON.stringify({app:'dada-sync',version:2,scope:'full',secrets:false,records})
function server() {
  return {text:null,etag:0,requests:[],onRead:undefined,onWrite:undefined,
    async fetch(url, init={}) {
      const method=init.method??'GET';this.requests.push({url,method,headers:init.headers,body:init.body})
      if(method==='GET') {await this.onRead?.();return this.text===null?new Response('',{status:404}):new Response(this.text,{headers:{etag:`"${this.etag}"`}})}
      await this.onWrite?.()
      const headers=new Headers(init.headers)
      if(headers.get('if-match')!==null && headers.get('if-match')!==`"${this.etag}"`)return new Response('',{status:412})
      if(headers.get('if-none-match')==='*' && this.text!==null)return new Response('',{status:412})
      this.text=init.body;this.etag++;return new Response(null,{status:204})
    },get writes(){return this.requests.filter(r=>r.method!=='GET').length}}
}
function client(remote, existing) {
  const ls=existing?.ls??new Map(),tables=existing?.tables??Object.fromEntries(['kv','apps','convs','turns','recovery'].map(s=>[s,new Map()]))
  const modules=new Map(),errors={read:false,batch:false,set:false,rollback:false},log=[]
  const localStorage={get length(){return ls.size},key:index=>[...ls.keys()][index]??null,getItem:key=>ls.get(key)??null,setItem(key,value){if(errors.set){errors.set=false;throw new Error('quota')}ls.set(key,String(value))},removeItem:key=>ls.delete(key)}
  const db={async get(store,key){await onGet?.();return copy(tables[store].get(key))},async snapshot(){if(errors.read)throw new Error('读取失败');return Object.fromEntries(['kv','apps','convs','turns'].map(s=>[s,copy([...tables[s].values()])]))},async del(s,k){tables[s].delete(k)},async batch(ops){log.push(ops);if(errors.batch)throw new Error('事务abort');const next=Object.fromEntries(Object.entries(tables).map(([s,rows])=>[s,new Map(rows)]));for(const op of ops){if(op.type==='clear')next[op.store].clear();else if(op.type==='delete')next[op.store].delete(op.key);else next[op.store].set(op.store==='kv'||op.store==='apps'||op.store==='recovery'?op.value.k:op.value.id,copy(op.value))}for(const s of Object.keys(tables))tables[s]=next[s]}}
  let flush=async()=>{},onGet
  const deps={react:{useSyncExternalStore:(_,get)=>get()},'./db':{db,openDb:async()=>({})},'./applicationData':{flushApplicationData:async()=>flush()},'./chat':{flush:async()=>flush()},'./componentData':{flush:async()=>flush()},'./rss':{proxied:url=>url}}
  const navigator={onLine:true,locks:{request:async(_name,_options,work)=>work()}}
  function load(file){if(modules.has(file))return modules.get(file);const module={exports:{}};modules.set(file,module.exports);if(!sources.has(file))sources.set(file,ts.transpileModule(readFileSync(new URL(`../src/lib/${file}.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText);new Function('module','exports','require','localStorage','fetch','navigator','crypto',sources.get(file))(module,module.exports,id=>deps[id]??load(id.slice(2)),localStorage,(...args)=>remote.fetch(...args),navigator,webcrypto);return module.exports}
  const api=load('sync'),persistence=load('persistence')
  if(!existing)api.writeSyncConfig({...api.defaultSyncConfig(),backend:'http',http:{url:'https://sync.invalid/data',token:'',proxy:''},auto:false})
  return {api,persistence,ls,tables,errors,log,reload:()=>client(remote,{ls,tables}),get status(){return api.useSyncStatus()},setFlush(fn){flush=fn},setOnGet(fn){onGet=fn}}
}
let count=0
async function test(name,run){await run();console.log(`通过：${name}`);count++}

await test('新协议拒绝旧版、未知版本、未知目标、越权配置及坏哈希，零本机/云端写入',async()=>{
  for(const body of [JSON.stringify({app:'dada',v:1,recs:{}}),JSON.stringify({app:'dada-sync',version:99,scope:'full',secrets:false,records:{}}),snapshot({'ls:fp.alwaysAllow':await row(true)}),snapshot({'config:settings':await row({proxy:'https://unsafe'})}),snapshot({'config:sidebarAi':{...await row('drawer'),hash:'0'.repeat(64)}})]){
    const s=server();s.text=body;const c=client(s);c.ls.set('fp.settings','{"name":"本机"}')
    await assert.rejects(c.api.runSync());assert.equal(s.writes,0);assert.equal(c.ls.get('fp.settings'),'{"name":"本机"}');assert.equal(c.log.length,0)
  }
})
await test('两设备首次同身份远端优先，本机独有合并；完整拉取后只读直到刷新',async()=>{
  const s=server(),a=client(s);a.ls.set('fp.settings','{"name":"A"}');a.tables.kv.set('note',{k:'note',v:'A便签'})
  await a.api.runSync();const b=client(s);b.ls.set('fp.settings','{"name":"B"}');b.tables.kv.set('unique',{k:'unique',v:'独有'})
  const result=await b.api.runSync();assert.equal(result.needsReload,true);assert.equal(JSON.parse(b.ls.get('fp.settings')).name,'A');assert.equal(b.tables.kv.get('note').v,'A便签');assert.equal(JSON.parse(s.text).records['component:unique'].value,'独有')
  assert.throws(()=>b.persistence.assertPersistenceWritable(),/重新加载/);assert.doesNotThrow(()=>b.reload().persistence.assertPersistenceWritable())
})
await test('两设备应用仓往返保留同名三种身份，无安装记录也同步且无物理重复',async()=>{
  const s=server();let a=client(s)
  a.tables.apps.set('app:same',{k:'app:same',v:{text:'中文🙂'.repeat(30000)}})
  a.tables.apps.set('applet:same',{k:'applet:same',v:{count:2}})
  a.tables.kv.set('same',{k:'same',v:'普通组件'})
  a.ls.set('fp.app.same',JSON.stringify({text:'旧物理值不采样'}))
  await a.api.runSync()
  assert.deepEqual(Object.keys(JSON.parse(s.text).records).sort(),['app:app:same','app:applet:same','component:same'])
  let b=client(s);await b.api.runSync();b=b.reload()
  assert.equal(b.tables.apps.get('app:same').v.text,'中文🙂'.repeat(30000))
  b.tables.apps.set('applet:same',{k:'applet:same',v:{count:3}});await b.api.runSync()
  await a.api.runSync();a=a.reload()
  assert.equal(a.tables.apps.get('applet:same').v.count,3)
  a.tables.apps.delete('app:same');await a.api.runSync();await b.api.runSync()
  assert.equal(b.tables.apps.has('app:same'),false);assert.equal(b.tables.apps.get('applet:same').v.count,3);assert.equal(b.tables.kv.get('same').v,'普通组件')
  assert.equal(JSON.parse(s.text).records['app:app:same'].deleted,true)
})
await test('规范化对象键顺序不上传；同一毫秒多次修改仍使用增长的逻辑版本',async()=>{
  const s=server(),c=client(s);c.tables.kv.set('note',{k:'note',v:{a:1,b:2}});await c.api.runSync();const first=JSON.parse(s.text).records['component:note'].revision.counter
  const writes=s.writes;c.tables.kv.set('note',{k:'note',v:{b:2,a:1}});await c.api.runSync();assert.equal(s.writes,writes)
  c.tables.kv.set('note',{k:'note',v:{a:2}});await c.api.runSync();const second=JSON.parse(s.text).records['component:note'].revision.counter
  c.tables.kv.set('note',{k:'note',v:{a:3}});await c.api.runSync();assert.ok(second>first);assert.ok(JSON.parse(s.text).records['component:note'].revision.counter>second)
})
await test('删除墓碑长期保留，已同步旧设备不会让它复活',async()=>{
  const s=server(),a=client(s);a.tables.kv.set('note',{k:'note',v:'便签'});await a.api.runSync();let b=client(s);await b.api.runSync();b=b.reload();a.tables.kv.delete('note');await a.api.runSync();assert.equal(JSON.parse(s.text).records['component:note'].deleted,true)
  await b.api.runSync();assert.equal(b.tables.kv.has('note'),false);assert.equal(JSON.parse(s.text).records['component:note'].deleted,true)
})
await test('缺失会话与不完整轮次被拒绝；生成中轮次不会变成删除或覆盖',async()=>{
  const s=server();s.text=snapshot({'turn:t':await row({id:'t',convId:'missing',prompt:'q',answer:'a',reasoning:'',tools:[],error:'',startedAt:1,endedAt:2})});let c=client(s);await assert.rejects(c.api.runSync(),/会话/);assert.equal(s.writes,0)
  s.text=null;c=client(s);const conv={id:'c',title:'会话',createdAt:1,updatedAt:1},turn={id:'t',convId:'c',prompt:'q',answer:'a',reasoning:'',tools:[],error:'',startedAt:1,endedAt:2};c.tables.convs.set('c',conv);c.tables.turns.set('t',turn);await c.api.runSync();delete turn.endedAt;turn.answer='正在生成';c.tables.turns.set('t',turn);const writes=s.writes;await c.api.runSync();assert.equal(s.writes,writes);assert.equal(JSON.parse(s.text).records['turn:t'].value.answer,'a');assert.equal(c.tables.turns.get('t').answer,'正在生成')
})
await test('GET或PUT等待发生本机修改保守拒绝，新编辑原样保留',async()=>{
  for(const phase of ['onRead','onWrite']){const s=server(),c=client(s);c.tables.kv.set('note',{k:'note',v:'旧'});s[phase]=async()=>{c.tables.kv.set('note',{k:'note',v:'新编辑'})};await assert.rejects(c.api.runSync(),/新变化/);assert.equal(c.tables.kv.get('note').v,'新编辑');if(phase==='onRead'){assert.equal(c.ls.has('fp.sync.meta.v2'),false);assert.equal(s.writes,0)}}
})
await test('条件冲突重新读取合并，连接切换不保存旧ID或基线',async()=>{
  const s=server(),c=client(s);c.tables.kv.set('local',{k:'local',v:'本机'});let once=true;s.onWrite=async()=>{if(once){once=false;s.text=snapshot({'component:remote':await row('另一设备')});s.etag++}};await c.api.runSync();assert.equal(JSON.parse(s.text).records['component:remote'].value,'另一设备');assert.equal(JSON.parse(s.text).records['component:local'].value,'本机')
  const other=server(),d=client(other);other.onRead=async()=>d.api.writeSyncConfig({...d.api.readSyncConfig(),http:{url:'https://different.invalid',token:'',proxy:''}});await assert.rejects(d.api.runSync(),/设置已改变/);assert.equal(other.writes,0);assert.equal(d.ls.has('fp.sync.meta.v2'),false)
})
await test('push运行时请求full会排队真正拉取，不错误复用push结果',async()=>{
  const s=server(),c=client(s);s.text=snapshot({'component:remote':await row('云端')});let release;const gate=new Promise(resolve=>{release=resolve});s.onRead=async()=>gate;const push=c.api.runSync('push'),full=c.api.runSync('full');release();assert.equal((await push).pulled,0);assert.equal((await full).pulled,1);assert.equal(c.tables.kv.get('remote').v,'云端')
})
await test('无业务变化也执行加密、轮换和移除；错口令零写且原口令不持久化',async()=>{
  const s=server(),c=client(s);c.ls.set('fp.settings','{"name":"A"}');await c.api.runSync();let config=c.api.readSyncConfig();c.api.writeSyncConfig({...config,passphrase:'old-pass'});await c.api.runSync();assert.equal(JSON.parse(s.text).app,'dada-sync-encrypted');const writes=s.writes
  c.api.writeSyncConfig({...config,passphrase:'new-pass'});await assert.rejects(c.api.runSync('full',{decryptPassphrase:'wrong'}),/口令/);assert.equal(s.writes,writes)
  await c.api.runSync('full',{decryptPassphrase:'old-pass'});assert.equal(s.writes,writes+1);assert.ok(!c.ls.get('fp.sync.meta.v2').includes('old-pass'));assert.ok(![...c.ls.values()].some(v=>v.includes('decryptPassphrase')))
  c.api.writeSyncConfig({...config,passphrase:''});await c.api.runSync('full',{decryptPassphrase:'new-pass'});assert.equal(JSON.parse(s.text).app,'dada-sync')
})
await test('全量已知凭据可加密携带，关闭后清整个快照并保留本机连接/授权/凭据',async()=>{
  const s=server(),c=client(s);c.ls.set('fp.settings',JSON.stringify({name:'A',proxy:'local-proxy',monitor:[{token:'monitor-local'}],ai:{model:'model',baseUrl:'local-api',extraBody:'local',apiKey:'secret'}}));c.api.writeSyncConfig({...c.api.readSyncConfig(),secrets:true,passphrase:'pass'});await c.api.runSync();c.api.writeSyncConfig({...c.api.readSyncConfig(),secrets:false});await c.api.runSync();c.api.writeSyncConfig({...c.api.readSyncConfig(),passphrase:''});await c.api.runSync('full',{decryptPassphrase:'pass'});assert.ok(!s.text.includes('"secret"'));assert.ok(!s.text.includes('local-proxy'));assert.ok(!s.text.includes('local-api'));assert.ok(!s.text.includes('monitor-local'));assert.equal(JSON.parse(c.ls.get('fp.settings')).ai.apiKey,'secret')
})
await test('Gist配置范围不读取IDB、不含私有数据，测试连接不创建或保存ID',async()=>{
  const s=server(),c=client(s);c.api.writeSyncConfig({...c.api.readSyncConfig(),backend:'gist',gist:{token:'synthetic',id:''}});c.errors.read=true
  const message=await c.api.testConnection(c.api.readSyncConfig());assert.match(message,/没有验证令牌/);assert.equal(s.requests.length,0);assert.equal(c.api.readSyncConfig().gist.id,'')
  s.fetch=async(url,init={})=>{s.requests.push({url,...init});assert.equal(init.method,'POST');const content=JSON.parse(init.body).files['dada-sync-v2.json'].content;s.text=content;return Response.json({id:'created'})}
  c.ls.set('fp.persona',JSON.stringify({soul:{name:'搭搭',text:'灵魂',aiCanEdit:true,history:[{text:'旧灵魂'}]},profile:{notes:'私人'},memory:{enabled:true,items:[{text:'私密记忆'}]}}));c.ls.set('fp.app.secret',JSON.stringify('私有应用'));c.tables.kv.set('secret',{k:'secret',v:'私有kv'});await c.api.runSync();assert.equal(JSON.parse(s.text).scope,'configuration');assert.ok(!s.text.includes('私人'));assert.ok(!s.text.includes('私密记忆'));assert.ok(!s.text.includes('私有'));assert.equal(c.api.readSyncConfig().gist.id,'created')
})
await test('提交门禁内连接设置不能切换，也不能清掉拉取后的只读提示',async()=>{
  const s=server(),c=client(s);let blocked=0
  c.setOnGet(()=>{assert.throws(()=>c.api.writeSyncConfig({...c.api.readSyncConfig(),http:{url:'https://different.invalid',token:'',proxy:''}}),/恢复/);blocked++})
  await c.api.runSync();assert.equal(c.api.readSyncConfig().http.url,'https://sync.invalid/data');assert.ok(blocked>0)
  s.text=snapshot({'component:remote':await row('云端')});await c.api.runSync();assert.equal(c.status.needsReload,true)
  assert.throws(()=>c.api.writeSyncConfig(c.api.readSyncConfig()),/重新加载/);assert.equal(c.status.needsReload,true)
})
await test('第一次push后full仍以云端同身份为初始基线，包含零版本记录',async()=>{
  const s=server(),c=client(s);s.text=snapshot({'component:same':await row('云端',0,'0')});c.tables.kv.set('same',{k:'same',v:'本机'})
  await c.api.runSync('push');assert.equal(c.tables.kv.get('same').v,'本机');await c.api.runSync('full');assert.equal(c.tables.kv.get('same').v,'云端')
})
await test('相同版本不同内容按SHA256稳定选择，两设备得到相同结果',async()=>{
  const s=server(),a=client(s);a.tables.kv.set('note',{k:'note',v:'本机'});await a.api.runSync();const original=JSON.parse(s.text).records['component:note']
  const other=await row('另一份',original.revision.counter,original.revision.device);s.text=snapshot({'component:note':other});s.etag++
  const winner=original.hash>other.hash?'本机':'另一份';await a.api.runSync();assert.equal(a.tables.kv.get('note').v,winner);assert.equal(JSON.parse(s.text).records['component:note'].value,winner)
  const b=client(s);await b.api.runSync();assert.equal(b.tables.kv.get('note').v,winner)
})
await test('加密信封算法、迭代预算、长度、内层协议都严格校验，测试连接只读',async()=>{
  const s=server(),c=client(s);c.api.writeSyncConfig({...c.api.readSyncConfig(),passphrase:'pass'});await c.api.runSync();const encrypted=JSON.parse(s.text),writes=s.writes
  for(const patch of [{iterations:1},{iterations:999999999},{cipher:'AES-CBC'},{salt:'AAAA'},{iv:'AAAA'},{data:'AAAA'},{version:3},{extra:'unknown'}]){
    s.text=JSON.stringify({...encrypted,...patch});await assert.rejects(c.api.testConnection(c.api.readSyncConfig()));assert.equal(s.writes,writes)
  }
  s.text=snapshot({'config:settings':await row({ai:{apiKey:'leaked'}})});await assert.rejects(c.api.testConnection(c.api.readSyncConfig()),/凭据/);assert.equal(s.writes,writes)
})
await test('跨范围记录、未知配置和非JSON本机值零远端写入',async()=>{
  const s=server(),c=client(s);c.tables.kv.set('bad',{k:'bad',v:new Date()});await assert.rejects(c.api.runSync(),/普通 JSON/);assert.equal(s.requests.length,0)
  c.tables.kv.clear();for(const id of ['config:alwaysAllow','config:sync.config','unknown:value']){s.text=snapshot({[id]:await tombstone()});await assert.rejects(c.api.runSync());assert.equal(s.writes,0)}
  c.api.writeSyncConfig({...c.api.readSyncConfig(),backend:'gist',gist:{token:'synthetic',id:'existing'}})
  const gistSnapshot=JSON.stringify({app:'dada-sync',version:2,scope:'configuration',secrets:false,records:{'component:forbidden':await row('越权')}})
  s.fetch=async()=>Response.json({files:{'dada-sync-v2.json':{content:gistSnapshot}}});await assert.rejects(c.api.runSync());assert.equal(c.log.length,0)
})
await test('损坏本机连接字段不会崩溃设置页，公开配置入口明确拒绝坏shape',async()=>{
  const s=server(),c=client(s),valid=c.api.readSyncConfig()
  for(const bad of [{...valid,http:{...valid.http,url:42}},{...valid,device:[]},{...valid,backend:'unknown'},{...valid,backend:['http']},null]){
    c.ls.set('fp.sync.config',JSON.stringify(bad));assert.equal(c.api.syncConfigured(),false);assert.ok(c.api.syncConfigProblem(bad));assert.throws(()=>c.api.writeSyncConfig(bad),/格式/)
  }
  assert.equal(s.requests.length,0)
})
await test('相同资源轮换凭据或代理保留基线，新目标重新使用远端基线',async()=>{
  const s=server(),c=client(s);c.tables.kv.set('note',{k:'note',v:'首次'});await c.api.runSync();const before=JSON.parse(s.text).records['component:note'].revision.counter
  c.tables.kv.set('note',{k:'note',v:'轮换前新编辑'});c.api.writeSyncConfig({...c.api.readSyncConfig(),http:{url:'https://sync.invalid/data',token:'rotated',proxy:'new-proxy'}});await c.api.runSync();assert.equal(JSON.parse(s.text).records['component:note'].value,'轮换前新编辑');assert.ok(JSON.parse(s.text).records['component:note'].revision.counter>before)
  c.tables.kv.set('note',{k:'note',v:'本机临时'});c.api.writeSyncConfig({...c.api.readSyncConfig(),http:{url:'https://different.invalid/data',token:'',proxy:''}});await c.api.runSync();assert.equal(c.tables.kv.get('note').v,'轮换前新编辑')
})
await test('首次PUT期间的新编辑在拒绝后重试或重新加载均不会被旧采样覆盖',async()=>{
  for(const reload of [false,true]){const s=server();let c=client(s);c.tables.kv.set('note',{k:'note',v:'旧采样'});let once=true;s.onWrite=async()=>{if(once){once=false;c.tables.kv.set('note',{k:'note',v:'PUT期间新编辑'})}};await assert.rejects(c.api.runSync(),/新变化/);if(reload)c=c.reload();await c.api.runSync();assert.equal(c.tables.kv.get('note').v,'PUT期间新编辑');assert.equal(JSON.parse(s.text).records['component:note'].value,'PUT期间新编辑')}
})
await test('首次PUT网络失败的未完成采样不会在重试时误删新数据',async()=>{
  const s=server();let c=client(s);c.tables.kv.set('note',{k:'note',v:'原值'});s.onWrite=async()=>{throw new TypeError('network')};await assert.rejects(c.api.runSync(),/连接失败/);assert.equal(s.text,null);assert.equal(JSON.parse(c.ls.get('fp.sync.meta.v2')).checkpoint,true)
  c=c.reload();s.onWrite=undefined;c.tables.kv.set('note',{k:'note',v:'失败后新编辑'});c.tables.kv.set('new',{k:'new',v:'新增'});await c.api.runSync();assert.equal(JSON.parse(s.text).records['component:note'].value,'失败后新编辑');assert.equal(JSON.parse(s.text).records['component:new'].value,'新增');assert.ok(!Object.values(JSON.parse(s.text).records).some(rec=>rec.deleted))
})
await test('等价HTTP地址或WebDAV目录文件写法保留同一资源基线和未上传编辑',async()=>{
  for(const [backend,first,second] of [['http','https://SYNC.invalid:443/data#settings','https://sync.invalid/data'],['webdav','https://sync.invalid/folder/','https://sync.invalid/folder/dada-sync-v2.json']]){
    const s=server(),c=client(s),config=c.api.readSyncConfig();c.api.writeSyncConfig({...config,backend,[backend]:{...config[backend],url:first}});c.tables.kv.set('note',{k:'note',v:'首次'});await c.api.runSync();const before=JSON.parse(s.text).records['component:note'].revision.counter
    c.tables.kv.set('note',{k:'note',v:'等价地址修改前新编辑'});c.api.writeSyncConfig({...c.api.readSyncConfig(),[backend]:{...c.api.readSyncConfig()[backend],url:second}});await c.api.runSync();assert.equal(c.tables.kv.get('note').v,'等价地址修改前新编辑');assert.equal(JSON.parse(s.text).records['component:note'].value,'等价地址修改前新编辑');assert.ok(JSON.parse(s.text).records['component:note'].revision.counter>before)
  }
})
console.log(`同步协议公开行为 ${count} 项通过`)
