import type {CSSProperties} from 'react'
import {FX_DEFS, FxError, getFx, isBlockFx, normalizeParams} from '../fx/catalog'
import {FxEffect} from '../fx/Fx'
import {registerComponent, type ComponentProps} from '../lib/registry'

type FxConfig = {
  effect: string
  text: string
  height: number
  params: Record<string, unknown>
}

const FONT = (font: unknown) => `var(--font-${font === 'mono' ? 'mono' : font === 'sans' ? 'sans' : 'serif'})`

/** 排版参数 → 行内样式。文字类效果继承这些样式。 */
function typography(p: Record<string, unknown>): CSSProperties {
  return {
    fontFamily: FONT(p.font),
    fontSize: Number(p.size) || undefined,
    fontWeight: Number(p.weight) || undefined,
    textAlign: (p.align as CSSProperties['textAlign']) ?? 'left',
    color: typeof p.color === 'string' ? p.color : undefined,
  }
}

function FxBlock({config}: ComponentProps<FxConfig>) {
  const def = getFx(config.effect)
  if (!def) return <div className="fx-missing">没有这个效果：{config.effect}</div>
  const params = normalizeParams(def, config.params)

  if (def.kind === 'text') {
    return (
      <div className="fx-text" data-effect={def.id} style={{...typography(params), minHeight: config.height || undefined}}>
        <FxEffect id={def.id} text={config.text} params={params} />
      </div>
    )
  }

  if (def.kind === 'card') {
    return (
      <div className="fx-card" data-effect={def.id} style={{height: config.height || 200}}>
        <FxEffect id={def.id} text={config.text} params={params} />
      </div>
    )
  }

  // 背景 / 3D：作横幅，文字可选叠在上面
  const textColor = typeof params.textColor === 'string' ? params.textColor : undefined
  return (
    <div className="fx-banner" data-effect={def.id} style={{height: config.height || 280}}>
      <div className="fx-fill">
        <FxEffect id={def.id} params={params} />
      </div>
      {config.text && (
        <div className="fx-banner-text" style={{color: textColor, fontSize: Number(params.textSize) || undefined}}>
          {config.text}
        </div>
      )}
    </div>
  )
}

registerComponent<FxConfig>({
  type: 'fx',
  name: '特效块',
  description:
    '素材库里的任意效果作为一个内容块：动态背景横幅、会动的大标题/数字/字幕、聚光卡片、Spline 3D。先用 list_effects 查看可用效果和参数，再用 add_component(type:"fx", config:{effect, text, height, params}) 添加。可以反复叠加多个块来组装炫酷的页面。',
  category: 'content',
  defaultConfig: {effect: 'split-text', text: '', height: 0, params: {}},
  configSchema: {
    // 刻意用 string 而不是 select：select 遇到非法值会静默回落成默认值，
    // 模型就会以为加了 noise，实际得到一个标题。交给 normalize 报明确的错。
    effect: {
      kind: 'string',
      label: `效果 id，取值：${FX_DEFS.filter(isBlockFx).map((def) => def.id).join(' / ')}`,
    },
    text: {kind: 'string', label: '文字（部分效果每行一条；数字类填数字；卡片首行为标题）'},
    height: {kind: 'number', label: '高度 px（0 为自动；横幅默认 280、卡片默认 200）', min: 0, max: 900},
    params: {kind: 'json', label: '效果参数，见 list_effects 里对应效果的 params'},
  },
  defaultSpan: 'full',
  component: FxBlock,
  multiple: true,
  normalize: (config) => {
    const def = getFx(String(config.effect))
    if (!def) throw new FxError(`没有这个效果：${String(config.effect)}。先用 list_effects 查看可用效果。`)
    if (!isBlockFx(def)) throw new FxError(`「${def.name}」是整页叠加层，只能用 set_page_layers 设置，不能当内容块。`)
    const params = normalizeParams(def, config.params)
    if (def.id === 'spline' && !params.scene) {
      throw new FxError('Spline 需要 params.scene：https://prod.spline.design/<id>/scene.splinecode 形式的公开地址')
    }
    // 文字、卡片类没给文字时用一句示例；背景和 3D 横幅默认不带文字
    const text = typeof config.text === 'string' ? config.text : ''
    const needsText = def.kind === 'text' || def.kind === 'card'
    return {...config, params, text: text.trim() || !needsText ? text : '搭一个只属于你的主页'}
  },
})
