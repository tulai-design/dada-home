import {useEffect, useId, useRef, useState} from 'react'
import {Button, InputNumber, Modal, Select, Switch, Text, toast} from '@lobehub/ui'
import {ArrowUpRight, Trash} from '@phosphor-icons/react'
import {useAppSettings} from '../lib/apps'
import {configureApplication, listApplications, mountApplication, removeApplication} from '../lib/applications'
import {MAX_STATUS_ITEMS, type ApplicationOpenMode, type ApplicationSettingField, type ComponentSpan, type GeneratedApplication, type Workspace} from '../lib/workspace'
import {Group, Row} from './ios'

const OPEN_MODES: {value: ApplicationOpenMode; label: string}[] = [
  {value: 'modal', label: '弹窗'},
  {value: 'drawer', label: '抽屉'},
  {value: 'page', label: '全页面'},
]
const WIDTHS: {value: ComponentSpan; label: string}[] = [
  {value: 'third', label: '三分之一'},
  {value: 'half', label: '二分之一'},
  {value: 'two-thirds', label: '三分之二'},
  {value: 'full', label: '整行'},
]

/** 停止输入后提交，避免每个字符都占一次撤销历史。 */
function ApplicationTextRow({label, hint, value, onCommit, placeholder, maxLength, suggestions, required}: {
  label: string; hint?: string; value: string; onCommit: (value: string) => void; placeholder?: string; maxLength?: number; suggestions?: string[]; required?: boolean
}) {
  const [draft, setDraft] = useState(value)
  const commit = useRef(onCommit)
  commit.current = onCommit
  const listId = useId()
  useEffect(() => setDraft(value), [value])
  useEffect(() => {
    if (draft === value || required && !draft.trim()) return
    const timer = window.setTimeout(() => commit.current(draft), 500)
    return () => window.clearTimeout(timer)
  }, [draft, value, required])
  return <Row label={label} hint={hint} stack={Boolean(hint)}>
    <input
      className="application-setting-input"
      aria-label={label}
      value={draft}
      placeholder={placeholder}
      maxLength={maxLength}
      list={suggestions?.length ? listId : undefined}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (required && !draft.trim()) setDraft(value)
        else if (draft !== value) commit.current(draft)
      }}
    />
    {suggestions?.length ? <datalist id={listId}>{suggestions.map((item) => <option key={item} value={item} />)}</datalist> : null}
  </Row>
}

function ApplicationField({field, value, onChange}: {field: ApplicationSettingField; value: unknown; onChange: (value: string | number | boolean) => void}) {
  const id = useId()
  if (field.kind === 'boolean') return <Row label={field.label} hint={field.description}>
    <Switch aria-label={field.label} checked={Boolean(value)} onChange={onChange} />
  </Row>
  if (field.kind === 'select') return <Row label={<label htmlFor={id}>{field.label}</label>} hint={field.description}>
    <Select id={id} className="ios-select application-select" variant="borderless" value={typeof value === 'string' ? value : undefined} placeholder="请选择" options={field.options ?? []} onChange={(next) => onChange(String(next))} />
  </Row>
  if (field.kind === 'number') return <Row label={field.label} hint={field.description}>
    <InputNumber aria-label={field.label} className="application-number" variant="borderless" value={typeof value === 'number' ? value : null} min={field.min} max={field.max} onChange={(next) => { if (typeof next === 'number' && Number.isFinite(next)) onChange(next) }} />
  </Row>
  return <ApplicationTextRow label={field.label} hint={field.description} value={typeof value === 'string' ? value : ''} maxLength={2000} onCommit={onChange} />
}

