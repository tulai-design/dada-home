import {readStored, writeStored} from './store'

/**
 * 可选的 Umami 访问统计。
 *
 * 配置来源（先到先得）：
 * 1. 运行时：window.__DADA__.umami，由 Docker 镜像启动时按环境变量写进 /config.js；
 * 2. 构建时：VITE_UMAMI_WEBSITE_ID / VITE_UMAMI_SRC / VITE_UMAMI_DOMAINS。
 * 两处都没有就什么都不加载，页面里不会出现任何统计代码。
 *
 * 只统计访问，不上报任何页面内容和本地数据；遵守浏览器的「请勿跟踪」；访客可以在设置里关掉。
 */

export type UmamiConfig = {src: string; websiteId: string; domains?: string}

declare global {
  interface Window {
    __DADA__?: {umami?: Partial<UmamiConfig>}
  }
}

const DEFAULT_SRC = 'https://cloud.umami.is/script.js'
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 读配置并校验；没配或配得不对都返回 null。 */
export function umamiConfig(): UmamiConfig | null {
  const runtime = typeof window !== 'undefined' ? window.__DADA__?.umami : undefined
  const env = import.meta.env
  const websiteId = (runtime?.websiteId ?? env.VITE_UMAMI_WEBSITE_ID ?? '').trim()
  if (!ID.test(websiteId)) return null
  const src = (runtime?.src || env.VITE_UMAMI_SRC || DEFAULT_SRC).trim()
  try {
    const url = new URL(src)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  } catch {
    return null
  }
  const domains = (runtime?.domains ?? env.VITE_UMAMI_DOMAINS ?? '').trim()
  return {src, websiteId, ...(domains ? {domains} : {})}
}

/** 访客有没有在设置里关掉统计。默认开启。 */
export function analyticsEnabled(): boolean {
  return readStored<boolean>('analytics', true) !== false
}

/** 开关统计。Umami 的脚本自己认 localStorage 的 umami.disabled，所以两处一起写。 */
export function setAnalyticsEnabled(on: boolean) {
  writeStored('analytics', on)
  try {
    if (on) localStorage.removeItem('umami.disabled')
    else localStorage.setItem('umami.disabled', '1')
  } catch {
    /* 存储不可用就只靠 fp.analytics */
  }
}

/** 页面加载时调用一次：配置齐全、访客没关，才注入 Umami 脚本。 */
export function initAnalytics() {
  const config = umamiConfig()
  if (!config || !analyticsEnabled() || document.querySelector('script[data-umami]')) return
  const script = document.createElement('script')
  script.defer = true
  script.src = config.src
  script.dataset.websiteId = config.websiteId
  script.dataset.doNotTrack = 'true'
  script.dataset.umami = 'true'
  if (config.domains) script.dataset.domains = config.domains
  document.head.appendChild(script)
}
