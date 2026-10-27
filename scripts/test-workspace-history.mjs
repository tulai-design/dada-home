import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'

// 提取真实 App 的快捷键与命令动作，隔离渲染；不复制一份待测行为。
const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const declarations = new Map()
function visit(node) {
  if (ts.isVariableDeclaration(node)) declarations.set(node.name.getText(ast), node)
  ts.forEachChild(node, visit)
}
visit(ast)
const codeOf = (node) => ts.transpileModule(`const extracted = ${node.getText(ast)}`, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
const compile = (node, scope) => new Function(...Object.keys(scope), `${codeOf(node)}; return extracted`)(...Object.values(scope))
// 历史行为使用真实 workspaceStore，外部只提供初始快照和不读用户数据的存储替身。
function moduleOf(relative, dependencies) {
  const module={exports:{}}
  const js=ts.transpileModule(readFileSync(new URL(relative,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  new Function('module','exports','require','localStorage',js)(module,module.exports,id=>dependencies[id]??{}, {getItem:()=>null,setItem(){}})
  return module.exports
}
const model=moduleOf('../src/lib/workspace.ts',{})
const store=moduleOf('../src/lib/workspaceStore.ts',{
  react:{useCallback:fn=>fn,useSyncExternalStore(){}},
  './workspace':model,
  './ops':{defaultWorkspace:()=>({applications:[{id:'app-demo'}]})},
})
const h={
  edit(next){store.commit({...store.getWorkspace(),applications:next==='installed'?[{id:'app-demo'}]:[]})},
  undo:store.undo,redo:store.redo,
  state(){return {current:store.getWorkspace().applications.length?'installed':'uninstalled',canUndo:store.canUndo(),canRedo:store.canRedo()}},
  available(){return {canUndo:store.canUndo(),canRedo:store.canRedo()}},
}
const unrelated=[]
const onKey=compile(declarations.get('onKey').initializer, {
  undo:()=>h.undo(),redo:()=>h.redo(),setPaletteOpen:()=>unrelated.push('palette'),setAssistantOpen:()=>unrelated.push('assistant'),assistantOpenRef:{current:false},openAssistant:()=>unrelated.push('assistant'),openSettings:()=>unrelated.push('settings'),workspace:{pages:[]},goPage:()=>unrelated.push('page'),setReader:()=>unrelated.push('reader'),
})
function key(options={}) {
  let prevented=false
  const event={key:'z',metaKey:false,ctrlKey:false,shiftKey:false,altKey:false,isComposing:false,target:{tagName:'BODY',isContentEditable:false},preventDefault(){prevented=true},...options}
  onKey(event)
  return prevented
}
let passed=0
function test(name,run){run();passed+=1;console.log(`通过：${name}`)}
test('⌘Z与CtrlZ撤销工作空间，带Shift重做，大小写Z均可',()=>{
  h.edit('uninstalled')
  assert.equal(key({metaKey:true}),true)
  assert.equal(h.state().current,'installed')
  assert.equal(key({metaKey:true,shiftKey:true,key:'Z'}),true)
  assert.equal(h.state().current,'uninstalled')
  assert.equal(key({ctrlKey:true}),true)
  assert.equal(h.state().current,'installed')
  assert.equal(key({ctrlKey:true,shiftKey:true}),true)
  assert.equal(h.state().current,'uninstalled')
})
test('input、textarea与contenteditable内保留浏览器文本撤销，不改工作空间',()=>{
  const before=h.state()
  for(const target of [{tagName:'INPUT'},{tagName:'TEXTAREA'},{tagName:'DIV',isContentEditable:true},{tagName:'SPAN',isContentEditable:true}]) {
    assert.equal(key({metaKey:true,target}),false)
    assert.equal(key({ctrlKey:true,shiftKey:true,target}),false)
    assert.deepEqual(h.state(),before)
  }
})
test('普通Z、Alt组合、输入法组合和不可用历史不执行或吞按键',()=>{
  const before=h.state()
  for(const options of [{},{metaKey:true,altKey:true},{ctrlKey:true,isComposing:true}]) {
    assert.equal(key(options),false)
    assert.deepEqual(h.state(),before)
  }
  assert.equal(key({ctrlKey:true,shiftKey:true}),false,'没有redo历史时不拦截')
  assert.equal(key({ctrlKey:true}),true)
  assert.equal(key({ctrlKey:true}),false,'没有undo历史时不拦截')
  assert.deepEqual(unrelated,[])
})

const paletteBody=declarations.get('paletteActions').initializer.arguments[0]
function commands() {
  const nil=()=>null
  const icons={AppWindow:nil,Undo:nil,Redo:nil,Sparkles:nil,Monitor:nil,LayoutGrid:nil,Settings:nil,Sun:nil,Moon:nil,Palette:nil,Rss:nil}
  return compile(paletteBody,{
    ...icons,workspace:{pages:[],applications:[],theme:{mode:'light',active:'default'},themes:[],addons:[]},applications:[],feeds:[],...h.available(),undo:()=>h.undo(),redo:()=>h.redo(),pageIcon:nil,goPage:nil,openApplication:nil,openAssistant:nil,openMonitor:nil,openMarket:nil,openSettings:nil,isInstalled:()=>false,edit:nil,setMode:nil,applyTheme:nil,
  })()
}
test('命令面板按真实可用性提供撤销与重做，执行动作恢复同一历史状态',()=>{
  let actions=commands()
  assert.ok(!actions.some(a=>a.id==='cmd-undo'))
  assert.equal(actions.find(a=>a.id==='cmd-redo').label,'重做上一步')
  actions.find(a=>a.id==='cmd-redo').run()
  assert.equal(h.state().current,'uninstalled')
  actions=commands()
  assert.ok(!actions.some(a=>a.id==='cmd-redo'))
  assert.equal(actions.find(a=>a.id==='cmd-undo').label,'撤销上一步')
  actions.find(a=>a.id==='cmd-undo').run()
  assert.equal(h.state().current,'installed')
})
console.log(`工作空间撤销入口回归全部通过：${passed}/${passed}`)
