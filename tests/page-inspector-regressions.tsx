import {useLayoutEffect, useRef, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Button, ConfigProvider, Input} from '@lobehub/ui'
import {motion} from 'motion/react'
import {inspectPageElement, unavailablePageInspection, type PageInspectionReport} from '../src/lib/pageInspector'
import {createPageInspectionHost} from '../src/lib/pageInspectionHost'
import type {Workspace} from '../src/lib/workspace'
import '@lobehub/ui/theme.css'
import '@lobehub/ui/style.css'
import '../src/styles.css'
import '../src/theme.css'

function assert(condition: unknown, message: string): asserts condition {if (!condition) throw new Error(message)}

/** Every expectation below is measured by the browser's real layout engine. */
async function runDomRegressions() {
  const page = document.createElement('div')
  page.className = 'page'
  page.dataset.pageId = 'regression-page'
  Object.assign(page.style, {position: 'relative', display: 'block', width: '640px', height: '420px', overflow: 'hidden'})
  const widget = document.createElement('div')
  widget.className = 'widget'
  widget.dataset.id = 'layout-widget'
  widget.dataset.type = 'custom:layout'
  Object.assign(widget.style, {width: '900px', height: '80px', overflow: 'visible'})
  page.append(widget)
  document.body.append(page)
  const metadata = {pageId: 'regression-page', pageName: '几何回归', theme: 'dark' as const, reducedMotion: true, revision: 'fixture:1', now: 1234}
  const inspect = () => inspectPageElement(page, metadata)
  try {
    const overflow = inspect()
    assert(overflow.issues.length === 1, '固定宽度溢出应只有一个问题')
    assert(overflow.issues[0].code === 'horizontal-overflow', '固定宽度应报告横向溢出')
    assert(overflow.issues[0].componentId === 'layout-widget' && overflow.issues[0].componentType === 'custom:layout', '问题应归属于组件')
    assert(overflow.issues[0].measurement.overflowPixels === 260, '问题应提供真实超出像素')
    assert(overflow.page.viewport.width === 640 && overflow.page.content.width === 900, '滚动内容宽度不能冒充视口宽度')
    assert(overflow.issues[0].id === inspect().issues[0].id, '同一几何问题的标识应稳定')
    assert(document.querySelector(overflow.issues[0].selector) === widget, '组件选择器应可定位')
    const workspace: Workspace = {version: 5, pages: [{id: 'regression-page', name: '几何回归', components: []}, {id: 'other-page', name: '其他页', components: []}], theme: {active: 'default', mode: 'light', base: 'light'}, themes: [], layout: {columns: 12, maxWidth: 1480}, widgets: [], network: [], statusbar: [], addons: [], templates: []}
    const host = createPageInspectionHost({getWorkspace: () => workspace, getMounted: () => ({root: page, pageId: 'regression-page', workspace, revision: 'render:1'})})
    const hosted = await host({})
    assert(hosted.page.id === 'regression-page' && hosted.settled && hosted.issues.length === 1, '真实宿主默认检查实际挂载页并等待布局')
    assert((await host({pageId: 'regression-page'})).issues[0].id === hosted.issues[0].id, '显式当前页保留同一问题')
    assert((await host({pageId: 'other-page'})).unknown[0].code === 'not-mounted', '其他已知页不可冒充挂载')
    assert((await host({pageId: 'missing-page'})).unknown[0].code === 'unknown-page', '未知页面不可冒充挂载')
    widget.style.maxWidth = '100%'
    assert(inspect().issues.length === 0, '修复max-width后问题应消失')
    assert((await host({})).issues.length === 0, '宿主检查在真实DOM修复后应刷新')
    const unsettled = inspectPageElement(page, metadata, {settled: false})
    assert(unsettled.status === 'unknown' && unsettled.unknown.some((item) => item.code === 'layout-unsettled'), '布局未稳定时数值不能冒充通过')
    widget.style.marginLeft = '-20px'
    assert(inspect().issues[0]?.code === 'component-clipped', '左侧负向裁切应定位组件')
    page.style.setProperty('overflow', 'visible', 'important')
    widget.style.height = '600px'
    assert(!inspect().issues.some((issue) => issue.code === 'component-clipped'), 'overflow visible的页面允许外部滚动，不证明组件被裁切')
    assert(inspect().page.content.height === 600, '滚动内容高度应保留真实高度')
    page.style.setProperty('overflow', 'hidden', 'important')
    assert(inspect().issues.some((issue) => issue.code === 'component-clipped'), '实际hidden边界应报告裁切')
    widget.style.height = '80px'
    widget.style.marginLeft = '0'
    const clippingWrapper = document.createElement('div')
    Object.assign(clippingWrapper.style, {width: '200px', height: '100px', overflow: 'hidden'})
    page.append(clippingWrapper)
    clippingWrapper.append(widget)
    widget.style.maxWidth = 'none'
    widget.style.width = '640px'
    assert(inspect().issues[0]?.code === 'component-clipped', '页面内的实际裁切祖先也应检测')
    clippingWrapper.style.overflow = 'auto'
    assert(inspect().issues.length === 0, '允许滚动的祖先不应误报裁切')
    clippingWrapper.style.width = '640px'
    clippingWrapper.style.height = '600px'
    widget.style.height = '80px'
    assert(inspect().issues.length === 0, '可见80px组件不应继承滚动祖先空白区域的裁切')
    widget.style.height = '600px'
    assert(clippingWrapper.clientHeight === clippingWrapper.scrollHeight, '回归前提：超高滚动容器没有可用纵向滚动范围')
    assert(inspect().issues.some((issue) => issue.code === 'component-clipped' && issue.measurement.clippedY), '滚动容器自身被外层页面裁切时，不能冒充可访问')
    clippingWrapper.style.height = '200px'
    assert(clippingWrapper.scrollHeight > clippingWrapper.clientHeight && inspect().issues.length === 0, '完整位于页面内的局部滚动视口应允许访问全部内容')
    clippingWrapper.scrollTop = 350
    assert(clippingWrapper.scrollTop === 350 && inspect().issues.length === 0, '当前滚动偏移不能让合法可访问内容误报裁切')
    clippingWrapper.scrollTop = 0
    widget.style.height = '80px'
    page.append(widget)
    clippingWrapper.remove()
    widget.style.maxWidth = '100%'
    widget.style.width = '0'
    assert(inspect().issues[0]?.code === 'zero-size', '可见零宽组件应报告结构问题')
    widget.style.width = '100%'
    widget.style.overflow = 'auto'
    const wideContent = document.createElement('div')
    Object.assign(wideContent.style, {width: '1200px', height: '200px'})
    widget.append(wideContent)
    assert(inspect().issues.length === 0, '组件局部横向或纵向滚动不是页面错误')
    widget.style.overflow = 'visible'
    wideContent.className = 'ap-table-wrap'
    Object.assign(wideContent.style, {width: '100%', height: '40px', overflowX: 'auto'})
    const tableRow = document.createElement('div')
    Object.assign(tableRow.style, {width: '1200px', height: '20px'})
    wideContent.append(tableRow)
    assert(inspect().issues.length === 0, '表格的局部滚动不是页面错误')
    wideContent.remove()

    const frame = document.createElement('iframe')
    frame.title = 'opaque'
    frame.setAttribute('sandbox', 'allow-scripts')
    Object.assign(frame.style, {width: '100px', height: '20px', border: '0'})
    const canvas = document.createElement('canvas')
    Object.assign(canvas.style, {width: '100px', height: '20px'})
    const runner = document.createElement('iframe')
    runner.className = 'applet-runner'
    Object.assign(runner.style, {width: '0', height: '0', visibility: 'hidden'})
    const privateInput = document.createElement('input')
    privateInput.value = 'INSPECTOR_PRIVATE_FORM_VALUE'
    const effect = document.createElement('div')
    Object.assign(effect.style, {width: '10px', height: '10px'})
    effect.dataset.fxId = 'aurora'
    effect.dataset.fxState = 'static'
    effect.dataset.fxReason = 'reduced-motion'
    widget.append(frame, canvas, runner, privateInput, effect)
    const opaque = inspect()
    assert(opaque.unknown.filter((item) => item.code === 'iframe-content').length === 1, '可见iframe标记未知，隐藏runner忽略')
    assert(opaque.unknown.filter((item) => item.code === 'canvas-content').length === 1, 'Canvas内容应标记未知')
    assert(opaque.unknown.some((item) => item.code === 'contrast-not-measured'), '对比度不能伪装已测量')
    assert(opaque.unknown.some((item) => item.code === 'appearance-not-evaluated'), '审美不能伪装已验收')
    assert(opaque.effects?.[0].state === 'static' && opaque.effects[0].componentId === 'layout-widget', '特效应仅报告运行时标记')
    assert(!JSON.stringify(opaque).includes(privateInput.value), '报告不得包含表单私密值')
    assert(privateInput.value === 'INSPECTOR_PRIVATE_FORM_VALUE', '检查不得改写表单值')
    assert(opaque.theme === 'dark' && opaque.reducedMotion && opaque.revision === 'fixture:1' && opaque.measuredAt === 1234, '保留实际主题、减少动态和版本信息')
    page.style.display = 'none'
    assert(inspect().status === 'unknown' && inspect().unknown[0].code === 'page-hidden', '隐藏页面应明确未知')
    page.style.display = 'block'
    page.style.height = '0'
    assert(inspect().status === 'unknown' && inspect().unknown[0].code === 'page-no-layout-box', '没有布局盒应明确未知')
    page.style.height = '420px'
    widget.remove()
    assert(inspect().status === 'ok' && inspect().issues.length === 0, '空页面仍能测量容器')
    page.remove()
    assert(inspect().status === 'unavailable' && inspect().unknown[0].code === 'page-not-mounted', '未挂载页面不可测')
    assert(inspectPageElement(null, metadata).status === 'unavailable', '缺少根节点不可测')
    const unavailable = unavailablePageInspection({code: 'host-unavailable', reason: 'fixture'})
    assert(unavailable.theme === null && unavailable.reducedMotion === null, '未测量环境不得编造浅色或关闭减少动态')
    return '通过：真实溢出、修复、负向裁切、零尺寸、合法局部滚动、iframe/Canvas、私密值、特效标记、隐藏/空/未挂载页面'
  } finally {page.remove()}
}

