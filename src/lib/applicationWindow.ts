/** 所有坐标都相对窗口所在容器，不依赖页面或浏览器视口。 */
export type WindowBounds = {width: number; height: number}
export type WindowRect = WindowBounds & {x: number; y: number}

export const APPLICATION_WINDOW_GAP = 16
export const APPLICATION_WINDOW_WIDTH = 800
export const APPLICATION_WINDOW_MAX_HEIGHT = 680
export const APPLICATION_WINDOW_MIN_WIDTH = 320
export const APPLICATION_WINDOW_MIN_HEIGHT = 180

const finite = (value: number | undefined, fallback: number) => Number.isFinite(value) ? value as number : fallback
const positive = (value: number | undefined, fallback: number) => value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback
const limit = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function frame(bounds: WindowBounds) {
  const width = Math.max(0, finite(bounds.width, 0))
  const height = Math.max(0, finite(bounds.height, 0))
  // 极小容器仍留一半区域给窗口，避免固定边距把窗口挤成负尺寸。
  const x = Math.min(APPLICATION_WINDOW_GAP, width / 4)
  const y = Math.min(APPLICATION_WINDOW_GAP, height / 4)
  return {width, height, x, y, innerWidth: Math.max(0, width - x * 2), innerHeight: Math.max(0, height - y * 2)}
}

function fitWindow(bounds: WindowBounds, preferred: Partial<WindowRect>, applyMinimums: boolean): WindowRect {
  const area = frame(bounds)
  const preferredWidth = Math.max(applyMinimums ? APPLICATION_WINDOW_MIN_WIDTH : 0, positive(preferred.width, APPLICATION_WINDOW_WIDTH))
  const preferredHeight = Math.max(applyMinimums ? APPLICATION_WINDOW_MIN_HEIGHT : 0, positive(preferred.height, APPLICATION_WINDOW_MAX_HEIGHT))
  const scale = Math.min(1, area.innerWidth / preferredWidth, Math.min(APPLICATION_WINDOW_MAX_HEIGHT, area.innerHeight) / preferredHeight)
  const width = preferredWidth * scale
  const height = preferredHeight * scale
  const x = limit(finite(preferred.x, (area.width - width) / 2), area.x, area.width - area.x - width)
  const y = limit(finite(preferred.y, (area.height - height) / 2), area.y, area.height - area.y - height)
  return {x, y, width, height}
}

/** 初始化普通窗口。缺少位置时居中；窄容器按相同比例缩小宽高。 */
export function applicationWindowRect(bounds: WindowBounds, preferred: Partial<WindowRect> = {}): WindowRect {
  return fitWindow(bounds, preferred, true)
}

/** 安全夹限，不修改调用方保存的原始尺寸或最大化前位置。 */
export function clampApplicationWindow(bounds: WindowBounds, rect: WindowRect): WindowRect {
  // 容器收窄后可能小于软最小尺寸，后续拖动/ResizeObserver 不应再放大它。
  return fitWindow(bounds, rect, false)
}

/** 拖动使用绝对的容器坐标；异常指针位置沿用原窗口位置。 */
export function moveApplicationWindow(bounds: WindowBounds, rect: WindowRect, position: {x: number; y: number}): WindowRect {
  return clampApplicationWindow(bounds, {...rect, x: finite(position.x, rect.x), y: finite(position.y, rect.y)})
}

export function resizeApplicationWindow(bounds: WindowBounds, rect: WindowRect, size: Partial<WindowBounds>): WindowRect {
  return applicationWindowRect(bounds, {...rect, width: finite(size.width, rect.width), height: finite(size.height, rect.height)})
}

/** 最大化占满容器安全边界，独立于普通窗口的 680px 高度上限。 */
export function maximizeApplicationWindow(bounds: WindowBounds): WindowRect {
  const area = frame(bounds)
  return {x: area.x, y: area.y, width: area.innerWidth, height: area.innerHeight}
}

export function restoreApplicationWindow(bounds: WindowBounds, savedRect: WindowRect): WindowRect {
  return clampApplicationWindow(bounds, savedRect)
}

/** 容器缩放时保留窗口中心的相对位置，尺寸保持比例并完整落在新容器内。 */
export function reflowApplicationWindow(previousBounds: WindowBounds, nextBounds: WindowBounds, rect: WindowRect): WindowRect {
  const before = frame(previousBounds)
  const after = frame(nextBounds)
  const current = clampApplicationWindow(previousBounds, rect)
  const size = clampApplicationWindow(nextBounds, current)
  const centerX = before.width ? limit((current.x + current.width / 2) / before.width, 0, 1) : 0.5
  const centerY = before.height ? limit((current.y + current.height / 2) / before.height, 0, 1) : 0.5
  return clampApplicationWindow(nextBounds, {...size, x: centerX * after.width - size.width / 2, y: centerY * after.height - size.height / 2})
}
