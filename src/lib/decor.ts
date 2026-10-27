import {DEFAULT_HOME_LAYERS, type Layer, type Page, type Workspace} from './workspace'
import {setLayers} from './ops'

/**
 * 首页装饰：给首页铺一层 React Bits 的动态背景。
 * 这里只是几组调好的预设；想要别的效果（包括 Spline 3D），对搭搭说就行，
 * 它用的是同一套页面图层（set_page_layers）。
 */
export type Decor = {id: string; name: string; hint: string; layer: Layer | null}

export const DECORS: Decor[] = [
  {id: 'none', name: '无', hint: '干净的纸面', layer: null},
  {id: 'waves', name: '波纹线', hint: '像等高线，细而安静', layer: DEFAULT_HOME_LAYERS[0]},
  {id: 'threads', name: '丝线', hint: '发丝般缠绕的细线，带一点主色', layer: {effect: 'threads', params: {opacity: 0.7, fade: 0.5, lineCount: 50, speed: 0.6}}},
  {id: 'dots', name: '点阵', hint: '方格纸，鼠标靠近时圆点被推开', layer: {effect: 'dot-grid', params: {opacity: 0.8, fade: 0.55, gap: 24, dotSize: 3}}},
  {id: 'aurora', name: '极光', hint: '柔和流动的色带', layer: {effect: 'aurora', params: {opacity: 0.4, amplitude: 0.8, speed: 0.6}}},
  {id: 'orb', name: '光球', hint: '一个会呼吸的发光球体', layer: {effect: 'orb', params: {opacity: 0.55}}},
]

export const homePage = (workspace: Workspace): Page | undefined => workspace.pages.find((page) => page.id === 'home') ?? workspace.pages[0]

/** 当前首页用的是哪一套；不是这里的预设（比如搭搭做的自定义图层）就返回 'custom'。 */
export function currentDecor(workspace: Workspace): string {
  const layers = homePage(workspace)?.layers ?? []
  if (!layers.length) return 'none'
  const hit = DECORS.find((decor) => decor.layer && layers.length === 1 && decor.layer.effect === layers[0].effect)
  return hit ? hit.id : 'custom'
}

export function applyDecor(workspace: Workspace, id: string): Workspace {
  const page = homePage(workspace)
  const decor = DECORS.find((item) => item.id === id)
  if (!page || !decor) return workspace
  return setLayers(workspace, page.id, decor.layer ? [decor.layer] : [])
}
