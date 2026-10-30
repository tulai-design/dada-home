import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import ts from 'typescript'
const root=fileURLToPath(new URL('../',import.meta.url)),cache=new Map()
function load(file){file=path.resolve(root,file);if(cache.has(file))return cache.get(file).exports;const module={exports:{}};cache.set(file,module);const js=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('module','exports','require',js)(module,module.exports,id=>{assert.ok(id.startsWith('.'));return load(path.resolve(path.dirname(file),`${id}.ts`))});return module.exports}
const p=load('src/lib/themeAuthoring/previewProtocol.ts')
let count=0
function test(name,fn){fn();count++;console.log(`通过：${name}`)}
const ref={packageId:'qa.local',version:'1.0.0',digest:'a'.repeat(64),resourceId:'font-main',sha256:'b'.repeat(64)}
const request={protocol:p.THEME_PREVIEW_PROTOCOL,type:'resource-request',channel:'channel',draftId:'draft',revision:1,requestId:'render',packageGeneration:3,resourceRequestId:'resource',ref}
test('独立资源请求接受精确依赖且不内联字节',()=>assert.equal(p.isThemePreviewResourceRequest(request),true))
test('资源请求拒绝未知字段、路径、假版本和超限摘要',()=>{for(const patch of [{bytes:new ArrayBuffer(2)},{ref:{...ref,resourceId:'../font'}},{ref:{...ref,version:'latest'}},{ref:{...ref,sha256:'b'.repeat(65)}},{packageGeneration:-1},{packageGeneration:0.1}])assert.equal(p.isThemePreviewResourceRequest({...request,...patch}),false)})
const response={...request,type:'resource-response',bytes:new ArrayBuffer(16)}
test('独立响应接受有限二进制',()=>assert.equal(p.isThemePreviewResourceResponse(response),true))
test('响应必须且只能有bytes或error',()=>{for(const patch of [{bytes:undefined},{bytes:new Uint8Array(2)},{bytes:new ArrayBuffer(2*1024*1024+1)},{error:'bad'}])assert.equal(p.isThemePreviewResourceResponse({...response,...patch}),false);assert.equal(p.isThemePreviewResourceResponse({...request,type:'resource-response',error:'资源已停用'}),true)})
test('同名字体按精确摘要身份授权',()=>{assert.equal(p.sameThemeFontResource(ref,{...ref}),true);assert.equal(p.sameThemeFontResource(ref,{...ref,sha256:'c'.repeat(64)}),false);assert.equal(p.sameThemeFontResource(ref,{...ref,digest:'c'.repeat(64)}),false)})

test('旧pending requestId不能拼接新draft/revision/generation通过会话授权',()=>{assert.equal(p.sameThemePreviewSession(request,{...request}),true);for(const patch of [{draftId:'next'},{revision:2},{packageGeneration:4},{channel:'next'},{requestId:'next'}])assert.equal(p.sameThemePreviewSession({...request,...patch},request),false)})
const bridge=load('src/lib/themeAuthoring/previewBridge.ts')
const listeners=new Set(),sent=[]
const source={postMessage:(message,origin)=>sent.push({message,origin})}
globalThis.window={addEventListener:(type,fn)=>{if(type==='message')listeners.add(fn)},removeEventListener:(type,fn)=>listeners.delete(fn)}
const render={...request,type:'render',theme:{fonts:[{family:'QA Local',resource:ref}]}}
const controller=new AbortController(),client=bridge.connectThemePreviewResources(render,source,'https://qa.invalid',controller.signal)
let done=false
const promise=client.read(ref).then(bytes=>{done=true;return bytes})
const message=sent.at(-1).message
const dispatch=(patch={},extra={})=>{for(const fn of listeners)fn({source,origin:'https://qa.invalid',data:{...message,type:'resource-response',bytes:new ArrayBuffer(16),...patch},...extra})}
for(const patch of [{channel:'wrong'},{revision:2},{packageGeneration:4},{requestId:'wrong'},{resourceRequestId:'wrong'},{ref:{...ref,sha256:'c'.repeat(64)}}])dispatch(patch)
dispatch({}, {source:{}});dispatch({}, {origin:'https://wrong.invalid'});await Promise.resolve();assert.equal(done,false);count++;console.log('通过：真实reader拒绝source/origin/channel/revision/generation/ref伪响应')
dispatch();assert.equal((await promise).byteLength,16);count++;console.log('通过：精确二进制响应才完成当前reader')
await assert.rejects(client.read({...ref,resourceId:'other'}),/声明/);count++
const pending=client.read(ref);controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(listeners.size,0);count++;console.log('通过：停止清理等待与监听，迟到资源不复活')
client.release()
let currentRevision=1,finishRead
const delayed=new Promise(resolve=>{finishRead=resolve}),forwarded=[]
const controllerNext=new AbortController()
const transfer=bridge.readThemePreviewResource(ref,{read:()=>delayed,signal:controllerNext.signal,current:()=>currentRevision===1}).then(bytes=>{if(bytes)forwarded.push(bytes)})
currentRevision=2 // 模拟store已patch、React effect尚未清pending。
finishRead(new ArrayBuffer(16));await transfer;assert.deepEqual(forwarded,[]);count++;console.log('通过：patch即时失效，effect未flush时迟到资源也不转发')
const original=new ArrayBuffer(16),copy=await bridge.readThemePreviewResource(ref,{read:async()=>original,signal:controllerNext.signal,current:()=>true});assert.notEqual(copy,original);assert.equal(copy.byteLength,original.byteLength);count++;console.log('通过：当前会话只转移独立字节副本')
console.log(`包预览资源协议 ${count}/${count} 通过`)
