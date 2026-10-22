import type { BookmarkGroup, Todo } from './types'
import { isPageId, type PageId } from './pages'
import { readStored, uid, writeStored } from './store'

export type ToolDef = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export const AI_TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'add_todo',
      description: '添加一条待办到书桌。',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: '待办内容' } },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_todo',
      description: '把待办标成完成。可用 id，或用原文/片段匹配。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          text: { type: 'string', description: '待办原文或片段' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_todo',
      description: '删除一条待办。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_todos',
      description: '列出当前全部待办和完成状态。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_note',
      description: '写便签。append 追加到末尾，replace 整页覆盖。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string' },
          mode: { type: 'string', enum: ['append', 'replace'], description: '默认 append' },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_note',
      description: '读取当前便签全文。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_bookmark',
      description: '添加一枚书签。没有分组就放进「常用」，没有「常用」就新建。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          url: { type: 'string' },
          group: { type: 'string', description: '分组名' },
        },
        required: ['name', 'url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_page',
      description: '打开首页的分页：home 首页、feeds 订阅、desk 书桌、marks 书签、hot 热榜。',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'string', enum: ['home', 'feeds', 'desk', 'marks', 'hot'] },
        },
        required: ['page'],
      },
    },
  },
]

export type ToolHost = {
  openPage: (page: PageId) => void
}

function findTodo(todos: Todo[], id?: string, text?: string) {
  if (id) {
    const hit = todos.find((t) => t.id === id)
    if (hit) return hit
  }
  if (text) {
    const q = text.trim().toLowerCase()
    return todos.find((t) => t.text.toLowerCase() === q) ?? todos.find((t) => t.text.toLowerCase().includes(q))
  }
  return undefined
}

export function executeTool(name: string, args: Record<string, unknown>, host: ToolHost): string {
  switch (name) {
    case 'add_todo': {
      const text = String(args.text ?? '').trim()
      if (!text) return '没有待办内容。'
      const todos = readStored<Todo[]>('todos', [])
      writeStored<Todo[]>('todos', [{ id: uid(), text, done: false, createdAt: Date.now() }, ...todos])
      return `已添加待办：${text}`
    }
    case 'complete_todo': {
      const todos = readStored<Todo[]>('todos', [])
      const hit = findTodo(todos, args.id ? String(args.id) : undefined, args.text ? String(args.text) : undefined)
      if (!hit) return '没有找到这条待办。'
      writeStored<Todo[]>(
        'todos',
        todos.map((t) => (t.id === hit.id ? { ...t, done: true } : t)),
      )
      return `已完成：${hit.text}`
    }
    case 'delete_todo': {
      const todos = readStored<Todo[]>('todos', [])
      const hit = findTodo(todos, args.id ? String(args.id) : undefined, args.text ? String(args.text) : undefined)
      if (!hit) return '没有找到这条待办。'
      writeStored<Todo[]>(
        'todos',
        todos.filter((t) => t.id !== hit.id),
      )
      return `已删除：${hit.text}`
    }
    case 'list_todos': {
      const todos = readStored<Todo[]>('todos', [])
      if (!todos.length) return '目前没有待办。'
      return todos.map((t) => `${t.done ? '[x]' : '[ ]'} ${t.text} (${t.id})`).join('\n')
    }
    case 'write_note': {
      const content = String(args.content ?? '')
      const mode = args.mode === 'replace' ? 'replace' : 'append'
      const current = readStored<string>('note', '')
      const next = mode === 'replace' ? content : current ? `${current.trim()}\n${content}` : content
      writeStored('note', next)
      return mode === 'replace' ? '便签已覆盖。' : '便签已追加。'
    }
    case 'read_note': {
      const note = readStored<string>('note', '')
      return note.trim() ? note : '便签是空的。'
    }
    case 'add_bookmark': {
      const name = String(args.name ?? '').trim()
      const url = String(args.url ?? '').trim()
      if (!name || !url) return '书签需要名称和网址。'
      const groupName = String(args.group ?? '常用').trim() || '常用'
      const groups = readStored<BookmarkGroup[]>('bookmarks', [])
      const item = { id: uid(), name, url }
      const exists = groups.some((g) => g.name === groupName)
      const next = exists
        ? groups.map((g) => (g.name === groupName ? { ...g, items: [...g.items, item] } : g))
        : [...groups, { id: uid(), name: groupName, items: [item] }]
      writeStored<BookmarkGroup[]>('bookmarks', next)
      return `已把「${name}」加到${groupName}。`
    }
    case 'open_page': {
      const page = String(args.page ?? '')
      if (!isPageId(page)) return '没有这个分页。'
      host.openPage(page)
      return `已打开${page}。`
    }
    default:
      return `还不会这个工具：${name}`
  }
}
