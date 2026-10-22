import {createToolFactory, type AgentToolSchema, type ToolContext, type ToolDefinition} from '@tulai-design/agent-core'
import {removeData} from './componentData'
import * as ops from './ops'
import {WorkspaceError} from './ops'
import {getDefinition, listDefinitions} from './registry'
import {getWorkspace, commit} from './workspaceStore'

/**
 * AI 可调用的工作空间工具。
 *
 * AI 不直接碰 localStorage 或 React 状态，它只能调用这里列出的操作；
 * 每个操作内部都走 ops.ts 的纯函数，提交进 workspaceStore，因此：
 *   - 参数在 ops 里被校验和规整，AI 给的坏配置进不了工作空间
 *   - 每次修改都进撤销栈，用户随时可以回退
 *   - effect 如实声明，删除类操作被标成高危，走审批
 */

export type ToolHost = {
  /** 跳到某个页面（只影响当前视图，不改数据）。 */
  openPage: (pageId: string) => void
}

export type HomeToolContext = ToolContext<void> & ToolHost

const define = createToolFactory<HomeToolContext, void>()

type Obj = Record<string, unknown>
const obj = (raw: unknown): Obj => (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Obj) : {})
const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const optStr = (value: unknown): string | undefined => str(value) || undefined
const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

/** 让一个操作的错误变成给模型看的文字，而不是抛出去中断整轮对话。 */
async function guard(run: () => string): Promise<string> {
  try {
    return run()
  } catch (error) {
    if (error instanceof WorkspaceError) return `没有成功：${error.message}`
    throw error
  }
}

const describeComponent = (instance: {id: string; type: string; title?: string; span?: string; config: Obj}) =>
  `${instance.id}｜${instance.title ?? getDefinition(instance.type as never)?.name ?? instance.type}｜${instance.type}｜${instance.span ?? '默认'}｜${JSON.stringify(instance.config)}`

