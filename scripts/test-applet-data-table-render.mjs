import assert from 'node:assert/strict'
import {readFileSync, existsSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import ts from 'typescript'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import * as phosphor from '@phosphor-icons/react'
import {ConfigProvider} from '@lobehub/ui'
import {motion} from 'motion/react'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const cache = new Map()
function load(file) {
  if (file.endsWith('.css')) return {}
  if (cache.has(file)) return cache.get(file)
  const module = {exports: {}}
  cache.set(file, module.exports)
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText
  new Function('module', 'exports', 'require', code)(module, module.exports, id => {
    if (id === '@phosphor-icons/react') return phosphor
    if (!id.startsWith('.')) return require(id)
    const absolute = path.resolve(path.dirname(file), id)
    const resolved = [absolute, absolute + '.ts', absolute + '.tsx'].find(existsSync)
    assert.ok(resolved, `找不到模块 ${id}`)
    return load(resolved)
  })
  return module.exports
}
const {UiTree} = load(path.join(root, 'src/lib/applet/render.tsx'))
const render = (type, props, children = []) => renderToStaticMarkup(React.createElement(ConfigProvider, {motion}, React.createElement(UiTree, {node: {t: type, p: props, c: children}, fire() {throw Error('渲染不应调用业务事件')}})))
let passed = 0
function test(name, run) {run();passed++;console.log(`通过：${name}`)}

const columns = [{key:'name',label:'项目',priority:1},{key:'amount',label:'金额',type:'number'},{key:'note',label:'备注',priority:3}]
const rows = [{id:'tea',values:{name:'茶',amount:0,note:'完整备注'}},{id:'book',values:{name:'书',amount:-5,note:null}}]
const base = {title:'开销记录',columns,rows,state:{},onChange:{$fn:1},selectable:true}

test('UiTree接通DataTable并提供语义表格和有名称的交互',()=>{
 const html=render('DataTable',base)
 assert.ok(!html.includes('不支持的积木'))
 assert.match(html,/<table/)
 assert.match(html,/搜索记录/)
 assert.match(html,/排序字段/)
 assert.match(html,/原顺序/)
 assert.match(html,/全选当前页/)
 assert.match(html,/选择 茶/)
 assert.match(html,/查看 茶 的详情/)
 assert.match(html,/上一页/)
 assert.match(html,/下一页/)
})

test('受控搜索和分页实际限制可见行，选择保留稳定ID',()=>{
 const filtered=render('DataTable',{...base,state:{query:'完整备注',selectedIds:['book']}})
 assert.match(filtered,/data-row-id="tea"/)
 assert.ok(!filtered.includes('data-row-id="book"'))
 assert.match(filtered,/1 条匹配 · 共 2 条/)
 assert.match(filtered,/已选 1 条/)
 const many=Array.from({length:12},(_,i)=>({id:`record-${i}`,values:{name:`记录${i}`,amount:12-i,note:null}}))
 const paged=render('DataTable',{...base,rows:many,state:{sort:{key:'amount',direction:'asc'},page:1,pageSize:5}})
 assert.deepEqual([...paged.matchAll(/data-row-id="([^"]+)"/g)].map(match=>match[1]),['record-6','record-5','record-4','record-3','record-2'])
 assert.match(paged,/第 2 \/ 3 页/)
 assert.match(paged,/升序/)
})

test('空数据与无匹配分别呈现，查询入口仍可恢复',()=>{
 const empty=render('DataTable',{...base,rows:[]})
 assert.match(empty,/暂无记录/)
 assert.match(empty,/搜索记录/)
 assert.match(empty,/第 1 \/ 1 页/)
 const unmatched=render('DataTable',{...base,state:{query:'不在记录里'}})
 assert.match(unmatched,/没有匹配的记录/)
 assert.match(unmatched,/清空搜索/)
 assert.match(unmatched,/0 条匹配 · 共 2 条/)
})

test('零、负数、false与null按公开显示规则保留，文本作为文本转义',()=>{
 const html=render('DataTable',{columns:[{key:'value',label:'值'}],rows:[0,-5,false,null,'<img src=x onerror=alert(1)>'].map((value,i)=>({id:String(i),values:{value}})),state:{},onChange:{$fn:2}})
 assert.match(html,/>0<\/span>/)
 assert.match(html,/>-5<\/span>/)
 assert.match(html,/>否<\/span>/)
 assert.match(html,/>—<\/span>/)
 assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/)
 assert.ok(!html.includes('<img src="x"'))
})

test('任意合法JSON行ID（包括孤立代理项）不会使详情关联抛错',()=>{
 const html=render('DataTable',{...base,rows:[{...rows[0],id:'\ud800'}]})
 assert.match(html,/查看 茶 的详情/)
 assert.match(html,/aria-controls="[^"]+-detail-d800"/)
})

test('非法输入和缺失handler局部报错，不影响兄弟积木',()=>{
 for(const props of [{}, {...base,onChange:undefined}, {...base,rows:[...rows,rows[0]]}, {...base,rows:Array.from({length:501},(_,i)=>({id:String(i),values:{name:'多',amount:i,note:null}}))}]){
  const html=render('DataTable',props)
  assert.match(html,/role="alert"/)
  assert.ok(!html.includes('<table'))
 }
 const sibling=render('Stack',{},[{t:'Text',p:{text:'同一应用的其他内容'},c:[]},{t:'DataTable',p:{},c:[]}])
 assert.match(sibling,/同一应用的其他内容/)
 assert.match(sibling,/role="alert"/)
})

test('既有简单Table保留原始行列与局部横滚结构',()=>{
 const html=render('Table',{columns:['项目','数量'],rows:[['茶',0],['书',3]]})
 assert.match(html,/class="ap-table-wrap"/)
 assert.match(html,/min-width:192px/)
 assert.match(html,/<th>项目<\/th>/)
 assert.match(html,/<td>0<\/td>/)
 assert.match(html,/<td>3<\/td>/)
 assert.ok(!html.includes('搜索记录'))
})
console.log(`Applet数据表宿主渲染回归：${passed}/${passed}`)
