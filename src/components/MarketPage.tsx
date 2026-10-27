import { useState } from 'react'
import { Input, Modal, Text, toast } from '@lobehub/ui'
import {AppWindow, ArrowUpRight, Gear, MagnifyingGlass, Trash as Trash2} from '@phosphor-icons/react'
import { ADDONS, isInstalled, type Addon } from '../lib/market'
import { installAddon, uninstallAddon } from '../lib/ops'
import {listApplications, removeApplication} from '../lib/applications'
import type { ApplicationOpenMode, Workspace } from '../lib/workspace'
import { SysPage } from './SysPage'

/**
 * 组件市场。
 * 热榜、订阅、书桌、书签、监控这些预制功能都收在这里，默认不展示：
 * 手动装，或者对搭搭说「帮我装个热榜」。
 */
export function MarketPage({
  workspace,
  edit,
  onOpenPage,
  onOpenMonitor,
  onOpenApplication,
  onOpenSettings,
}: {
  workspace: Workspace
  edit: (fn: (workspace: Workspace) => Workspace) => void
  onOpenPage: (id: string) => void
  onOpenMonitor: () => void
  onOpenApplication: (id: string, mode?: ApplicationOpenMode) => void
  onOpenSettings: (section?: string) => void
}) {
  const [pending, setPending] = useState<Addon | null>(null)
  const [pendingApplication, setPendingApplication] = useState<string | null>(null)
  const [group, setGroup] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const applications = listApplications(workspace)
  const [tab, setTab] = useState<'applications' | 'components'>(() => applications.length ? 'applications' : 'components')
  const groups = [...new Set(applications.map((app) => app.group || ''))].sort((a, b) => a ? b ? a.localeCompare(b, 'zh-CN') : -1 : 1)
  const currentGroup = group !== null && groups.includes(group) ? group : null
  const needle = query.trim().toLocaleLowerCase()
  const filtered = applications.filter((app) => (currentGroup === null || (app.group || '') === currentGroup) && (!needle || `${app.instance.title ?? ''} ${app.description} ${app.group ?? ''}`.toLocaleLowerCase().includes(needle)))
  const components = ADDONS.filter((addon) => !needle || `${addon.name} ${addon.tagline} ${addon.description}`.toLocaleLowerCase().includes(needle))
  const uninstalling = applications.find((app) => app.id === pendingApplication)
  const change = (fn: (workspace: Workspace) => Workspace) => {
    try { edit(fn) } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
  }

  const open = (addon: Addon) => {
    if (addon.page) onOpenPage(addon.page.id)
    else if (addon.rail === 'monitor') onOpenMonitor()
  }

  return (
    <div className="application-catalog"><SysPage title="组件市场" extra={<Input aria-label="搜索应用和组件" className="catalog-search" placeholder="搜索" prefix={<MagnifyingGlass size={16} />} value={query} onValueChange={setQuery} allowClear />}>
      <div className="catalog-tabs" role="tablist" aria-label="组件市场分类" onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return
        event.preventDefault()
        const next = event.key === 'Home' ? 'applications' : event.key === 'End' ? 'components' : tab === 'applications' ? 'components' : 'applications'
        setTab(next)
        event.currentTarget.querySelector<HTMLButtonElement>(`#catalog-tab-${next}`)?.focus()
      }}>
        <button id="catalog-tab-applications" role="tab" aria-selected={tab === 'applications'} aria-controls="catalog-applications" tabIndex={tab === 'applications' ? 0 : -1} onClick={() => setTab('applications')}>我的应用 <span>{applications.length}</span></button>
        <button id="catalog-tab-components" role="tab" aria-selected={tab === 'components'} aria-controls="catalog-components" tabIndex={tab === 'components' ? 0 : -1} onClick={() => setTab('components')}>内置组件 <span>{ADDONS.length}</span></button>
      </div>

      <section id="catalog-applications" role="tabpanel" aria-labelledby="catalog-tab-applications" hidden={tab !== 'applications'}>
        {applications.length > 0 && (groups.length > 1 || groups.some(Boolean)) && <div className="catalog-groups" aria-label="应用分组">
          <button aria-pressed={currentGroup === null} onClick={() => setGroup(null)}>全部</button>
          {groups.map((name) => <button key={name} aria-pressed={currentGroup === name} onClick={() => setGroup(name)}>{name || '未分组'}<span>{applications.filter((app) => (app.group || '') === name).length}</span></button>)}
        </div>}

        {applications.length === 0 ? <div className="catalog-empty"><p>还没有应用</p><span>让搭搭帮你制作一个。</span></div> : filtered.length === 0 ? <div className="catalog-empty"><p>没有找到应用</p></div> : <div className="catalog-list">
          {filtered.map((app) => {
            const name = app.instance.title || '未命名应用'
            return <article key={app.id} className="catalog-row" aria-label={name}>
              <span className="catalog-icon" aria-hidden><AppWindow size={22} weight="duotone" /></span>
              <div className="catalog-copy">
                <h3><button onClick={() => onOpenApplication(app.id)}>{name}</button></h3>
                {app.description && <p>{app.description}</p>}
              </div>
              <div className="catalog-actions">
                <button className="catalog-open" aria-label={`打开${name}`} onClick={() => onOpenApplication(app.id)}>打开<ArrowUpRight size={14} /></button>
                <button className="catalog-icon-action" aria-label={`设置${name}`} title="设置" onClick={() => onOpenSettings(`application:${app.id}`)}><Gear size={17} /></button>
                <button className="catalog-icon-action" data-danger aria-label={`卸载${name}`} title="卸载" onClick={() => setPendingApplication(app.id)}><Trash2 size={17} /></button>
              </div>
            </article>
          })}
        </div>}
      </section>

      <section id="catalog-components" role="tabpanel" aria-labelledby="catalog-tab-components" hidden={tab !== 'components'}>
      {components.length === 0 ? <div className="catalog-empty"><p>没有找到组件</p></div> : <div className="catalog-list">
        {components.map((addon) => {
          const on = isInstalled(workspace, addon.id)
          const Icon = addon.icon
          return (
            <article key={addon.id} className="catalog-row" aria-label={addon.name}>
              <span className="catalog-icon" style={{color: addon.color}}><Icon size={22} weight="duotone" /></span>
              <div className="catalog-copy">
                <h3>{addon.name}</h3>
                <p>{addon.tagline}</p>
              </div>
              <div className="catalog-actions">
                {on ? (
                  <>
                    <button className="catalog-open" aria-label={`打开${addon.name}`} onClick={() => open(addon)}>打开<ArrowUpRight size={14} /></button>
                    {addon.settingsId && <button className="catalog-icon-action" aria-label={`设置${addon.name}`} title="设置" onClick={() => onOpenSettings(addon.settingsId)}><Gear size={17} /></button>}
                    <button className="catalog-icon-action" data-danger aria-label={`卸载${addon.name}`} title="卸载" onClick={() => setPending(addon)}><Trash2 size={17} /></button>
                  </>
                ) : (
                  <button
                    className="catalog-open"
                    aria-label={`安装${addon.name}`}
                    onClick={() => change((ws) => installAddon(ws, addon.id).workspace)}
                  >
                    安装
                  </button>
                )}
              </div>
            </article>
          )
        })}
      </div>}
      </section>

      <Modal
        open={Boolean(pending)}
        title={`卸载「${pending?.name ?? ''}」`}
        onCancel={() => setPending(null)}
        okText="卸载"
        cancelText="取消"
        onOk={() => {
          if (pending) {
            const target = pending
            change((ws) => uninstallAddon(ws, target.id).workspace)
          }
          setPending(null)
        }}
      >
        <Text>
          页面和状态条上的「{pending?.name}」会被移除{pending?.page ? '，它的页面也会一并删掉' : ''}。组件保存的数据仍留在本机。可以用撤销找回。
        </Text>
      </Modal>
      <Modal
        open={Boolean(uninstalling)}
        title={`卸载「${uninstalling?.instance.title || '应用'}」`}
        onCancel={() => setPendingApplication(null)}
        okText="卸载"
        cancelText="取消"
        onOk={() => {
          if (uninstalling) change((ws) => removeApplication(ws, uninstalling.id))
          setPendingApplication(null)
        }}
      >
        <Text>应用、Dock 和状态栏入口，以及页面中的小组件都会移除。私有数据仍留在本机，可以用撤销找回。</Text>
      </Modal>
    </SysPage></div>
  )
}
