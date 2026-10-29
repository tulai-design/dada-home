import {useState} from 'react'
import {ActionIcon, Button, Empty, Flexbox, Input, List, Text} from '@lobehub/ui'
import {Check, Plus, Trash as Trash2} from '@phosphor-icons/react'
import {useComponentData} from '../lib/componentData'
import {registerComponent, type ComponentProps} from '../lib/registry'
import {uid} from '../lib/store'
import type {Todo} from '../lib/types'

type TodosConfig = {
  heading: string
  /** 0 表示不限制条数 */
  limit: number
  hideDone: boolean
  allowAdd: boolean
}

function Todos({instance, config}: ComponentProps<TodosConfig>) {
  const [todos, setTodos] = useComponentData<Todo[]>(instance.id, [])
  const [draft, setDraft] = useState('')

  const add = () => {
    const text = draft.trim()
    if (!text) return
    setTodos((prev) => [{id: uid(), text, done: false, createdAt: Date.now()}, ...prev])
    setDraft('')
  }

  const visible = (config.hideDone ? todos.filter((todo) => !todo.done) : todos).slice(0, config.limit > 0 ? config.limit : undefined)

  return (
    <Flexbox className="page-pane" direction="vertical" gap={10}>
      {config.heading && <Text as="h2">{config.heading}</Text>}
      {config.allowAdd && (
        <Input
          size="large"
          aria-label="添加待办"
          placeholder="添一件待办，回车确认"
          value={draft}
          prefix={<Plus size={14} />}
          onValueChange={setDraft}
          onPressEnter={add}
          suffix={
            <Button className="todo-add" size="small" type="primary" icon={<Plus size={14} />} disabled={!draft.trim()} onClick={add}>
              添加
            </Button>
          }
        />
      )}
      {visible.length ? (
        <List
          className="page-list"
          variant="borderless"
          items={visible.map((todo) => ({
            key: todo.id,
            label: todo.text,
            className: todo.done ? 'is-done' : undefined,
            extra: (
              <Flexbox direction="horizontal" gap={4}>
                <ActionIcon
                  icon={Check}
                  size="small"
                  title={todo.done ? '标成未完成' : '完成'}
                  active={todo.done}
                  onClick={() => setTodos((prev) => prev.map((item) => (item.id === todo.id ? {...item, done: !item.done} : item)))}
                />
                <ActionIcon icon={Trash2} size="small" title="删除" onClick={() => setTodos((prev) => prev.filter((item) => item.id !== todo.id))} />
              </Flexbox>
            ),
          }))}
        />
      ) : (
        <Empty title="今天还没有安排" description="让搭搭帮你记一件，或者自己写。" />
      )}
    </Flexbox>
  )
}

registerComponent<TodosConfig>({
  type: 'todos',
  name: '待办',
  description: '待办清单，可添加、完成、删除。可设置只显示未完成、限制条数。可以放多个清单，各自独立。',
  category: 'tool',
  defaultConfig: {heading: '待办', limit: 0, hideDone: false, allowAdd: true},
  configSchema: {
    heading: {kind: 'string', label: '标题', placeholder: '留空则不显示'},
    limit: {kind: 'number', label: '最多显示条数', description: '0 表示不限制', min: 0, max: 100},
    hideDone: {kind: 'boolean', label: '隐藏已完成'},
    allowAdd: {kind: 'boolean', label: '显示添加框'},
  },
  defaultSpan: 'half',
  component: Todos,
  multiple: true,
})
