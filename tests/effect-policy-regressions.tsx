import {StrictMode, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Button, ConfigProvider, Input} from '@lobehub/ui'
import {motion} from 'motion/react'
import {FxEffect, FxLayers} from '../src/fx/Fx'
import type {Page} from '../src/lib/workspace'
import '@lobehub/ui/theme.css'
import '@lobehub/ui/style.css'
import '../src/styles.css'
import '../src/theme.css'

// Isolated memory fixture; it never imports workspace persistence or user data.
const base: Page = {id: 'test', name: '测试页面', label: '', components: [
  {id: 'text', type: 'fx', config: {effect: 'text-type', text: '完整标题\n第二行内容'}},
  {id: 'extra', type: 'fx', config: {effect: 'aurora'}},
], layers: [{effect: 'waves'}, {effect: 'noise'}, {effect: 'click-spark'}]}

const semanticPage: Page = {id: 'semantic', name: '静态正文', label: '', components: [
  {id: 'number', type: 'fx', config: {effect: 'count-up'}},
  {id: 'prefix', type: 'fx', config: {effect: 'text-type'}},
  {id: 'unknown', type: 'fx', config: {effect: 'retired-effect'}},
  {id: 'half', type: 'fx', config: {effect: 'waves'}},
  {id: 'card', type: 'fx', config: {effect: 'spotlight-card'}},
]}

function Semantics() {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  return <section ref={setContainer} id="semantics" style={{width: 760, maxWidth: '100%', minHeight: 480, position: 'relative', marginTop: 24}}>
    <FxLayers page={semanticPage} container={container}>
      <FxEffect id="count-up" text="¥128元" params={{prefix: '¥', suffix: '元'}} effectKey="block:number" />
      <FxEffect id="text-type" text={'第一行\n第二行'} params={{prefix: '标题：'}} effectKey="block:prefix" />
      <FxEffect id="retired-effect" text="旧效果的正文不能丢失" effectKey="block:unknown" />
      <div style={{width: 320, maxWidth: '100%', height: 100}}><FxEffect id="waves" effectKey="block:half" /></div>
      <div style={{height: 160}}><FxEffect id="spotlight-card" text={'卡片标题\n卡片正文'} effectKey="block:card" /></div>
    </FxLayers>
  </section>
}

function Content() {
  const [count, setCount] = useState(0)
  const [draft, setDraft] = useState('')
  return <section style={{position: 'relative', zIndex: 1, padding: 24}}>
    <div className="fx-text" style={{fontSize: 24, minHeight: 100}}><FxEffect id="text-type" text={'完整标题\n第二行内容'} effectKey="block:text" /></div>
    <Input aria-label="保留输入" value={draft} onChange={(e) => setDraft(e.target.value)} />
    <Button id="counter" onClick={() => setCount(count + 1)}>计数 {count}</Button>
    <div id="extra" style={{height: 100}}><FxEffect id="aurora" effectKey="block:extra" /></div>
  </section>
}
function App() {
  const [width, setWidth] = useState(760)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [spark, setSpark] = useState(true)
  const [offscreen, setOffscreen] = useState(false)
  const [dark, setDark] = useState(false)
  const page = {...base, layers: spark ? base.layers : base.layers?.slice(0, 2)}
  return <ConfigProvider motion={motion} themeMode={dark ? 'dark' : 'light'}><main style={{padding: 24, background: 'var(--bg)', color: 'var(--text)', minHeight: '100vh'}}>
    <h1 style={{fontSize: 24}}>特效策略回归</h1>
    <p>真实 Waves / Noise / TextType；额外 Aurora 是保留的旧超预算配置。调整容器与系统动画偏好，业务输入应保留。</p>
    <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
      {[320, 390, 760].map(value => <Button key={value} onClick={() => setWidth(value)}>{value}px</Button>)}
      <Button id="toggle-spark" onClick={() => setSpark(!spark)}>切换火花图层</Button>
      <Button id="toggle-offscreen" onClick={() => setOffscreen(!offscreen)}>切换离屏</Button>
      <Button id="toggle-theme" onClick={() => {document.documentElement.dataset.theme = dark ? 'light' : 'dark'; setDark(!dark)}}>切换明暗</Button>
    </div>
    <div ref={setContainer} id="fixture" style={{width, maxWidth: '100%', height: 480, marginTop: offscreen ? 2000 : 24, position: 'relative', isolation: 'isolate'}}>
      <FxLayers page={page} container={container}><Content /></FxLayers>
    </div>
    <Semantics />
  </main></ConfigProvider>
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
