import {Empty} from '@lobehub/ui'
import {MagnifyingGlass} from '@phosphor-icons/react'
import type {ComponentInstance} from '../lib/workspace'
import {parseLinks} from '../widgets/links'
import {clockText, monthDayCn, weekdayCn} from '../lib/date'

/** A configuration-only projection. Never mount a business widget, fetch resources or read private data. */
export function HomepageDraftContent({instance, label, time}: {instance: ComponentInstance; label: string; time: Date}) {
  const config = instance.config
  if (instance.type === 'clock') return <div className="draft-content draft-clock w-clock" data-preview-kind="static">
    <div className="home-clock"><span>{clockText(time, false)}</span>{Boolean(config.showSeconds) && <span className="home-clock-sec">{String(time.getSeconds()).padStart(2, '0')}</span>}</div>
    {config.showGreeting !== false && <p className="home-dateline">{monthDayCn(time)} · {weekdayCn(time)}</p>}
  </div>
  if (instance.type === 'search') return <div className="draft-content hero-search" data-preview-kind="static"><div className="hero-box-wrap"><div className="hero-box draft-search"><MagnifyingGlass size={18} aria-hidden /><span className="hero-input">搜索，或让搭搭动手做点事</span></div></div></div>
  if (instance.type === 'links') {
    const links = parseLinks(typeof config.links === 'string' ? config.links : '')
    return <div className="draft-content quick-links" data-preview-kind="static">{links.length ? links.map((link, index) => <div key={`${link.href}:${index}`} className="quick-link"><span className="quick-icon" aria-hidden><b>{link.name.slice(0, 1)}</b></span><span className="quick-name">{link.name}</span></div>) : <Empty title="没有快捷入口" />}</div>
  }
  if (instance.type === 'fx' && typeof config.text === 'string' && config.text.trim()) return <div className="draft-content draft-effect" data-preview-kind="static"><div>{config.text}</div><small>动态效果未运行</small></div>
  const title = typeof config.heading === 'string' && config.heading.trim() ? config.heading : label
  return <div className="draft-content draft-placeholder" data-preview-kind="placeholder"><h3>{title}</h3><p>{instance.type === 'app' || instance.type === 'applet' ? '应用内容在正式页面运行' : '实时内容在正式页面显示'}</p></div>
}
