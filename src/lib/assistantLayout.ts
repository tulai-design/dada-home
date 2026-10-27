/** AI 面板的偏好与实际分栏几何。窄屏退回抽屉时仍保留 split 偏好。 */
export type AssistantMode = 'drawer' | 'split' | 'full'

export const DEFAULT_ASSISTANT_RATIO = 0.4
export const MIN_SPLIT_WIDTH = 900
export const SPLIT_SEPARATOR_WIDTH = 8
export const MIN_PAGE_WIDTH = 420
export const MIN_ASSISTANT_WIDTH = 340
export const MAX_ASSISTANT_WIDTH = 800

export function normalizeAssistantMode(value: unknown): AssistantMode {
  return value === 'split' || value === 'full' ? value : 'drawer'
}

export type AssistantSplitGeometry = {
  available: boolean
  width: number
  usable: number
  left: number
  right: number
  ratio: number
  minRatio: number
  maxRatio: number
}

/** ratio 表示右侧 AI 面板占可分配宽度的比例，不含分隔条。 */
export function splitGeometry(rawWidth: number, rawRatio: number = DEFAULT_ASSISTANT_RATIO): AssistantSplitGeometry {
  const width = Number.isFinite(rawWidth) ? Math.max(0, rawWidth) : 0
  const usable = Math.max(0, width - SPLIT_SEPARATOR_WIDTH)
  const preferred = Number.isFinite(rawRatio) ? rawRatio : DEFAULT_ASSISTANT_RATIO
  if (width < MIN_SPLIT_WIDTH) {
    return {available: false, width, usable, left: width, right: 0, ratio: DEFAULT_ASSISTANT_RATIO, minRatio: 0, maxRatio: 0}
  }
  const minRight = MIN_ASSISTANT_WIDTH
  const maxRight = Math.min(MAX_ASSISTANT_WIDTH, usable * 0.7, usable - MIN_PAGE_WIDTH)
  const right = Math.min(maxRight, Math.max(minRight, preferred * usable))
  return {available: true, width, usable, left: usable - right, right, ratio: right / usable, minRatio: minRight / usable, maxRatio: maxRight / usable}
}

/** 鼠标或触摸相对容器左侧的位置，转换为受约束的右栏比例。 */
export function assistantRatioAt(geometry: AssistantSplitGeometry, pointerX: number): number {
  if (!geometry.available || !Number.isFinite(pointerX)) return geometry.ratio
  return splitGeometry(geometry.width, (geometry.width - pointerX - SPLIT_SEPARATOR_WIDTH / 2) / geometry.usable).ratio
}

/** 左右键移动分隔条，Home/End 移到最左/最右；其余按键不接管。 */
export function assistantRatioForKey(geometry: AssistantSplitGeometry, key: string, largeStep = false): number | null {
  if (!geometry.available) return null
  const step = (largeStep ? 64 : 24) / geometry.usable
  if (key === 'Home') return geometry.maxRatio
  if (key === 'End') return geometry.minRatio
  if (key === 'ArrowLeft') return splitGeometry(geometry.width, geometry.ratio + step).ratio
  if (key === 'ArrowRight') return splitGeometry(geometry.width, geometry.ratio - step).ratio
  return null
}
