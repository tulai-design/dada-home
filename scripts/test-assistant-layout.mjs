import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'

const module = {exports: {}}
const source=readFileSync(new URL('../src/lib/assistantLayout.ts',import.meta.url),'utf8')
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
new Function('module','exports',code)(module,module.exports)
const {normalizeAssistantMode,splitGeometry,assistantRatioAt,assistantRatioForKey,MIN_SPLIT_WIDTH,MIN_PAGE_WIDTH,MIN_ASSISTANT_WIDTH,MAX_ASSISTANT_WIDTH,SPLIT_SEPARATOR_WIDTH}=module.exports
let passed=0
function test(name,run){run();passed+=1;console.log(`通过：${name}`)}
test('读取旧偏好仍兼容抽屉和全屏，新增split，坏值安全回落',()=>{
  for(const mode of ['drawer','split','full'])assert.equal(normalizeAssistantMode(mode),mode)
  for(const value of [undefined,null,{},'side',false])assert.equal(normalizeAssistantMode(value),'drawer')
})
test('900px以下不启用双栏，各种无效宽度保持有限非负几何',()=>{
  for(const width of [0,320,390,899,NaN,Infinity,-300]){
    const geometry=splitGeometry(width,.4)
    assert.equal(geometry.available,false)
    assert.equal(geometry.right,0)
    for(const value of Object.values(geometry).filter(value=>typeof value==='number'))assert.ok(Number.isFinite(value)&&value>=0)
  }
  assert.equal(splitGeometry(MIN_SPLIT_WIDTH,.4).available,true)
})
test('所有宽度与偏好下左右最小值、右侧上限和总宽保持约束',()=>{
  for(const width of [900,960,1024,1280,1440,2400,8000])for(const ratio of [-3,0,.1,.4,.7,1,3,NaN]){
    const g=splitGeometry(width,ratio)
    assert.ok(g.available)
    assert.ok(g.left>=MIN_PAGE_WIDTH-1e-6)
    assert.ok(g.right>=MIN_ASSISTANT_WIDTH-1e-6)
    assert.ok(g.right<=MAX_ASSISTANT_WIDTH+1e-6)
    assert.ok(g.right<=g.usable*.7+1e-6)
    assert.ok(Math.abs(g.left+g.right+SPLIT_SEPARATOR_WIDTH-width)<1e-6)
    assert.ok(g.ratio>=g.minRatio&&g.ratio<=g.maxRatio)
  }
})
test('基于实际容器坐标拖拽，越界夹限，非有效坐标不改值',()=>{
  const g=splitGeometry(1280,.4)
  assert.equal(assistantRatioAt(g,0),g.maxRatio)
  assert.equal(assistantRatioAt(g,1280),g.minRatio)
  assert.equal(assistantRatioAt(g,NaN),g.ratio)
  const position=g.left+SPLIT_SEPARATOR_WIDTH/2
  assert.ok(Math.abs(assistantRatioAt(g,position)-g.ratio)<1e-6)
  assert.equal(assistantRatioAt(splitGeometry(700,.4),300),.4)
})
test('左右键按物理方向移动分隔条，Home/End到边界，非布局键不接管',()=>{
  const g=splitGeometry(1280,.4)
  assert.ok(assistantRatioForKey(g,'ArrowLeft')>g.ratio)
  assert.ok(assistantRatioForKey(g,'ArrowRight')<g.ratio)
  assert.ok(assistantRatioForKey(g,'ArrowLeft',true)>assistantRatioForKey(g,'ArrowLeft'))
  assert.equal(assistantRatioForKey(g,'Home'),g.maxRatio)
  assert.equal(assistantRatioForKey(g,'End'),g.minRatio)
  assert.equal(assistantRatioForKey(g,'Enter'),null)
  assert.equal(assistantRatioForKey(splitGeometry(800,.4),'ArrowLeft'),null)
})
test('收窄只约束显示宽度，不修改偏好，再拉宽仍能恢复原比例',()=>{
  const preferred=.55
  const wide=splitGeometry(1440,preferred)
  const narrow=splitGeometry(900,preferred)
  assert.ok(narrow.ratio<preferred)
  assert.equal(splitGeometry(1440,preferred).ratio,wide.ratio)
  assert.equal(splitGeometry(800,preferred).available,false)
  assert.equal(splitGeometry(1440,preferred).ratio,preferred)
})
console.log(`AI双栏几何回归全部通过：${passed}/${passed}`)
