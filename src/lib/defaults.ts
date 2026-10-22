import type { BookmarkGroup, Feed, Settings, Todo } from './types'
import { DEFAULT_HOT_BOARDS, NEWSHUB_ORIGIN } from './hot'
import { uid } from './store'

export const defaultBookmarks = (): BookmarkGroup[] => [
  {
    id: uid(),
    name: '常用',
    items: [
      { id: uid(), name: 'GitHub', url: 'https://github.com' },
      { id: uid(), name: 'Gmail', url: 'https://mail.google.com' },
      { id: uid(), name: '哔哩哔哩', url: 'https://www.bilibili.com' },
      { id: uid(), name: '知乎', url: 'https://www.zhihu.com' },
      { id: uid(), name: '少数派', url: 'https://sspai.com' },
      { id: uid(), name: 'Vercel', url: 'https://vercel.com/dashboard' },
    ],
  },
  {
    id: uid(),
    name: '开发',
    items: [
      { id: uid(), name: 'MDN', url: 'https://developer.mozilla.org/zh-CN/' },
      { id: uid(), name: 'Can I use', url: 'https://caniuse.com' },
      { id: uid(), name: 'npmmirror', url: 'https://npmmirror.com' },
      { id: uid(), name: 'Hugging Face', url: 'https://huggingface.co' },
      { id: uid(), name: 'Cloudflare', url: 'https://dash.cloudflare.com' },
      { id: uid(), name: 'PyPI', url: 'https://pypi.org' },
    ],
  },
  {
    id: uid(),
    name: '工具',
    items: [
      { id: uid(), name: 'Excalidraw', url: 'https://excalidraw.com' },
      { id: uid(), name: 'Raycast', url: 'https://www.raycast.com' },
      { id: uid(), name: 'TinyPNG', url: 'https://tinypng.com' },
      { id: uid(), name: 'Regex101', url: 'https://regex101.com' },
      { id: uid(), name: 'JSON 格式化', url: 'https://jsonhero.io' },
      { id: uid(), name: 'ITDOG', url: 'https://www.itdog.cn' },
    ],
  },
]

export const defaultFeeds = (): Feed[] => [
  { id: uid(), title: '阮一峰的网络日志', url: 'https://www.ruanyifeng.com/blog/atom.xml', enabled: true },
  { id: uid(), title: '少数派', url: 'https://sspai.com/feed', enabled: true },
  { id: uid(), title: 'Hacker News', url: 'https://hnrss.org/frontpage', enabled: true },
  { id: uid(), title: 'V2EX', url: 'https://www.v2ex.com/index.xml', enabled: false },
]

export const defaultSettings = (): Settings => ({
  name: '朋友',
  city: '郑州',
  lat: 34.7466,
  lon: 113.6254,
  theme: 'light',
  proxy: '/__proxy?url={url}',
  showFavicons: true,
  showSeconds: true,
  wallpaper: 'unsplash',
  wallpaperIndex: 0,
  wallpaperUrl: '',
  ai: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini', temperature: 0.6 },
  monitor: [],
  hotSource: NEWSHUB_ORIGIN,
  hotBoards: [...DEFAULT_HOT_BOARDS],
})

export const defaultTodos = (): Todo[] => []

export const QUOTES = [
  '凡事豫则立，不豫则废。',
  '慢慢来，比较快。',
  '把今天的事做干净。',
  '不怕慢，只怕站。',
  '日拱一卒，功不唐捐。',
  '少即是多，慢即是快。',
  '写下来，就不算丢了。',
  '先做完，再做好。',
  '路虽远，行则将至。',
  '读书百遍，其义自见。',
]

export const SEARCH_ENGINES = [
  { id: 'bing', label: '必应', url: 'https://www.bing.com/search?q=' },
  { id: 'google', label: '谷歌', url: 'https://www.google.com/search?q=' },
  { id: 'baidu', label: '百度', url: 'https://www.baidu.com/s?wd=' },
  { id: 'ddg', label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
] as const
