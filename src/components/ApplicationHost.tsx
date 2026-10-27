import {createPortal} from 'react-dom'
import {Button, Drawer, Empty, Flexbox} from '@lobehub/ui'
import {ArrowSquareOut, X} from '@phosphor-icons/react'
import {applicationInstance} from '../lib/applications'
import {getDefinition, type ComponentHost} from '../lib/registry'
import type {ApplicationOpenMode, GeneratedApplication, Workspace} from '../lib/workspace'
import {useIsMobile} from '../lib/useMedia'
import {SysPage} from './SysPage'
import {WidgetBoundary} from './WidgetBoundary'
import {ApplicationWindow} from './ApplicationWindow'
import '../application-window.css'

/** 所有入口共用同一份实例身份；切换打开方式时只运行一个主视图。 */
export function ApplicationHost({application, mode, workspace, host, onClose, onConfig, overlayContainer, canvasContainer, minimized = false, onMinimize = () => {}, onRestore = () => {}}: {
  application: GeneratedApplication
  mode: ApplicationOpenMode
  workspace: Workspace
  host: ComponentHost
  onClose: () => void
  onConfig: (id: string, patch: Record<string, unknown>) => void
  overlayContainer?: HTMLElement | null
  canvasContainer?: HTMLElement | null
  minimized?: boolean
  onMinimize?: () => void
  onRestore?: () => void
}) {
  const mobile = useIsMobile()
  const instance = applicationInstance(workspace, application.id, mode)
  const definition = getDefinition(instance.type)
  const title = instance.title || '应用'
  const localOverlay = !!overlayContainer && mode !== 'page'
  const content = <div className="application-runtime" data-application={application.id} data-surface={mode}>
    <WidgetBoundary key={`${application.id}:${mode}`} label={title}>
      {definition ? <definition.component instance={instance} config={instance.config} host={host} updateConfig={(patch) => onConfig(instance.id, patch)} /> : <Empty title="应用运行器不可用" />}
    </WidgetBoundary>
  </div>
  if (mode === 'page') return <SysPage title={title} extra={<Button size="small" type="text" icon={<X size={15}/>} onClick={onClose}>关闭</Button>}>{content}</SysPage>
  if (mode === 'drawer') return <>
    {overlayContainer && createPortal(<div className="canvas-overlay-shade" aria-hidden="true"/>, overlayContainer)}
    <Drawer className="application-window" classNames={{popup: localOverlay ? 'canvas-overlay-drawer' : undefined}} getContainer={overlayContainer} mask={!localOverlay} maskClosable={!localOverlay} open title={title} width={mobile ? '100%' : 680} onClose={onClose}>{content}</Drawer>
  </>
  return <ApplicationWindow key={application.id} title={title} container={canvasContainer ?? null} minimized={minimized} onMinimize={onMinimize} onRestore={onRestore} onClose={onClose}>{content}</ApplicationWindow>
}

export function ApplicationInUse({name, onOpen}: {name: string; onOpen: () => void}) {
  return <Flexbox className="page-pane application-in-use" gap={10}>
    <span>「{name}」已在独立窗口打开</span>
    <Button size="small" icon={<ArrowSquareOut size={14}/>} onClick={onOpen}>继续使用应用</Button>
  </Flexbox>
}
