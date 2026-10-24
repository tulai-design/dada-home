import {useState} from 'react'
import {ActionIcon, Flexbox, Modal, Switch, Tag, Text} from '@lobehub/ui'
import {PencilSimple as Pencil, Plus, FloppyDisk as Save, Trash as Trash2} from '@phosphor-icons/react'
import {useAppSettings} from '../lib/apps'
import {PRESETS} from '../lib/presets'
import {applyTemplate, isSynced, removeTemplate, renameTemplate, saveTemplate, summarize} from '../lib/templates'
import {MAX_TEMPLATES} from '../lib/workspace'
import {Group, Row, TextRow} from './ios'

type Target = {id: string; name: string; preset: boolean}

/**
 * 设置 › 模板：整套页面设计的存档。
 * 存下现在的布局，随时切回去；也可以从内置预设起步。组件里的数据不在模板里，切换不会丢。
 */
export function TemplateSettings() {
  const {workspace, edit} = useAppSettings()
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [withTheme, setWithTheme] = useState(true)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [applying, setApplying] = useState<Target | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState('')

  const current = workspace.templates.find((item) => item.id === workspace.template)
  const dirty = current ? !isSynced(workspace, current) : false
  const full = workspace.templates.length >= MAX_TEMPLATES

  const openSave = () => {
    setName('')
    setDescription('')
    setWithTheme(true)
    setError('')
    setSaving(true)
  }

  const commitSave = () => {
    if (!name.trim()) return setError('给模板起个名字')
    try {
      // 先试一次：重名、满额这些问题要在弹窗里说，而不是静默失败
      saveTemplate(workspace, {name, description, withTheme})
    } catch (err) {
      return setError(err instanceof Error ? err.message : String(err))
    }
    edit((ws) => saveTemplate(ws, {name, description, withTheme}).workspace)
    setSaving(false)
  }

  const startRename = (id: string) => {
    const entry = workspace.templates.find((item) => item.id === id)
    if (!entry) return
    setRenaming(id)
    setName(entry.name)
    setDescription(entry.description)
    setError('')
  }

  const commitRename = () => {
    if (!renaming) return
    try {
      renameTemplate(workspace, renaming, {name, description})
    } catch (err) {
      return setError(err instanceof Error ? err.message : String(err))
    }
    edit((ws) => renameTemplate(ws, renaming, {name, description}))
    setRenaming(null)
  }

  const deleting_ = workspace.templates.find((item) => item.id === deleting)

  return (
    <>
      <Group
        title="当前设计"
        footer={
          current
            ? dirty
              ? `最近用的是「${current.name}」，之后你又改过页面。可以更新它，或另存一份新的。`
              : `和「${current.name}」一致。`
            : '把现在的页面、组件、状态条和配色存下来，之后随时切回来。'
        }
      >
        <Row label="另存为新模板" icon={<Plus size={16} />} hint={full ? `模板库满了（最多 ${MAX_TEMPLATES} 个）` : undefined} onClick={full ? undefined : openSave} chevron={!full} />
        {current && dirty && (
          <Row
            label={`更新「${current.name}」`}
            icon={<Save size={16} />}
            hint="用当前设计覆盖它"
            onClick={() => edit((ws) => saveTemplate(ws, {id: current.id}).workspace)}
          />
        )}
      </Group>

      <Group
        title={`我的模板 · ${workspace.templates.length} 个`}
        footer={workspace.templates.length ? '点一个模板套用它。套用会整体替换当前页面，可以用撤销找回；待办、便签等数据不受影响。' : '还没有存过模板。也可以对搭搭说「把现在的布局存成模板」。'}
      >
        {workspace.templates.map((item) => (
          <Row
            key={item.id}
            label={item.name}
            hint={`${item.description ? `${item.description} · ` : ''}${summarize(item.snapshot)}`}
            checked={item.id === workspace.template}
            onClick={() => setApplying({id: item.id, name: item.name, preset: false})}
          >
            <Flexbox direction="horizontal" align="center" gap={2} onClick={(event) => event.stopPropagation()}>
              {item.id === workspace.template && dirty && <Tag variant="borderless">已修改</Tag>}
              <ActionIcon icon={Pencil} title="改名与说明" size="small" onClick={() => startRename(item.id)} />
              <ActionIcon icon={Trash2} title="删除" size="small" onClick={() => setDeleting(item.id)} />
            </Flexbox>
          </Row>
        ))}
      </Group>

      <Group title="内置预设" footer="从这里起步，套用后再让搭搭按你的想法改。预设不会被修改，也不占模板名额。">
        {PRESETS.map((preset) => (
          <Row
            key={preset.id}
            label={preset.name}
            hint={`${preset.description} 含：${preset.tags.join('、')}`}
            checked={preset.id === workspace.template}
            onClick={() => setApplying({id: preset.id, name: preset.name, preset: true})}
          />
        ))}
      </Group>

      <Modal open={saving} title="另存为新模板" okText="保存" cancelText="取消" onCancel={() => setSaving(false)} onOk={commitSave}>
        <Group>
          <TextRow label="名称" value={name} placeholder="例如：工作日" onChange={setName} onEnter={commitSave} />
          <TextRow label="说明" value={description} placeholder="适合什么场景（可不填）" onChange={setDescription} />
          <Row label="连同配色一起存" hint="套用时会一并切换主题">
            <Switch checked={withTheme} onChange={setWithTheme} />
          </Row>
        </Group>
        {error && <Text type="danger">{error}</Text>}
      </Modal>

      <Modal open={Boolean(renaming)} title="改名与说明" okText="保存" cancelText="取消" onCancel={() => setRenaming(null)} onOk={commitRename}>
        <Group>
          <TextRow label="名称" value={name} onChange={setName} />
          <TextRow label="说明" value={description} onChange={setDescription} placeholder="适合什么场景" />
        </Group>
        {error && <Text type="danger">{error}</Text>}
      </Modal>

      <Modal
        open={Boolean(applying)}
        title="套用模板"
        okText="套用"
        cancelText="取消"
        onCancel={() => setApplying(null)}
        onOk={() => {
          if (applying) edit((ws) => applyTemplate(ws, applying.id).workspace)
          setApplying(null)
        }}
      >
        <Text>
          套用「{applying?.name}」会替换当前所有页面、组件和状态条
          {current && dirty ? `；你对「${current.name}」的改动还没保存` : ''}。可以用撤销找回。
        </Text>
      </Modal>

      <Modal
        open={Boolean(deleting)}
        title="删除模板"
        okText="删除"
        cancelText="取消"
        onCancel={() => setDeleting(null)}
        onOk={() => {
          if (deleting) edit((ws) => removeTemplate(ws, deleting).workspace)
          setDeleting(null)
        }}
      >
        <Text>删除模板「{deleting_?.name}」？只删存档，不影响现在的页面。</Text>
      </Modal>
    </>
  )
}
