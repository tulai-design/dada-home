import { useState } from 'react'
import { Button, Modal, Text } from '@lobehub/ui'
import { ArrowUpRight, Check, Download, Trash2 } from 'lucide-react'
import { ADDONS, isInstalled, type Addon } from '../lib/market'
import { installAddon, uninstallAddon } from '../lib/ops'
import type { Workspace } from '../lib/workspace'
import { SysPage } from './SysPage'
import { Tile } from './ios'

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
}: {
  workspace: Workspace
  edit: (fn: (workspace: Workspace) => Workspace) => void
  onOpenPage: (id: string) => void
  onOpenMonitor: () => void
}) {
  const [pending, setPending] = useState<Addon | null>(null)
  const installed = ADDONS.filter((addon) => isInstalled(workspace, addon.id))

  const open = (addon: Addon) => {
    if (addon.page) onOpenPage(addon.page.id)
    else if (addon.rail === 'monitor') onOpenMonitor()
  }

  return (
    <SysPage title="组件市场">
      <p className="market-lead">
        这里是预制好的小功能，装了才会出现在侧栏和页面里。想要这里没有的，直接对搭搭说，它能现做一个。
        <span className="market-count">已安装 {installed.length} / {ADDONS.length}</span>
      </p>

      <div className="market-grid">
        {ADDONS.map((addon) => {
          const on = isInstalled(workspace, addon.id)
          return (
            <article key={addon.id} className="market-card" data-on={on}>
              <div className="market-head">
                <Tile icon={addon.icon} color={addon.color} size={44} />
                <div className="market-title">
                  <h3>{addon.name}</h3>
                  <span>{addon.tagline}</span>
                </div>
              </div>
              <p className="market-desc">{addon.description}</p>
              <div className="market-actions">
                {on ? (
                  <>
                    <Button icon={<ArrowUpRight size={15} />} onClick={() => open(addon)}>
                      打开
                    </Button>
                    <Button type="text" icon={<Trash2 size={15} />} danger onClick={() => setPending(addon)}>
                      卸载
                    </Button>
                    <span className="market-badge">
                      <Check size={13} /> 已安装
                    </span>
                  </>
                ) : (
                  <Button
                    type="primary"
                    icon={<Download size={15} />}
                    onClick={() => edit((ws) => installAddon(ws, addon.id).workspace)}
                  >
                    安装
                  </Button>
                )}
              </div>
            </article>
          )
        })}
      </div>

      <Modal
        open={Boolean(pending)}
        title={`卸载「${pending?.name ?? ''}」`}
        onCancel={() => setPending(null)}
        okText="卸载"
        cancelText="取消"
        onOk={() => {
          if (pending) {
            const target = pending
            edit((ws) => uninstallAddon(ws, target.id).workspace)
          }
          setPending(null)
        }}
      >
        <Text>
          页面和状态条上的「{pending?.name}」会被移除{pending?.page ? '，它的页面也会一并删掉' : ''}。组件保存的数据仍留在本机。可以用撤销找回。
        </Text>
      </Modal>
    </SysPage>
  )
}
