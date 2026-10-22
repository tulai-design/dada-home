export const PAGES = [
  { id: 'home', label: '首页' },
  { id: 'feeds', label: '订阅' },
  { id: 'desk', label: '书桌' },
  { id: 'marks', label: '书签' },
  { id: 'hot', label: '热榜' },
] as const

export type PageId = (typeof PAGES)[number]['id']

export const PAGE_IDS = PAGES.map((p) => p.id)

export function isPageId(value: string): value is PageId {
  return PAGE_IDS.includes(value as PageId)
}
