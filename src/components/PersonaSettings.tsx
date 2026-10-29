import {useRef, useState} from 'react'
import {ActionIcon, Flexbox, Modal, Segmented, Switch, Tag, Text, TextArea} from '@lobehub/ui'
import {ClockCounterClockwise as History, PencilSimple as Pencil, Plus, ArrowCounterClockwise as RotateCcw, Trash as Trash2} from '@phosphor-icons/react'
import {
  DEFAULT_SOUL,
  MEMORY_KINDS,
  MEMORY_MAX_CHARS,
  SOUL_MAX,
  SOUL_PRESETS,
  addMemory,
  clearMemories,
  commitSoulEdit,
  removeMemory,
  restoreSoul,
  setAiCanEdit,
  setMemoryEnabled,
  setProfile,
  setSoulName,
  setSoulText,
  typeSoulText,
  updateMemory,
  usePersona,
  type Memory,
  type MemoryKind,
} from '../lib/persona'
import {Group, Row, TextRow} from './ios'

const when = (at: number) => new Date(at).toLocaleString('zh-CN', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'})
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** 设置 › 个人 里「关于你」的表单：身份、兴趣、偏好、备注。称呼由调用方放在最上面。 */
export function ProfileForm() {
  const {profile} = usePersona()
  return (
    <>
      <Group title="关于你" footer="填得越具体，搭搭越懂你。这些资料用于对话背景；使用自建同步服务时，会随配置加密同步。">
        <TextRow label="身份" stack value={profile.role} placeholder="例如：独立开发者 / 产品经理 / 大三学生" onChange={(role) => setProfile({role})} />
        <TextRow label="兴趣" stack value={profile.interests} placeholder="例如：摄影、咖啡、Rust、科幻小说" onChange={(interests) => setProfile({interests})} />
      </Group>
      <Group title="偏好" footer="你希望搭搭怎么跟你配合、页面做成什么样。">
        <Row stack>
          <TextArea
            className="ai-textarea"
            aria-label="偏好"
            variant="borderless"
            autoSize={{minRows: 2, maxRows: 6}}
            maxLength={600}
            value={profile.preferences}
            placeholder="例如：喜欢深色、低饱和；回答尽量短；不要用 emoji"
            onChange={(event) => setProfile({preferences: event.target.value})}
          />
        </Row>
      </Group>
      <Group title="备注" footer="其他想让搭搭知道的，比如作息、常用的网站、正在做的事。搭搭聊天时也会自己积累，见「记忆」。">
        <Row stack>
          <TextArea
            className="ai-textarea"
            aria-label="备注"
            variant="borderless"
            autoSize={{minRows: 3, maxRows: 10}}
            maxLength={1000}
            value={profile.notes}
            placeholder="随便写…"
            onChange={(event) => setProfile({notes: event.target.value})}
          />
        </Row>
      </Group>
    </>
  )
}

/** 设置 › 灵魂：搭搭是谁、怎么说话、按什么原则做事。 */
export function SoulSettings() {
  const {soul} = usePersona()
  const before = useRef(soul.text)
  const [history, setHistory] = useState(false)
  const [pendingPreset, setPendingPreset] = useState<(typeof SOUL_PRESETS)[number] | null>(null)
  const [pendingRevision, setPendingRevision] = useState<number | null>(null)

  return (
    <>
      <Group title="名字" footer="搭搭对自己的称呼，只影响它怎么自称；界面里仍然叫「搭搭」。">
        <TextRow label="名字" value={soul.name} placeholder="搭搭" onChange={setSoulName} />
      </Group>

      <Group title="灵魂" footer={`用 Markdown 写：它是什么性格、怎么说话、按什么原则做事。越具体越好。${soul.text.length}/${SOUL_MAX} 字`}>
        <Row stack>
          <TextArea
            className="ai-textarea"
            variant="borderless"
            autoSize={{minRows: 10, maxRows: 22}}
            maxLength={SOUL_MAX}
            value={soul.text}
            placeholder="写下搭搭的性格和原则…"
            onFocus={() => {
              before.current = soul.text
            }}
            onBlur={() => commitSoulEdit(before.current)}
            onChange={(event) => typeSoulText(event.target.value)}
          />
        </Row>
        {soul.text !== DEFAULT_SOUL && <Row label="恢复默认灵魂" icon={<RotateCcw size={16} />} onClick={() => setSoulText(DEFAULT_SOUL, 'user', '恢复默认')} />}
      </Group>

      <Group title="从预设开始" footer="套用会替换上面的内容，之前的版本留在修改记录里，随时能找回。">
        {SOUL_PRESETS.map((preset) => (
          <Row key={preset.id} label={preset.name} hint={preset.description} checked={soul.text === preset.text} onClick={() => setPendingPreset(preset)} />
        ))}
      </Group>

      <Group title="搭搭自己改" footer="开着：你说「以后说话再随意一点」这类话时，搭搭可以直接改自己的灵魂，并告诉你改了什么。每次修改都有记录，可以回滚。">
        <Row label="允许搭搭修改自己的灵魂">
          <Switch checked={soul.aiCanEdit} onChange={setAiCanEdit} />
        </Row>
      </Group>

      <Group title={`修改记录 · ${soul.history.length} 条`}>
        <Row label="查看和回滚" icon={<History size={16} />} chevron onClick={() => setHistory(true)} hint={soul.history[0] ? `最近一次：${when(soul.history[0].at)}，${soul.history[0].by === 'ai' ? '搭搭改的' : '你改的'}` : '还没有修改过'} />
      </Group>

      <Modal open={history} title="灵魂的修改记录" footer={null} onCancel={() => setHistory(false)}>
        {soul.history.length === 0 ? (
          <Text type="secondary">还没有修改记录。</Text>
        ) : (
          <Group footer="每一条是「改之前」的内容。点一条回到那个版本，当前内容也会进记录，所以回滚也能再回滚。">
            {soul.history.map((item) => (
              <Row
                key={item.at}
                label={`${when(item.at)} · ${item.by === 'ai' ? '搭搭改的' : '你改的'}`}
                hint={`${item.reason ? `${item.reason}｜` : ''}${item.text.replace(/\s+/g, ' ').slice(0, 60)}…`}
                onClick={() => setPendingRevision(item.at)}
                chevron
              />
            ))}
          </Group>
        )}
      </Modal>

      <Modal
        open={Boolean(pendingPreset)}
        title="套用预设"
        okText="套用"
        cancelText="取消"
        onCancel={() => setPendingPreset(null)}
        onOk={() => {
          if (pendingPreset) setSoulText(pendingPreset.text, 'user', `套用预设：${pendingPreset.name}`)
          setPendingPreset(null)
        }}
      >
        <Text>用「{pendingPreset?.name}」替换现在的灵魂？现在的内容会留在修改记录里。</Text>
      </Modal>

      <Modal
        open={pendingRevision !== null}
        title="回滚"
        okText="回到这个版本"
        cancelText="取消"
        onCancel={() => setPendingRevision(null)}
        onOk={() => {
          if (pendingRevision !== null) restoreSoul(pendingRevision)
          setPendingRevision(null)
          setHistory(false)
        }}
      >
        <Text>回到这个版本？现在的内容会进修改记录。</Text>
      </Modal>
    </>
  )
}

/** 设置 › 记忆：搭搭积累的、对你的认识。看得见，改得了，删得掉。 */
export function MemorySettings() {
  const {memory} = usePersona()
  const [editing, setEditing] = useState<{id?: string; text: string; kind: MemoryKind} | null>(null)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState('')

  const save = () => {
    if (!editing) return
    try {
      if (editing.id) updateMemory(editing.id, editing.text)
      else addMemory({text: editing.text, kind: editing.kind, by: 'user'})
      setEditing(null)
      setError('')
    } catch (err) {
      setError(errorText(err))
    }
  }

  const sourceTag = (item: Memory) => (
    <Tag variant="borderless">
      {MEMORY_KINDS[item.kind]} · {item.by === 'ai' ? '搭搭记的' : '你写的'} · {when(item.at)}
    </Tag>
  )

  return (
    <>
      <Group title="积累" footer="打开后，搭搭会在聊天里把你的偏好、背景和纠正记下来，之后每次对话都带着。它不会记密钥和密码。关掉后不再新增，已有的仍然有效。">
        <Row label="让搭搭自己积累记忆">
          <Switch checked={memory.enabled} onChange={setMemoryEnabled} />
        </Row>
        <Row
          label="添加一条"
          icon={<Plus size={16} />}
          chevron
          onClick={() => {
            setError('')
            setEditing({text: '', kind: 'preference'})
          }}
        />
      </Group>

      <Group
        title={`记忆 · ${memory.items.length} 条`}
        footer={memory.items.length ? '最新的在上面。搭搭看到的是这些内容，不对的、过时的直接改或删。' : '还没有记忆。聊几句，或自己加一条试试。'}
      >
        {memory.items.map((item) => (
          <Row key={item.id} label={item.text} hint={sourceTag(item)}>
            <Flexbox direction="horizontal" gap={2}>
              <ActionIcon
                icon={Pencil}
                title="修改"
                size="small"
                onClick={() => {
                  setError('')
                  setEditing({id: item.id, text: item.text, kind: item.kind})
                }}
              />
              <ActionIcon icon={Trash2} title="删除" size="small" onClick={() => removeMemory(item.id)} />
            </Flexbox>
          </Row>
        ))}
      </Group>

      {memory.items.length > 0 && (
        <Group>
          <Row label="清空全部记忆" icon={<Trash2 size={16} />} danger onClick={() => setClearing(true)} />
        </Group>
      )}

      <Modal open={Boolean(editing)} title={editing?.id ? '修改记忆' : '添加记忆'} okText="保存" cancelText="取消" onCancel={() => setEditing(null)} onOk={save}>
        <Flexbox gap={12}>
          {!editing?.id && (
            <Segmented
              size="small"
              value={editing?.kind}
              options={(Object.keys(MEMORY_KINDS) as MemoryKind[]).map((value) => ({value, label: MEMORY_KINDS[value]}))}
              onChange={(kind) => setEditing((prev) => (prev ? {...prev, kind: kind as MemoryKind} : prev))}
            />
          )}
          <TextArea
            autoFocus
            autoSize={{minRows: 3, maxRows: 8}}
            maxLength={MEMORY_MAX_CHARS}
            value={editing?.text ?? ''}
            placeholder="一件事，写成一句话。例如：喜欢深色、低饱和的页面"
            onChange={(event) => setEditing((prev) => (prev ? {...prev, text: event.target.value} : prev))}
          />
          {error && <Text type="danger">{error}</Text>}
        </Flexbox>
      </Modal>

      <Modal
        open={clearing}
        title="清空记忆"
        okText="清空"
        cancelText="取消"
        onCancel={() => setClearing(false)}
        onOk={() => {
          clearMemories()
          setClearing(false)
        }}
      >
        <Text>清空全部 {memory.items.length} 条记忆？这个操作不能撤销。</Text>
      </Modal>
    </>
  )
}
