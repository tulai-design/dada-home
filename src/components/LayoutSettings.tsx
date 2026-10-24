import { useEffect, useState } from 'react'
import { ActionIcon, Flexbox, Modal, Select, Switch, Text } from '@lobehub/ui'
import { ArrowDown, ArrowUp, Lock, Plus, Trash2, X } from 'lucide-react'
import { useAppSettings } from '../lib/apps'
import { removeData } from '../lib/componentData'
import { listStatusTypes, movePage, removePage, renamePage, setStatusbar } from '../lib/ops'
import { PAGE_ICONS, PAGE_ICON_LABELS, pageIcon } from '../lib/pageIcons'
import { getDefinition, type ConfigField } from '../lib/registry'
import { FROZEN_PAGE_ID, MAX_STATUS_ITEMS, type Page } from '../lib/workspace'
import { Group, Row, TextRow } from './ios'

/* ---------------- 侧栏 ---------------- */

const FIXED = ['首页', 'AI', '监控', '设置']

/** 名称和标签先在本地编辑，停手后再提交，避免每敲一个字就进一次撤销栈。 */
function PageEditor({ page, index, last, onMove, onRemove }: { page: Page; index: number; last: boolean; onMove: (to: number) => void; onRemove: () => void }) {
  const { edit } = useAppSettings()
  const [name, setName] = useState(page.name)
  const [label, setLabel] = useState(page.label)
  useEffect(() => {
    setName(page.name)
    setLabel(page.label)
  }, [page.name, page.label])
  useEffect(() => {
    if (name === page.name && label === page.label) return
    const timer = window.setTimeout(() => edit((ws) => renamePage(ws, page.id, { name, label })), 500)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, label])

  return (
    <Group>
      <TextRow label="名称" value={name} onChange={setName} />
      <TextRow label="侧栏标签" hint="不超过 4 个字" value={label} onChange={(v) => setLabel(v.slice(0, 4))} />
      <Row label="图标">
        <Select
          className="ios-select"
          variant="borderless"
          value={page.icon ?? 'dashboard'}
          options={Object.entries(PAGE_ICONS).map(([key, Icon]) => ({
            value: key,
            label: (
              <Flexbox direction="horizontal" align="center" gap={8}>
                <Icon size={14} /> {PAGE_ICON_LABELS[key] ?? key}
              </Flexbox>
            ),
          }))}
          onChange={(value) => edit((ws) => renamePage(ws, page.id, { icon: String(value) }))}
        />
      </Row>
      <Row label="顺序">
        <Flexbox direction="horizontal" gap={4}>
          <ActionIcon icon={ArrowUp} title="上移" disabled={index <= 1} onClick={() => onMove(index - 1)} />
          <ActionIcon icon={ArrowDown} title="下移" disabled={last} onClick={() => onMove(index + 1)} />
        </Flexbox>
      </Row>
      <Row label="删除这个页面" icon={<Trash2 size={16} />} danger onClick={onRemove} />
    </Group>
  )
}

export function SidebarSettings() {
  const { workspace, edit } = useAppSettings()
  const [pending, setPending] = useState<Page | null>(null)
  const pages = workspace.pages
  const [editing, setEditing] = useState<string | null>(null)
  const editingIndex = pages.findIndex((page) => page.id === editing)
  const editingPage = editingIndex >= 0 ? pages[editingIndex] : null

  return (
    <>
      <Group title="固定项" footer="这些是系统入口，不能修改、删除或挪动。">
        {FIXED.map((name) => (
          <Row key={name} label={name} icon={<Lock size={15} />}>
            <Text type="secondary">固定</Text>
          </Row>
        ))}
      </Group>

      <Group
        title={`页面 · ${pages.length} 个`}
        footer="按这里的顺序排，侧栏放不下的会自动收进「更多」，当前页面始终可见。想新增或整理页面，也可以直接让搭搭来。"
      >
        <Row label="首页" hint="固定在最前面" icon={<Lock size={15} />}>
          <Text type="secondary">固定</Text>
        </Row>
        {pages.map((page) => {
          if (page.id === FROZEN_PAGE_ID) return null
          const Icon = pageIcon(page.icon)
          return (
            <Row
              key={page.id}
              label={page.name}
              hint={`${page.components.length} 个组件`}
              icon={<Icon size={16} />}
              chevron
              onClick={() => setEditing(page.id)}
            />
          )
        })}
      </Group>

      <Modal open={Boolean(editingPage)} title={editingPage ? `编辑「${editingPage.name}」` : ''} footer={null} onCancel={() => setEditing(null)}>
        {editingPage && (
          <PageEditor
            key={editingPage.id}
            page={editingPage}
            index={editingIndex}
            last={editingIndex === pages.length - 1}
            onMove={(to) => edit((ws) => movePage(ws, editingPage.id, to))}
            onRemove={() => {
              setPending(editingPage)
              setEditing(null)
            }}
          />
        )}
      </Modal>

      <Modal
        open={Boolean(pending)}
        title="删除页面"
        onCancel={() => setPending(null)}
        okText="删除"
        cancelText="取消"
        onOk={() => {
          if (pending) {
            const target = pending
            edit((ws) => removePage(ws, target.id))
            target.components.forEach((component) => removeData(component.id))
          }
          setPending(null)
        }}
      >
        <Text>
          删除「{pending?.name}」和它上面的 {pending?.components.length ?? 0} 个组件？可以用撤销找回。
        </Text>
      </Modal>
    </>
  )
}

