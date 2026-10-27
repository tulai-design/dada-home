import {StrictMode, useMemo, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Button, ConfigProvider, Input} from '@lobehub/ui'
import {motion} from 'motion/react'
import {FxLayers} from '../src/fx/Fx'
import {getFx, isBlockFx, isLayerFx} from '../src/fx/catalog'
import {getDefinition, type ComponentHost} from '../src/lib/registry'
import type {ComponentInstance, Page} from '../src/lib/workspace'
import '../src/widgets/fx'
import '@lobehub/ui/theme.css'
import '@lobehub/ui/style.css'
import '../src/styles.css'
import '../src/theme.css'

// Only the real FX registry/render path is imported; all business state stays in memory.
const query = new URLSearchParams(location.search)
const layerMode = query.get('layer') === '1'
const requested = getFx(query.get('effect') ?? (layerMode ? 'waves' : 'shiny-text'))
const initialEffect = requested && (layerMode ? isLayerFx(requested) : isBlockFx(requested)) ? requested.id : layerMode ? 'waves' : 'shiny-text'
const definition = getDefinition('fx')!
const FxBlock = definition.component
const noop = () => undefined
const host: ComponentHost = {
  openPage: noop, openSettings: noop, openMonitor: noop, openAssistant: noop, openArticle: noop,
  readIds: [], markRead: noop, proxy: '', hotSource: '', ask: noop, aiConfigured: false,
  aiModel: '', aiBusy: false, search: noop, networkGrants: [], requestNetworkGrant: async () => false,
  monitor: {online: 0, total: 0, tone: '', items: []},
  profile: {name: '', city: '', lat: 0, lon: 0, showSeconds: false, showFavicons: false},
}
const text = '完整标题\n正文保留'
const updatedTokens = ['--text', '--main', '--bg2']

function BusinessControls() {
  const [draft, setDraft] = useState('')
  const [count, setCount] = useState(0)
  return <div id="business" style={{position: 'relative', zIndex: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '16px 0'}}>
    <Input aria-label="保留输入" value={draft} onChange={(event) => setDraft(event.target.value)} style={{width: 240, maxWidth: '100%'}} />
    <Button id="counter" onClick={() => setCount((value) => value + 1)}>计数 {count}</Button>
  </div>
}

function App() {
  const [effect, setEffect] = useState(initialEffect)
  const [dark, setDark] = useState(false)
  const [branches, setBranches] = useState(false)
  const [width, setWidth] = useState(760)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const def = getFx(effect)!
  const params = useMemo(() => {
    const next: Record<string, unknown> = {palette: 'theme', size: 24, textSize: 24}
    if (query.get('legacy') === '1' && effect === 'waves') {
      delete next.palette
      Object.assign(next, {lineColor: 'rgb(27,23,20)', accentColor: 'rgb(27,23,20)', backgroundColor: '#ffffff', opacity: 1, lineWidth: 4, speed: 0, fade: 0, mouseInteraction: false, clickRipple: false})
    }
    if (effect === 'rotating-text') next.highlight = true
    if (effect === 'spline') next.scene = query.get('scene') ?? ''
    if (branches) {
      const colorKey = def.kind === 'background' || def.kind === 'scene' ? 'textColor' : 'color'
      next.light = {[colorKey]: '#123456', ...(effect === 'glare-hover' ? {background: '#eeeedd'} : {})}
      next.dark = {[colorKey]: '#edcba9', ...(effect === 'glare-hover' ? {background: '#221122'} : {}), ...(def.params.backgroundColor ? {backgroundColor: '#221122'} : {})}
    }
    return next
  }, [effect, def.kind, branches])
  const instance: ComponentInstance = {id: 'fixture-effect', type: 'fx', config: {effect, params, text, height: 260}}
  const page: Page = {
    id: 'fixture-page', name: '主题与恢复', label: '',
    components: layerMode ? [] : [instance],
    ...(layerMode ? {layers: [{effect, params}]} : {}),
  }
  const changeMode = (nextDark: boolean) => {
    for (const key of updatedTokens) document.documentElement.style.removeProperty(key)
    document.documentElement.dataset.theme = nextDark ? 'dark' : 'light'
    setDark(nextDark)
  }
  const recolor = () => {
    document.documentElement.style.setProperty('--text', '#556677')
    document.documentElement.style.setProperty('--main', '#aa3344')
    document.documentElement.style.setProperty('--bg2', '#f0e4d0')
  }
  return <ConfigProvider motion={motion}>
    <main style={{padding: 24, minHeight: '100vh', color: 'var(--text)', background: 'var(--bg)'}}>
      <h1 style={{fontSize: 24}}>特效主题与恢复回归</h1>
      <p>真实特效组件；切换配色、容器或效果后，输入与计数应保留。</p>
      <div id="controls" style={{display: 'flex', flexWrap: 'wrap', gap: 8}}>
        <Button disabled={layerMode} onClick={() => setEffect('shiny-text')}>文字</Button>
        <Button disabled={layerMode} onClick={() => setEffect('glare-hover')}>卡片</Button>
        <Button onClick={() => setEffect('waves')}>背景</Button>
        <Button onClick={() => changeMode(false)} aria-pressed={!dark}>浅色</Button>
        <Button onClick={() => changeMode(true)} aria-pressed={dark}>深色</Button>
        <Button onClick={recolor}>同模式换色</Button>
        <Button id="mode-colors" onClick={() => setBranches((value) => !value)} aria-pressed={branches}>模式配色</Button>
        <Button onClick={() => setWidth(320)}>320px</Button>
        <Button onClick={() => setWidth(760)}>760px</Button>
      </div>
      <div ref={setContainer} id="fixture" data-effect={effect} data-layer={layerMode ? 'true' : 'false'} style={{width, maxWidth: '100%', minHeight: 420, marginTop: 24, position: 'relative', isolation: 'isolate'}}>
        <FxLayers page={page} container={container}>
          <BusinessControls />
          <div id="effect-frame" style={{position: 'relative', zIndex: 1, height: 260}}>
            {layerMode ? <div style={{whiteSpace: 'pre-wrap', fontSize: 24}}>{text}</div> : <FxBlock instance={instance} config={instance.config} updateConfig={noop} host={host} />}
          </div>
        </FxLayers>
      </div>
    </main>
  </ConfigProvider>
}

document.documentElement.dataset.theme = 'light'
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
