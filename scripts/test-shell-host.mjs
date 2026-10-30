import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import vm from 'node:vm'
const module = {exports: {}}
const source = ts.transpileModule(readFileSync(new URL('../src/components/shell/registry.ts', import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
vm.runInThisContext(`(function(module,exports){${source}\n})`)(module,module.exports)
const {createShellRegistry,validateShellPresentation,validateShellCapabilities,equalPresentation}=module.exports
const adapter={id:'fourth',capabilities:{settings:{header:'wide',avatar:true},navigation:'launcher'},Chrome:()=>null}
assert.equal(createShellRegistry([adapter]).get('fourth'),adapter)
assert.throws(()=>createShellRegistry([adapter,adapter]),/重复/)
assert.throws(()=>createShellRegistry([{...adapter,capabilities:{settings:{header:'wild',avatar:true},navigation:'launcher'}}]),/合同/)
assert.equal(validateShellCapabilities({settings:{header:'sidebar',avatar:false},navigation:'dock'}),true)
const layout={content:'visible',maximized:false,reserves:{top:20,right:10,bottom:40,left:10},backdrop:'page'}
assert.equal(validateShellPresentation(layout),true)
for(const patch of [{content:'other'},{maximized:'yes'},{reserves:{...layout.reserves,top:NaN}},{reserves:{...layout.reserves,left:-1}},{reserves:{...layout.reserves,bottom:Infinity}}]) assert.equal(validateShellPresentation({...layout,...patch}),false)
assert.equal(equalPresentation(layout,structuredClone(layout)),true)
assert.equal(equalPresentation(layout,{...layout,content:'minimized'}),false)
console.log('通过：可信Adapter注册、重复身份拒绝、能力和有限布局验证/去重')
