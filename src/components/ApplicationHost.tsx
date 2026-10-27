import {ActionIcon, Button, Drawer, Empty, Flexbox, Modal, Segmented} from '@lobehub/ui'
import {ArrowSquareOut, Gear, X} from '@phosphor-icons/react'
import {applicationInstance} from '../lib/applications'
import {getDefinition, type ComponentHost} from '../lib/registry'
import type {ApplicationOpenMode, GeneratedApplication, Workspace} from '../lib/workspace'
import {useIsMobile} from '../lib/useMedia'
import {SysPage} from './SysPage'
import {WidgetBoundary} from './WidgetBoundary'

/** 所有入口共用同一份实例身份；切换打开方式时只运行一个主视图。 */
export function ApplicationHost({application, mode, workspace, host, onMode, onClose, onSettings, onConfig}: {
  application: GeneratedApplication
  mode: ApplicationOpenMode
  workspace: Workspace
  host: ComponentHost
  onMode: (mode: ApplicationOpenMode) => void
  onClose: () => void
  onSettings: () => void
  onConfig: (id: string, patch: Record<string, unknown>) => void
}) {
  const mobile = useIsMobile()
  const instance = applicationInstance(workspace, application.id, mode)
  const definition = getDefinition(instance.type)
  const title = instance.title || '应用'
  const actions = <Flexbox horizontal align="center" gap={6}>
    <Segmented size="small" aria-label="应用打开方式" value={mode} options={[{value:'modal',label:'弹窗'},{value:'drawer',label:'抽屉'},{value:'page',label:'全页'}]} onChange={(value) => onMode(value as ApplicationOpenMode)} />
    <ActionIcon icon={Gear} title="应用设置" aria-label="应用设置" onClick={onSettings} />
  </Flexbox>
  const content = <div className="application-runtime" data-application={application.id} data-surface={mode}>
    <WidgetBoundary key={`${application.id}:${mode}`} label={title}>
      {definition ? <definition.component instance={instance} config={instance.config} host={host} updateConfig={(patch) => onConfig(instance.id, patch)} /> : <Empty title="应用运行器不可用" />}
    </WidgetBoundary>
  </div>
  if (mode === 'page') return <SysPage title={title} extra={<Flexbox horizontal align="center" gap={6}>{!mobile && actions}<Button icon={<X size={15}/>} onClick={onClose}>关闭</Button></Flexbox>}>{mobile && <div className="application-modal-tools">{actions}</div>}{content}</SysPage>
  if (mode === 'drawer') return <Drawer open title={title} width={mobile ? '100%' : 680} extra={mobile ? undefined : actions} onClose={onClose}>{mobile && <div className="application-modal-tools">{actions}</div>}{content}</Drawer>
  return <Modal open title={title} width={mobile ? 'calc(100vw - 24px)' : 800} footer={null} onCancel={onClose}>
    <div className="application-modal-tools">{actions}</div>
    {content}
  </Modal>
}

export function ApplicationInUse({name, onOpen}: {name: string; onOpen: () => void}) {
  return <Flexbox className="page-pane application-in-use" gap={10}>
    <span>「{name}」已在独立窗口打开</span>
    <Button size="small" icon={<ArrowSquareOut size={14}/>} onClick={onOpen}>回到页面小组件</Button>
  </Flexbox>
}
