import type {Page} from '../lib/workspace'
import {WorkspaceError} from '../lib/errors'
import {getFxCapability, type FxMotion} from './capabilities'

export const FX_BUDGET_LIMITS = {totalCost: 8, gpuCount: 1, continuousCount: 3} as const
export const FX_COMPACT_LIMITS = {totalCost: 4, gpuCount: 0, continuousCount: 3} as const
export const FX_COMPACT_WIDTH = 480

export type FxBudget = {totalCost: number; gpuCount: number; continuousCount: number}
export type FxAssessment = FxBudget & {limits: FxBudget; exceeded: boolean; violations: string[]}
export type FxPlanEntry = {key: string; effect: string; mode: 'animated' | 'static'; reason?: string}
type PageEffect = {key: string; effect: string; params: Record<string, unknown>}

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const isOneOf = (value: unknown, options: string[]): boolean => typeof value === 'string' && options.includes(value)
const atZeroAfterClamp = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value) && value <= 0

/** 不导入 catalog/registry 的运行时；迁移后的未知旧效果不参与预算，也不让读取崩溃。 */
function effects(page: Page): PageEffect[] {
  const layers = (page.layers ?? []).map((layer, index) => ({key: `layer:${index}`, effect: layer.effect, params: object(layer.params)}))
  const blocks = page.components.filter((component) => component.type === 'fx').map((component) => {
    const config = object(component.config)
    return {key: `block:${component.id}`, effect: typeof config.effect === 'string' ? config.effect : '', params: object(config.params)}
  })
  return [...layers, ...blocks]
}

function motion(entry: PageEffect): FxMotion | undefined {
  const capability = getFxCapability(entry.effect)
  if (!capability) return undefined
  const p = entry.params
  // 读取旧页时 params 可能尚未规范化：只接受真实布尔/枚举，有限负数按目录下限 0 钳制。
  // 其他非法值沿用 catalog/vendor 默认；不能用 JS truthiness 或 String() 把旧值变成合法参数。
  switch (entry.effect) {
    case 'split-text': case 'blur-text':
      return p.loop === true ? 'continuous' : isOneOf(p.trigger, ['hover', 'click']) ? 'interaction' : 'once'
    case 'decrypted-text':
      return p.loop === true ? 'continuous' : isOneOf(p.animateOn, ['hover', 'click', 'inViewHover']) ? 'interaction' : 'once'
    case 'shiny-text': return p.trigger === 'view' ? 'once' : p.trigger === 'hover' ? 'interaction' : 'continuous'
    case 'spotlight-card': return p.ambient === true ? 'continuous' : 'interaction'
    case 'glare-hover': return isOneOf(p.mode, ['hover', 'follow', 'click']) ? 'interaction' : 'continuous'
    case 'text-type': return p.loop === false ? 'once' : 'continuous'
    case 'noise': return atZeroAfterClamp(p.fps) ? 'once' : 'continuous'
    case 'fuzzy-text': return atZeroAfterClamp(p.baseIntensity) && p.glitchMode !== true && p.trigger !== 'always' ? 'interaction' : 'continuous'
    default: return capability.motion
  }
}

function usage(entry: PageEffect): FxBudget {
  const capability = getFxCapability(entry.effect)
  return {
    totalCost: capability?.cost ?? 0,
    gpuCount: capability && ['webgl', 'external'].includes(capability.renderer) ? 1 : 0,
    continuousCount: motion(entry) === 'continuous' ? 1 : 0,
  }
}

const add = (left: FxBudget, right: FxBudget): FxBudget => ({totalCost: left.totalCost + right.totalCost, gpuCount: left.gpuCount + right.gpuCount, continuousCount: left.continuousCount + right.continuousCount})
const empty = (): FxBudget => ({totalCost: 0, gpuCount: 0, continuousCount: 0})
const dimensions = ['totalCost', 'gpuCount', 'continuousCount'] as const
const labels = {totalCost: '特效成本点数', gpuCount: 'GPU 效果数', continuousCount: '持续动画数'}
const violations = (budget: FxBudget, limits: FxBudget) => dimensions.filter((key) => budget[key] > limits[key]).map((key) => `${labels[key]} ${budget[key]} 超过 ${limits[key]}`)

export function assessPageEffects(page: Page): FxAssessment {
  const budget = effects(page).reduce((sum, entry) => add(sum, usage(entry)), empty())
  const problems = violations(budget, FX_BUDGET_LIMITS)
  return {...budget, limits: {...FX_BUDGET_LIMITS}, exceeded: problems.length > 0, violations: problems}
}

/** 旧页可逐维减负，普通内容修改也可继续；不能用另一维的减少交换超标增长。 */
export function assertFxBudgetChange(previous: Page | undefined, next: Page): void {
  const before = previous ? assessPageEffects(previous) : empty()
  const after = assessPageEffects(next)
  const allowed: FxBudget = {
    totalCost: Math.max(before.totalCost, FX_BUDGET_LIMITS.totalCost),
    gpuCount: Math.max(before.gpuCount, FX_BUDGET_LIMITS.gpuCount),
    continuousCount: Math.max(before.continuousCount, FX_BUDGET_LIMITS.continuousCount),
  }
  const problems = violations(after, allowed)
  if (problems.length) throw new WorkspaceError(`页面「${next.name}」特效超出预算：${problems.join('；')}。图层与特效内容块共同计量，请减少效果或循环动画。旧配置可以保留或逐步减负，不能继续增加已超限的维度。`)
}

export function planPageEffects(page: Page, context: {compact: boolean}): {entries: FxPlanEntry[]; notice: string[]} {
  const limits: FxBudget = context.compact ? FX_COMPACT_LIMITS : FX_BUDGET_LIMITS
  let used = empty()
  const entries = effects(page).map((entry): FxPlanEntry => {
    const capability = getFxCapability(entry.effect)
    let reason: string | undefined
    if (!capability) reason = '效果未注册，保留静态内容'
    else if (context.compact && capability.compact === 'static') reason = `容器小于 ${FX_COMPACT_WIDTH}px，使用静态效果`
    else {
      const proposed = add(used, usage(entry))
      const problems = violations(proposed, limits)
      if (problems.length) reason = `页面运行预算：${problems.join('；')}`
      else used = proposed
    }
    return {key: entry.key, effect: entry.effect, mode: reason ? 'static' : 'animated', ...(reason ? {reason} : {})}
  })
  return {entries, notice: entries.filter((entry) => entry.mode === 'static').map((entry) => `${entry.key}（${entry.effect || '未知效果'}）：${entry.reason}；配置保留`)}
}