// This fixture uses only in-memory state and registered page-like DOM. No user workspace/storage is loaded.
function App() {
  const [broken, setBroken] = useState(true)
  const [hidden, setHidden] = useState(false)
  const [width, setWidth] = useState(640)
  const [report, setReport] = useState<PageInspectionReport>()
  const [results, setResults] = useState('运行中…')
  const root = useRef<HTMLDivElement>(null)
  const inspect = () => inspectPageElement(root.current, {pageId: 'fixture-page', pageName: '检查器夹具', theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, revision: broken ? 'broken' : 'fixed', now: Date.now()})
  useLayoutEffect(() => {
    try {
      const result = inspect()
      if (broken && result.issues.filter((issue) => issue.componentId === 'wide-widget').length !== 1) throw new Error('宽组件应有一条可定位问题')
      setReport(result)
      void runDomRegressions().then(setResults, (error) => setResults(`失败：${String(error)}`))
    } catch (error) {setResults(`失败：${String(error)}`)}
  }, [])
  return <ConfigProvider motion={motion}><main style={{padding: 24, background: 'var(--bg)', color: 'var(--text)', minHeight: '100vh'}}>
    <h1 style={{fontSize: 24}}>页面检查器回归</h1>
    <p>按真实容器检查尺寸；报告不读取页面正文、聊天和输入值。</p>
    <div style={{display: 'flex', flexWrap: 'wrap', gap: 8}}>
      <Button id="inspect" onClick={() => setReport(inspect())}>检查</Button>
      <Button id="fix" onClick={() => setBroken((value) => !value)}>{broken ? '修复溢出' : '恢复溢出'}</Button>
      <Button id="hidden" onClick={() => setHidden((value) => !value)}>切换隐藏</Button>
      <Button onClick={() => setWidth(320)}>320px</Button><Button onClick={() => setWidth(640)}>640px</Button>
    </div>
    <pre id="results">{results}</pre>
    <div ref={root} id="inspection-page" className="page" data-page-id="fixture-page" style={{display: hidden ? 'none' : 'block', width, maxWidth: '100%', height: 420, overflow: 'hidden', position: 'relative', marginTop: 16}}>
      <div className="page-grid" style={{display: 'block', padding: 0, maxWidth: '100%', height: '100%'}}>
        <div className="widget" data-id="wide-widget" data-type="custom:wide" style={{width: broken ? 900 : '100%', height: 80, overflow: 'visible', background: 'var(--bg2)'}}>布局组件</div>
        <div className="widget" data-id="private-widget" data-type="note" style={{width: '100%', height: 64, overflow: 'hidden'}}><Input aria-label="私密表单" value="INSPECTOR_PRIVATE_FORM_VALUE" readOnly /></div>
        <div className="widget" data-id="table-widget" data-type="applet" style={{width: '100%', height: 80, overflow: 'visible'}}><div className="ap-table-wrap" style={{overflowX: 'auto', width: '100%'}}><div style={{width: 1200, height: 32}}>允许局部横滚的表格</div></div></div>
        <div className="widget" data-id="opaque-widget" data-type="app" style={{width: '100%', height: 100, overflow: 'hidden'}}><iframe title="不可读取的沙盒" sandbox="allow-scripts" srcDoc="<p>INSPECTOR_PRIVATE_FRAME_TEXT</p>" style={{width: '100%', height: 50, border: 0}} /><canvas width={32} height={16} /><iframe title="隐藏runner" className="applet-runner" style={{width: 0, height: 0, visibility: 'hidden'}} /></div>
      </div>
    </div>
    <pre id="report" style={{whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{report ? JSON.stringify(report, null, 2) : ''}</pre>
    <div id="outside-chat" style={{display: 'none'}}>INSPECTOR_PRIVATE_CHAT_TEXT</div>
  </main></ConfigProvider>
}
createRoot(document.getElementById('root')!).render(<App />)
