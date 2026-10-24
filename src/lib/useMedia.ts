import {useSyncExternalStore} from 'react'

/** 订阅一个媒体查询。 */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', notify)
      return () => mql.removeEventListener('change', notify)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** 手机宽度。CSS 里的断点也是 760px，两边要一致。 */
export const MOBILE_QUERY = '(max-width: 760px)'
export const useIsMobile = () => useMedia(MOBILE_QUERY)