/** AI 应用也有普通用户能操作的设置，不把脚本源码当作配置表单。 */
export function ApplicationSettings({application}: {application: GeneratedApplication}) {
  const id = useId()
  const {workspace, edit, openApplication} = useAppSettings()
  const [confirmUninstall, setConfirmUninstall] = useState(false)
  const applications = listApplications(workspace)
  const name = application.instance.title || '未命名应用'
  const mountedPage = workspace.pages.find((page) => page.components.some((item) => item.id === application.instance.id))
  const mountedInstance = mountedPage?.components.find((item) => item.id === application.instance.id)
  const fields = Object.entries(application.settingsSchema ?? {})
  const groups = [...new Set(applications.map((item) => item.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const statusCount = workspace.statusbar.length + applications.filter((item) => item.status).length
  const change = (fn: (workspace: Workspace) => Workspace) => {
    try { edit(fn) } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
  }
  const configure = (patch: Parameters<typeof configureApplication>[2]) => change((ws) => configureApplication(ws, application.id, patch))

  return <div className="application-settings">
    <Group footer="应用始终可以从组件市场打开。下面的入口只在你需要时添加。">
      <Row label="打开应用" hint={OPEN_MODES.find((mode) => mode.value === application.openMode)?.label}>
        <Button icon={<ArrowUpRight size={16} />} onClick={() => openApplication?.(application.id)} disabled={!openApplication}>打开</Button>
      </Row>
      <ApplicationTextRow label="名称" value={name} required maxLength={24} onCommit={(title) => configure({title})} />
      <ApplicationTextRow label="说明" value={application.description} placeholder="这款应用用来做什么" maxLength={200} onCommit={(description) => configure({description})} />
      <ApplicationTextRow label="分组" hint="输入新分组，或选择已有分组；留空放入「未分组」。" value={application.group ?? ''} placeholder="未分组" maxLength={24} suggestions={groups} onCommit={(group) => configure({group})} />
    </Group>

    <Group title="打开方式与入口" footer="Dock 用来快速打开应用。状态栏可放启动按钮或应用专用的紧凑视图，小组件可以单独放到一个页面中。">
      <Row label={<label htmlFor={`${id}-open`}>默认打开方式</label>}>
        <Select id={`${id}-open`} className="ios-select application-select" variant="borderless" value={application.openMode} options={OPEN_MODES} onChange={(openMode) => configure({openMode: String(openMode)})} />
      </Row>
      <Row label="Dock 入口" hint="电脑左侧、手机底部的导航栏。">
        <Switch aria-label="Dock 入口" checked={application.dock} onChange={(dock) => configure({dock})} />
      </Row>
      <Row label="状态栏入口" hint={statusCount >= MAX_STATUS_ITEMS && !application.status ? `状态栏已满，最多 ${MAX_STATUS_ITEMS} 项。` : '在顶栏显示启动按钮，或应用为状态栏准备的紧凑视图。'}>
        <Switch aria-label="状态栏入口" checked={application.status} disabled={!application.status && statusCount >= MAX_STATUS_ITEMS} onChange={(status) => configure({status})} />
      </Row>
      {application.status && <Row label={<label htmlFor={`${id}-status`}>状态栏显示方式</label>} hint={application.statusMode === 'compact' ? '需要应用提供专用的紧凑状态视图。若显示不合适，可以让搭搭补充适配，或切回启动按钮。' : '只显示打开应用的按钮，点击后按默认方式打开。'} stack>
        <Select id={`${id}-status`} className="ios-select application-select" variant="borderless" value={application.statusMode ?? 'launcher'} options={[{value: 'launcher', label: '启动按钮'}, {value: 'compact', label: '紧凑视图'}]} onChange={(statusMode) => configure({statusMode: String(statusMode)})} />
      </Row>}
      <Row label={<label htmlFor={`${id}-widget`}>页面小组件</label>} hint="每个应用同时放在一个页面，移动位置会保留已有数据。" stack>
        <Select id={`${id}-widget`} className="ios-select application-select" variant="borderless" value={mountedPage?.id ?? ''} placeholder="不添加到页面" options={[{value: '', label: '不添加到页面'}, ...workspace.pages.map((page) => ({value: page.id, label: page.name}))]} onChange={(pageId) => change((ws) => mountApplication(ws, application.id, pageId ? String(pageId) : null))} />
      </Row>
      {mountedPage && <Row label={<label htmlFor={`${id}-span`}>小组件宽度</label>}>
        <Select id={`${id}-span`} className="ios-select application-select" variant="borderless" value={mountedInstance?.span ?? application.instance.span ?? 'half'} options={WIDTHS} onChange={(span) => change((ws) => mountApplication(ws, application.id, mountedPage.id, String(span)))} />
      </Row>}
    </Group>

    <Group title="应用设置" footer={fields.length ? '改动会自动保存，应用会收到新的设置值。' : '这款应用还没有声明可配置项。可以对搭搭说「给这个应用增加设置项」，已有内容和数据会保留。'}>
      {fields.length ? fields.map(([key, field]) => <ApplicationField key={key} field={field} value={application.settings?.[key] ?? field.default} onChange={(value) => configure({settings: {[key]: value}})} />) : <Row label="暂无可配置项" hint="名称、分组、打开方式和入口仍可在上方设置。" />}
    </Group>

    <Group footer="卸载会移除组件市场中的应用、Dock 和状态栏入口，以及页面小组件。私有数据仍留在本机，可以撤销找回应用。">
      <Row label="卸载应用" icon={<Trash size={16} />} danger onClick={() => setConfirmUninstall(true)} />
    </Group>
    <Modal open={confirmUninstall} title={`卸载「${name}」`} okText="卸载" cancelText="取消" onCancel={() => setConfirmUninstall(false)} onOk={() => {
      change((ws) => removeApplication(ws, application.id))
      setConfirmUninstall(false)
    }}>
      <Text>移除「{name}」和它的所有入口及页面小组件？私有数据会保留，可以用撤销找回。</Text>
    </Modal>
  </div>
}
