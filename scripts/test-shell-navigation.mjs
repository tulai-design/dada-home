import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import vm from 'node:vm'
const module = {exports: {}}
const source = ts.transpileModule(readFileSync(new URL('../src/lib/shell/navigation.ts', import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
vm.runInThisContext(`(function(module,exports){${source}\n})`)(module,module.exports)
const {projectNavigation,resolveNavigationTarget,navigationKey} = module.exports
const workspace = {pages: [{id:'home',name:'首页',components:[]},{id:'notes',name:'笔记',label:'手记',dock:false,icon:'book',components:[]}],applications:[{id:'notes',dock:true,instance:{title:'便笺'}},{id:'hidden',dock:false,instance:{title:'工具'}}]}
const entries = projectNavigation(workspace,false)
assert.equal(new Set(entries.map(entry=>entry.key)).size,entries.length)
assert.deepEqual(entries.filter(entry=>entry.home).map(entry=>entry.key),['page:home'])
assert.equal(entries.find(entry=>entry.key==='page:notes').pinned,false)
assert.equal(entries.find(entry=>entry.key==='page:notes').label,'手记')
assert.equal(entries.find(entry=>entry.key==='application:notes').pinned,true)
assert.equal(entries.some(entry=>entry.key==='system:monitor'),false)
assert.equal(projectNavigation(workspace,true).some(entry=>entry.key==='system:monitor'),true)
for (const target of [{kind:'page',id:'notes'},{kind:'application',id:'notes',mode:'drawer'},{kind:'system',name:'settings',section:'profile'}]) {
 const result=resolveNavigationTarget(workspace,target,false); assert.equal(result.ok,true); assert.deepEqual(result.target,target); assert.equal(result.entry.key,navigationKey(target))
}
for (const target of [{kind:'page',id:'missing'},{kind:'application',id:'notes',mode:'floating'},{kind:'system',name:'monitor'},{kind:'system',name:'settings',section:' '}]) assert.equal(resolveNavigationTarget(workspace,target,false).ok,false)
assert.equal(resolveNavigationTarget({...workspace,applications:[]},{kind:'application',id:'notes'},true).ok,false)
console.log('通过：统一导航投影、固定入口、跨kind身份、最新目标校验与应用打开方式')
