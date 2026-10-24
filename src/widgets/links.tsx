import {registerComponent, type ComponentProps} from '../lib/registry'
import {hostOf, normalizeUrl} from '../lib/bookmarks'
import {Favicon} from '../components/Favicon'

type LinksConfig = {
  /** 每行一个：名称 网址 */
  links: string
  showFavicons: boolean
}

export const DEFAULT_LINKS = [
  'GitHub https://github.com',
  '哔哩哔哩 https://www.bilibili.com',
  '知乎 https://www.zhihu.com',
  '微博 https://weibo.com',
  '豆瓣 https://www.douban.com',
  '淘宝 https://www.taobao.com',
  'YouTube https://www.youtube.com',
  '少数派 https://sspai.com',
].join('\n')

export type QuickLink = {name: string; href: string}

/** 一行一个，「名称 网址」；只写网址也行，名称取域名。地址不合法的行直接跳过。 */
export function parseLinks(text: string): QuickLink[] {
  const result: QuickLink[] = []
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/).filter(Boolean)
    if (!parts.length) continue
    const last = parts[parts.length - 1]
    const href = normalizeUrl(last)
    if (!href) continue
    const name = parts.length > 1 ? parts.slice(0, -1).join(' ') : hostOf(href)
    result.push({name, href})
  }
  return result.slice(0, 24)
}

function QuickLinks({config, host}: ComponentProps<LinksConfig>) {
  const links = parseLinks(config.links)
  if (!links.length) return null
  return (
    <nav className="quick-links" aria-label="常用网站">
      {links.map((link) => (
        <a key={link.href + link.name} className="quick-link" href={link.href} target="_blank" rel="noreferrer noopener" title={link.href}>
          <span className="quick-icon">
            <Favicon url={link.href} name={link.name} size={22} enabled={config.showFavicons && host.profile.showFavicons} />
          </span>
          <span className="quick-name">{link.name}</span>
        </a>
      ))}
    </nav>
  )
}

registerComponent<LinksConfig>({
  type: 'links',
  name: '常用网站',
  description: '一排常用网站的图标入口，点一下在新标签页打开。内容一行一个，写成「名称 网址」。适合放在首页搜索框下面。',
  category: 'tool',
  defaultConfig: {links: DEFAULT_LINKS, showFavicons: true},
  configSchema: {
    links: {kind: 'string', label: '网站列表', description: '每行一个：名称 网址，例如「GitHub https://github.com」', placeholder: 'GitHub https://github.com'},
    showFavicons: {kind: 'boolean', label: '显示站点图标（关掉则用首字）'},
  },
  defaultSpan: 'full',
  component: QuickLinks,
  multiple: true,
})