/* ---------------- 状态条 ---------------- */

/** 按组件声明的 schema 渲染一项配置；只处理能内联编辑的几种。 */
function FieldRow({ field, name, value, onChange }: { field: ConfigField; name: string; value: unknown; onChange: (next: unknown) => void }) {
  if (field.kind === 'boolean') {
    return (
      <Row label={field.label}>
        <Switch checked={Boolean(value)} onChange={onChange} />
      </Row>
    )
  }
  if (field.kind === 'select') {
    return (
      <Row label={field.label}>
        <Select className="ios-select" variant="borderless" value={String(value)} options={field.options} onChange={(v) => onChange(String(v))} />
      </Row>
    )
  }
  if (field.kind === 'string') {
    return <TextRow key={name} label={field.label} value={String(value ?? '')} placeholder={field.placeholder} onChange={onChange} />
  }
  return null
}

export function StatusbarSettings() {
  const { workspace, edit } = useAppSettings()
  const items = workspace.statusbar
  const addable = listStatusTypes(workspace)

  const replace = (next: { id?: string; type: string; config: Record<string, unknown> }[]) => edit((ws) => setStatusbar(ws, next))
  const asInput = items.map((item) => ({ id: item.id, type: item.type as string, config: item.config }))

  return (
    <>
      <Group
        title={`当前 · ${items.length} 项`}
        footer="状态条在顶栏右侧，用来实时看一眼状态。默认只有时钟；想放天气、服务在线数，在下面添加，或对搭搭说「把天气放到状态条」。"
      >
        {items.length === 0 && <Row label="还没有内容" />}
      </Group>

      {items.map((item, index) => {
        const definition = getDefinition(item.type)
        if (!definition) return null
        return (
          <Group key={item.id} title={definition.name}>
            {Object.entries(definition.configSchema).map(([key, field]) => (
              <FieldRow
                key={key}
                name={key}
                field={field}
                value={item.config[key]}
                onChange={(next) => replace(asInput.map((entry, i) => (i === index ? { ...entry, config: { ...entry.config, [key]: next } } : entry)))}
              />
            ))}
            <Row label="位置">
              <Flexbox direction="horizontal" gap={4}>
                <ActionIcon
                  icon={ArrowUp}
                  title="左移"
                  disabled={index === 0}
                  onClick={() => {
                    const next = [...asInput]
                    ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                    replace(next)
                  }}
                />
                <ActionIcon
                  icon={ArrowDown}
                  title="右移"
                  disabled={index === items.length - 1}
                  onClick={() => {
                    const next = [...asInput]
                    ;[next[index + 1], next[index]] = [next[index], next[index + 1]]
                    replace(next)
                  }}
                />
              </Flexbox>
            </Row>
            <Row label="从状态条移除" icon={<X size={16} />} danger onClick={() => replace(asInput.filter((_, i) => i !== index))} />
          </Group>
        )
      })}

      <Group title="可添加" footer={items.length >= MAX_STATUS_ITEMS ? `最多 ${MAX_STATUS_ITEMS} 项。` : '任何声明了状态条形态的组件都会出现在这里。'}>
        {addable.map((definition) => (
          <Row
            key={definition.type}
            label={definition.name}
            hint={definition.description.slice(0, 40)}
            icon={<Plus size={16} />}
            onClick={items.length >= MAX_STATUS_ITEMS ? undefined : () => replace([...asInput, { type: definition.type, config: definition.type === 'clock' ? { showSeconds: true } : {} }])}
          />
        ))}
      </Group>
    </>
  )
}