export const HOME_TOOLS = [
  // ───── 读：了解现状 ─────
  define(
    {schema: {parse: obj}, json: {type: 'object', properties: {}}},
    {
      name: 'list_component_types',
      title: '查看可用组件',
      description: '列出所有可添加的组件类型，含用途、可配置项和默认值。添加或配置组件前先看这个。',
      effect: 'read',
      highRisk: () => false,
      execute: async () =>
        listDefinitions()
          .map((definition) => {
            const fields = Object.entries(definition.configSchema)
              .map(([key, field]) => {
                const extra = field.kind === 'select' ? `，可选 ${field.options.map((o) => o.value).join('/')}` : field.kind === 'number' ? `，范围 ${field.min ?? '-'}~${field.max ?? '-'}` : ''
                return `    ${key}（${field.kind}）${field.label}${field.description ? `：${field.description}` : ''}${extra}`
              })
              .join('\n')
            return `${definition.type}｜${definition.name}｜${definition.multiple ? '可多个' : '仅一个'}｜默认宽度 ${definition.defaultSpan}\n  ${definition.description}\n  默认配置 ${JSON.stringify(definition.defaultConfig)}${fields ? `\n${fields}` : ''}`
          })
          .join('\n\n'),
    },
  ),
  define(
    {schema: {parse: obj}, json: {type: 'object', properties: {}}},
    {
      name: 'get_workspace',
      title: '查看工作空间',
      description: '查看当前所有页面，以及每页上的组件（id、名称、类型、宽度、配置）。修改前先看清现状。',
      effect: 'read',
      highRisk: () => false,
      execute: async () => {
        const workspace = getWorkspace()
        const pages = workspace.pages
          .map((page) => `# ${page.id}｜${page.name}｜${page.components.length} 个组件\n${page.components.map((c) => `  - ${describeComponent(c)}`).join('\n') || '  （空）'}`)
          .join('\n')
        return `${pages}\n\n主题：${workspace.theme.mode}｜预设 ${workspace.theme.preset}｜覆盖 ${JSON.stringify(workspace.theme.overrides)}`
      },
    },
  ),

  // ───── 写：页面 ─────
  define(
    {
      schema: {parse: (raw) => ({name: str(obj(raw).name), label: optStr(obj(raw).label)})},
      json: {
        type: 'object',
        properties: {name: {type: 'string', description: '页面名称'}, label: {type: 'string', description: '侧栏短标签，不超过 4 字'}},
        required: ['name'],
      },
    },
    {
      name: 'add_page',
      title: '新建页面',
      description: '新建一个空页面，之后用 add_component 往里放组件。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          const result = ops.addPage(getWorkspace(), args)
          commit(result.workspace)
          return `已新建页面「${result.page.name}」，id=${result.page.id}。`
        }),
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({pageId: str(obj(raw).pageId), name: optStr(obj(raw).name), label: optStr(obj(raw).label)})},
      json: {
        type: 'object',
        properties: {pageId: {type: 'string'}, name: {type: 'string'}, label: {type: 'string'}},
        required: ['pageId'],
      },
    },
    {
      name: 'rename_page',
      title: '重命名页面',
      description: '修改页面的名称或侧栏标签。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          commit(ops.renamePage(getWorkspace(), args.pageId, args))
          return `已更新页面 ${args.pageId}。`
        }),
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({pageId: str(obj(raw).pageId)})},
      json: {type: 'object', properties: {pageId: {type: 'string'}}, required: ['pageId']},
    },
    {
      name: 'remove_page',
      title: '删除页面',
      description: '删除一个页面及其全部组件和组件数据。至少保留一个页面。',
      effect: 'write',
      highRisk: () => true,
      execute: (args) =>
        guard(() => {
          const workspace = getWorkspace()
          const page = workspace.pages.find((item) => item.id === args.pageId)
          const next = ops.removePage(workspace, args.pageId)
          page?.components.forEach((component) => removeData(component.id))
          commit(next)
          return `已删除页面 ${args.pageId}（含 ${page?.components.length ?? 0} 个组件）。`
        }),
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({pageId: str(obj(raw).pageId), toIndex: num(obj(raw).toIndex) ?? 0})},
      json: {
        type: 'object',
        properties: {pageId: {type: 'string'}, toIndex: {type: 'number', description: '目标位置，从 0 开始'}},
        required: ['pageId', 'toIndex'],
      },
    },
    {
      name: 'move_page',
      title: '调整页面顺序',
      description: '改变页面在侧栏中的位置。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          commit(ops.movePage(getWorkspace(), args.pageId, args.toIndex))
          return `已把页面 ${args.pageId} 移到第 ${args.toIndex + 1} 位。`
        }),
    },
  ),

  // ───── 写：组件 ─────
  define(
    {
      schema: {
        parse: (raw) => {
          const value = obj(raw)
          return {pageId: str(value.pageId), type: str(value.type), config: value.config, span: optStr(value.span), title: optStr(value.title), index: num(value.index)}
        },
      },
      json: {
        type: 'object',
        properties: {
          pageId: {type: 'string'},
          type: {type: 'string', description: '组件类型，见 list_component_types'},
          config: {type: 'object', description: '组件配置，只能包含该组件声明过的字段'},
          span: {type: 'string', enum: ['full', 'two-thirds', 'half', 'third'], description: '宽度'},
          title: {type: 'string', description: '给这一块起个名字，方便之后指代'},
          index: {type: 'number', description: '插入位置，不填放最后'},
        },
        required: ['pageId', 'type'],
      },
    },
    {
      name: 'add_component',
      title: '添加组件',
      description: '往某个页面添加一个组件。配置字段以 list_component_types 返回的为准，未声明的字段会被忽略。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          const result = ops.addComponent(getWorkspace(), args)
          commit(result.workspace)
          return `已添加：${describeComponent(result.instance)}`
        }),
    },
  ),
  define(
    {
      schema: {
        parse: (raw) => {
          const value = obj(raw)
          return {ref: str(value.ref), pageId: optStr(value.pageId), config: value.config, span: optStr(value.span), title: value.title === null ? null : optStr(value.title)}
        },
      },
      json: {
        type: 'object',
        properties: {
          ref: {type: 'string', description: '组件 id，或它的标题/类型（有歧义时会报错）'},
          pageId: {type: 'string', description: '限定在某一页内查找'},
          config: {type: 'object', description: '要修改的配置字段，只写变化的部分'},
          span: {type: 'string', enum: ['full', 'two-thirds', 'half', 'third']},
          title: {type: 'string', description: '新标题；传空字符串清除'},
        },
        required: ['ref'],
      },
    },
    {
      name: 'update_component',
      title: '修改组件',
      description: '修改组件的配置、宽度或标题。config 只需写要变的字段。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          const result = ops.updateComponent(getWorkspace(), args.ref, args, args.pageId)
          commit(result.workspace)
          return `已更新：${describeComponent(result.instance)}`
        }),
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({ref: str(obj(raw).ref), pageId: optStr(obj(raw).pageId)})},
      json: {
        type: 'object',
        properties: {ref: {type: 'string'}, pageId: {type: 'string'}},
        required: ['ref'],
      },
    },
    {
      name: 'remove_component',
      title: '删除组件',
      description: '删除一个组件，连同它保存的数据（待办、便签内容等）。',
      effect: 'write',
      highRisk: () => true,
      execute: (args) =>
        guard(() => {
          const result = ops.removeComponent(getWorkspace(), args.ref, args.pageId)
          removeData(result.removed.id)
          commit(result.workspace)
          return `已删除：${describeComponent(result.removed)}`
        }),
    },
  ),
  define(
    {
      schema: {
        parse: (raw) => {
          const value = obj(raw)
          return {ref: str(value.ref), pageId: optStr(value.pageId), toPageId: optStr(value.toPageId), toIndex: num(value.toIndex)}
        },
      },
      json: {
        type: 'object',
        properties: {
          ref: {type: 'string'},
          pageId: {type: 'string', description: '组件当前所在页，用于消除歧义'},
          toPageId: {type: 'string', description: '目标页；不填则在当前页内调整'},
          toIndex: {type: 'number', description: '目标位置，从 0 开始；不填放最后'},
        },
        required: ['ref'],
      },
    },
    {
      name: 'move_component',
      title: '移动组件',
      description: '调整组件在页内的顺序，或把它移到另一个页面。组件的数据随它一起走。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          commit(ops.moveComponent(getWorkspace(), args.ref, args, args.pageId))
          return `已移动组件 ${args.ref}。`
        }),
    },
  ),

  // ───── 写：主题 ─────
  define(
    {
      schema: {
        parse: (raw) => {
          const value = obj(raw)
          const overrides = value.overrides === null ? null : value.overrides && typeof value.overrides === 'object' ? (value.overrides as Record<string, string>) : undefined
          return {mode: optStr(value.mode), overrides}
        },
      },
      json: {
        type: 'object',
        properties: {
          mode: {type: 'string', enum: ['light', 'dark']},
          overrides: {type: 'object', description: 'CSS 变量覆盖，键不带 `--`，例如 {"main":"#2b6cf6","radius":"8px"}；传 null 清空'},
        },
      },
    },
    {
      name: 'set_theme',
      title: '调整主题',
      description: '切换明暗，或覆盖主题变量（如 main 主色、bg 背景、text 文字、radius 圆角）。只写要改的变量。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          commit(ops.setTheme(getWorkspace(), args))
          return '主题已更新。'
        }),
    },
  ),

  define(
    {
      schema: {
        parse: (raw) => {
          const value = obj(raw)
          return {pageId: str(value.pageId), mode: str(value.mode), index: num(value.index), url: optStr(value.url)}
        },
      },
      json: {
        type: 'object',
        properties: {
          pageId: {type: 'string'},
          mode: {type: 'string', enum: ['off', 'unsplash', 'custom'], description: 'off 无壁纸；unsplash 内置图库；custom 自定义图片地址'},
          index: {type: 'number', description: 'unsplash 模式下选第几张，从 0 开始'},
          url: {type: 'string', description: 'custom 模式下的 http(s) 图片地址'},
        },
        required: ['pageId', 'mode'],
      },
    },
    {
      name: 'set_wallpaper',
      title: '设置页面壁纸',
      description: '给某个页面设置背景壁纸，每个页面各自独立。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          commit(ops.setWallpaper(getWorkspace(), args.pageId, args))
          return `已更新页面 ${args.pageId} 的壁纸。`
        }),
    },
  ),

  // ───── 自定义组件 ─────
  define(
    {schema: {parse: obj}, json: {type: 'object', properties: {}}},
    {
      name: 'list_custom_widgets',
      title: '查看自定义组件',
      description: '列出用户已创建的自定义组件及其规格。改它们之前先看。',
      effect: 'read',
      highRisk: () => false,
      execute: async () => {
        const { widgets } = getWorkspace()
        if (!widgets.length) return '还没有自定义组件。可以用 create_widget 建一个。'
        return widgets
          .map((w) => `custom:${w.id}｜${w.name}｜${w.layout}｜${w.source.kind === 'http' ? w.source.url : '静态数据'}\n  ${w.description || '（无描述）'}`)
          .join('\n')
      },
    },
  ),
  define(
    {schema: {parse: obj}, json: {type: 'object', properties: {}, description: '完整规格，见 describe'}},
    {
      name: 'create_widget',
      title: '创建自定义组件',
      description: [
        '造一个现有组件类型里没有的新组件。你写的是声明式规格，不是代码。',
        '规格字段：',
        '  name（必填，不超过 24 字）、description、layout（必填）',
        '    - list 列表 / cards 卡片 / stats 大数字 / text 段落 / links 链接墙：需要 item 和 source',
        '    - art 图形：直接画 SVG，需要 svg 字段，不需要 item 和 source。',
        '      svg 必须是完整的 <svg ...>...</svg>，可用元素：g path circle ellipse rect line polyline polygon text tspan',
        '      linearGradient radialGradient stop clipPath mask filter 等；不能含 script、事件属性、外部链接。',
        '  item（必填）：{title:{path}, subtitle?, meta?, link?}，path 用点号取字段，例如 "author.name"；prefix 可加前缀文字',
        '  source（必填）：静态 {kind:"static", items:[{...}]}，或接口 {kind:"http", url, path?, every?}',
        '    - http 的 url 必须是 http(s)；域名需要用户授权后才能取数，未授权时组件会提示用户点击允许',
        '    - path 指定从响应里取数组的路径，例如 "data.list"；留空表示响应本身就是数组',
        '    - every 是最短 60 秒的重取间隔',
        '  emptyText、options:{limit, numbered}',
        '建好后用 add_component 把 custom:<返回的id> 放到页面上。',
      ].join('\n'),
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          const result = ops.createWidget(getWorkspace(), args)
          commit(result.workspace)
          return `已创建自定义组件 custom:${result.widget.id}（${result.widget.name}）。用 add_component 把它放到页面上。`
        }),
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({id: str(obj(raw).id), spec: obj(raw).spec})},
      json: {
        type: 'object',
        properties: {id: {type: 'string', description: '自定义组件 id（不含 custom: 前缀）'}, spec: {type: 'object', description: '与 create_widget 相同结构的完整规格'}},
        required: ['id', 'spec'],
      },
    },
    {
      name: 'update_widget',
      title: '修改自定义组件',
      description: '改一个自定义组件的规格（字段同 create_widget，需要给完整规格）。页面上引用它的组件会立即跟着变。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          const result = ops.updateWidget(getWorkspace(), args.id, args.spec)
          commit(result.workspace)
          return `已更新 custom:${result.widget.id}（${result.widget.name}）。`
        }),
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({id: str(obj(raw).id)})},
      json: {type: 'object', properties: {id: {type: 'string'}}, required: ['id']},
    },
    {
      name: 'remove_widget',
      title: '删除自定义组件',
      description: '删除一个自定义组件，以及页面上引用它的所有实例。',
      effect: 'write',
      highRisk: () => true,
      execute: (args) =>
        guard(() => {
          const result = ops.removeWidget(getWorkspace(), args.id)
          commit(result.workspace)
          return `已删除 custom:${args.id}（${result.removed.name}），同时移除了 ${result.instances.length} 处引用。`
        }),
    },
  ),

  // ───── 外观 ─────
  define(
    {
      schema: {
        parse: (raw) => ({ref: str(obj(raw).ref), pageId: optStr(obj(raw).pageId), look: obj(raw).look}),
      },
      json: {
        type: 'object',
        properties: {
          ref: {type: 'string', description: '组件 id 或标题'},
          pageId: {type: 'string'},
          look: {
            type: 'object',
            description:
              '外观：{variant, tone, titleSize, animation, css}。css 写纯属性声明，例如 "border-radius: 18px; box-shadow: 0 8px 30px rgb(0 0 0 / 12%)"；不要写选择器和花括号。',
            properties: {
              variant: {type: 'string', enum: ['plain', 'card', 'accent', 'quiet']},
              tone: {type: 'string', enum: ['neutral', 'main', 'green', 'blue', 'amber', 'violet']},
              titleSize: {type: 'string', enum: ['sm', 'md', 'lg']},
              animation: {type: 'string', enum: ['none', 'fade-in', 'pulse-soft', 'float', 'spin-slow']},
              css: {type: 'string', description: '自定义 CSS 声明，不含花括号'},
            },
          },
        },
        required: ['ref', 'look'],
      },
    },
    {
      name: 'set_appearance',
      title: '调整组件外观',
      description: [
        '改单个组件的样式，不改内容和数据。两种用法：',
        '1. 预设档位：variant（plain 无边框 / card 卡片 / accent 左侧彩条 / quiet 淡底）、tone（强调色）、titleSize（标题字号）、animation（预置动画）',
        '2. 自定义 CSS：css 字段写纯属性声明，例如 "background: linear-gradient(135deg,#f6d365,#fda085); border-radius: 20px; box-shadow: 0 10px 40px rgb(0 0 0 / 15%)"。',
        '   只作用于这一块，不要写选择器、花括号、@import、url(http...)。',
        '想做出独特的视觉效果时用 css；只要统一感时用预设档位。',
      ].join('\n'),
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          const result = ops.updateComponent(getWorkspace(), args.ref, {look: args.look}, args.pageId)
          commit(result.workspace)
          return `已调整外观：${describeComponent(result.instance)}`
        }),
    },
  ),
  define(
    {
      schema: {
        parse: (raw) => ({pageId: str(obj(raw).pageId), css: obj(raw).css === null ? null : optStr(obj(raw).css), align: optStr(obj(raw).align)}),
      },
      json: {
        type: 'object',
        properties: {
          pageId: {type: 'string'},
          css: {type: 'string', description: '整页样式声明，不含花括号；传 null 清除'},
          align: {type: 'string', enum: ['start', 'center'], description: '内容对齐'},
        },
        required: ['pageId'],
      },
    },
    {
      name: 'set_page_style',
      title: '调整页面样式',
      description: '改整页的样式：内容对齐，以及作用在内容容器上的 CSS 声明（例如内边距、最大宽度之外的整体观感）。同样不接受选择器和花括号。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          commit(ops.setPageStyle(getWorkspace(), args.pageId, args))
          return `已更新页面 ${args.pageId} 的样式。`
        }),
    },
  ),

  // ───── 网络授权 ─────
  define(
    {schema: {parse: obj}, json: {type: 'object', properties: {}}},
    {
      name: 'list_network_grants',
      title: '查看已授权域名',
      description: '列出用户已允许访问的域名。创建要联网的组件前先看，避免重复申请。',
      effect: 'read',
      highRisk: () => false,
      execute: async () => {
        const { network } = getWorkspace()
        if (!network.length) return '还没有授权任何域名。'
        return network.map((g) => `${g.host}（${new Date(g.grantedAt).toLocaleDateString('zh-CN')} 授权）`).join('\n')
      },
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({host: str(obj(raw).host)})},
      json: {type: 'object', properties: {host: {type: 'string', description: '域名，例如 api.github.com'}}, required: ['host']},
    },
    {
      name: 'request_network_grant',
      title: '申请域名授权',
      description: '为一个还没授权的域名请求用户同意。用户必须明确允许，之后才能在该域名上取数。',
      effect: 'write',
      highRisk: () => true,
      execute: (args) =>
        guard(() => {
          const next = ops.grantHost(getWorkspace(), args.host)
          commit(next)
          return `已授权 ${args.host}。`
        }),
    },
  ),

  // ───── 视图 ─────
  define(
    {
      schema: {parse: (raw) => ({pageId: str(obj(raw).pageId)})},
      json: {type: 'object', properties: {pageId: {type: 'string'}}, required: ['pageId']},
    },
    {
      name: 'open_page',
      title: '打开页面',
      description: '切换到某个页面查看。只改变当前视图，不修改任何数据。',
      effect: 'read',
      highRisk: () => false,
      execute: async (args, context) => {
        if (!getWorkspace().pages.some((page) => page.id === args.pageId)) return `没有这个页面：${args.pageId}`
        context.openPage(args.pageId)
        return `已打开 ${args.pageId}。`
      },
    },
  ),
] as const

type AnyHomeTool = ToolDefinition<unknown, HomeToolContext, void, unknown>

export function toolSchemas(): AgentToolSchema[] {
  return HOME_TOOLS.map((tool) => ({
    type: 'function',
    function: {name: tool.name, description: tool.description, parameters: tool.parameters},
  }))
}

export function findTool(name: string): AnyHomeTool | undefined {
  return HOME_TOOLS.find((tool) => tool.name === name) as AnyHomeTool | undefined
}

export async function runTool(tool: AnyHomeTool, args: unknown, context: HomeToolContext): Promise<string> {
  return String(await tool.execute(args, context))
}
