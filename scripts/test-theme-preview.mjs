import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import ts from 'typescript'

const root=fileURLToPath(new URL('../',import.meta.url)),cache=new Map()
function load(file){
  file=path.resolve(root,file)
  if(cache.has(file))return cache.get(file).exports
  const module={exports:{}};cache.set(file,module)
  const js=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const require=id=>{assert.ok(id.startsWith('.'),`非纯依赖 ${id}`);return load(path.resolve(path.dirname(file),`${id}.ts`))}
  new Function('module','exports','require',js)(module,module.exports,require)
  return module.exports
}
const protocol=load('src/lib/themeAuthoring/previewProtocol.ts'),bridge=load('src/lib/themeAuthoring/previewBridge.ts'),workspace=load('src/lib/workspace.ts')
const request={protocol:protocol.THEME_PREVIEW_PROTOCOL,type:'render',channel:'isolated-channel',draftId:'draft-1',revision:1,requestId:'request-1',theme:structuredClone(workspace.IOS_THEME),mode:'dark',width:390,reducedMotion:true}
let count=0
function test(name,fn){fn();count++;console.log(`通过：${name}`)}
test('全部内置主题经过正式schema才可进入预览',()=>{for(const theme of [workspace.DEFAULT_THEME,workspace.IOS_THEME,workspace.PIXEL_THEME,workspace.SWITCH_THEME,workspace.WIN98_THEME])assert.equal(protocol.isThemePreviewRequest({...request,theme}),true)})
test('不允许通用HTML/CSS/URL字段',()=>{for(const field of ['html','css','url','workspace','apiKey'])assert.equal(protocol.isThemePreviewRequest({...request,[field]:'untrusted'}),false)})
test('拒绝未知主题字段与CSS资源逃逸',()=>{assert.equal(protocol.isThemePreviewRequest({...request,theme:{...request.theme,html:'<script/>'}}),false);assert.equal(protocol.isThemePreviewRequest({...request,theme:{...request.theme,light:{bg:'url(https://example.test)'}}}),false)})
test('拒绝未知视口和模式、数组伪装模式、非正整数版本',()=>{for(const patch of [{width:500},{mode:'auto'},{mode:['dark']},{revision:0},{revision:-1},{revision:1.2},{revision:Infinity},{reducedMotion:'yes'}])assert.equal(protocol.isThemePreviewRequest({...request,...patch}),false)})
test('必需随机通道与请求身份',()=>{for(const patch of [{channel:''},{draftId:''},{requestId:''},{protocol:'other'}])assert.equal(protocol.isThemePreviewRequest({...request,...patch}),false)})
test('按UTF8字节执行64KiB上限，循环对象拒绝',()=>{assert.equal(protocol.themePreviewFitsBudget({text:'中'.repeat(23000)}),false);const circular={};circular.self=circular;assert.equal(protocol.themePreviewFitsBudget(circular),false)})
const report={draftId:'draft-1',revision:1,requestId:'request-1',mode:'dark',width:390,ready:true,resources:[],geometry:{viewport:390,contentWidth:390,overflow:false,sampleCount:4},limits:['对比度和审美：unknown']}
const response={protocol:request.protocol,type:'report',channel:request.channel,draftId:report.draftId,revision:1,requestId:report.requestId,report}
test('只接受完整有限回执',()=>assert.equal(protocol.isThemePreviewResponse(response),true))
test('回执外壳和报告版本/请求必须一致',()=>{for(const patch of [{revision:2},{draftId:'other'},{requestId:'other'}])assert.equal(protocol.isThemePreviewResponse({...response,...patch}),false)})
test('拒绝NaN/无限/负值几何与超范围视口',()=>{for(const geometry of [{...report.geometry,contentWidth:Infinity},{...report.geometry,contentWidth:NaN},{...report.geometry,sampleCount:-1},{...report.geometry,viewport:10000}])assert.equal(protocol.isThemePreviewResponse({...response,report:{...report,geometry}}),false)})
test('资源失败保留family与原因，不假报成功',()=>assert.equal(protocol.isThemePreviewResponse({...response,report:{...report,ready:false,reason:'资源失败',resources:[{family:'Missing Font',status:'error',reason:'404'}]}}),true))
test('报告mode和字体status不能用数组伪装字符串',()=>{assert.equal(protocol.isThemePreviewResponse({...response,report:{...report,mode:['dark']}}),false);assert.equal(protocol.isThemePreviewResponse({...response,report:{...report,resources:[{family:'Test',status:['ready']}]}}),false)})
test('回执不能带未知字段或执行载荷',()=>assert.equal(protocol.isThemePreviewResponse({...response,report:{...report,html:'payload'}}),false))
await assert.rejects(bridge.inspectThemeDraftPreview({draftId:'draft-1',revision:1}),/尚未连接/);count++
const stop=bridge.registerThemePreviewInspector(async()=>report)
assert.deepEqual(await bridge.inspectThemeDraftPreview({draftId:'draft-1',revision:1}),report);count++
const stopNext=bridge.registerThemePreviewInspector(async()=>({...report,ready:false}));stop()
assert.equal((await bridge.inspectThemeDraftPreview({draftId:'draft-1',revision:1})).ready,false);count++
stopNext();await assert.rejects(bridge.inspectThemeDraftPreview({draftId:'draft-1',revision:1}),/尚未连接/);count++
const signal=AbortSignal.abort();await assert.rejects(bridge.inspectThemeDraftPreview({draftId:'draft-1',revision:1,signal}),/已停止/);count++
console.log(`主题预览协议/桥 ${count}/${count} 通过`)
