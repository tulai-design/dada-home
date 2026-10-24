import {createToolFactory, type AgentToolSchema, type ToolContext, type ToolDefinition} from '@tulai-design/agent-core'
import {removeData} from './componentData'
import * as ops from './ops'
import {WorkspaceError} from './errors'
import {FX_DEFS, describeFx, getFx} from '../fx/catalog'
import {getDefinition, listDefinitions} from './registry'
import {getWorkspace, commit} from './workspaceStore'
import {PAGE_ICON_KEYS} from './pageIcons'
import {ADDONS, isInstalled, typeAvailable} from './market'
import {NO_EXTENSION_HINT, SYNC_FOLDER, call, detect, importFromBrowser, listBrowser, pushToBrowser} from './browserBookmarks'
import {addBookmarks, countBookmarks, getBookmarks, removeBookmarks, removeGroup, renameGroup, setBookmarks, updateBookmark} from './bookmarks'
import {activeTheme} from './workspace'
import {PRESETS} from './presets'
import {MEMORY_KINDS, addMemory, aiEditSoul, getPersona, removeMemory} from './persona'
import {isSynced, summarize} from './templates'
import {DOCK_GUIDE, DOCK_PRESETS} from './dock'
import {SITE_TOOLS} from './siteTools'
import {SEARCH_TOOLS} from './searchTools'
import {LIFE_TOOLS} from './lifeTools'

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
  /** 打开设置页的某一项（不改数据）。 */
  openSettings?: (section?: string) => void
}

export type HomeToolContext = ToolContext<void> & ToolHost

const define = createToolFactory<HomeToolContext, void>()

type Obj = Record<string, unknown>
const obj = (raw: unknown): Obj => (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Obj) : {})
const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const optStr = (value: unknown): string | undefined => str(value) || undefined
const strList = (value: unknown): string[] => (Array.isArray(value) ? value.map(str).filter(Boolean) : [])
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

/** 调浏览器扩展：没连上就回一句引导，而不是抛错中断整轮对话。 */
async function bridge(run: () => Promise<string>): Promise<string> {
  try {
    // 先快速确认扩展在，没装就别干等 8 秒超时
    if (!(await detect(1200))) return NO_EXTENSION_HINT
    return await run()
  } catch (error) {
    if (error instanceof Error && error.message === 'NO_EXTENSION') return NO_EXTENSION_HINT
    return `没有成功：${error instanceof Error ? error.message : String(error)}`
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
      description: '列出当前可添加的组件类型（已安装的），含用途、可配置项和默认值。添加或配置组件前先看这个。没装的市场组件不在这里，用 list_addons 看。',
      effect: 'read',
      highRisk: () => false,
      execute: async () =>
        listDefinitions()
          .filter((definition) => typeAvailable(getWorkspace(), definition.type))
          .map((definition) => {
            const fields = Object.entries(definition.configSchema)
              .map(([key, field]) => {
                const extra = field.kind === 'select' ? `，可选 ${field.options.map((o) => o.value).join('/')}` : field.kind === 'number' ? `，范围 ${field.min ?? '-'}~${field.max ?? '-'}` : ''
                return `    ${key}（${field.kind}）${field.label}${field.description ? `：${field.description}` : ''}${extra}`
              })
              .join('\n')
            return `${definition.type}｜${definition.name}｜${definition.multiple ? '可多个' : '仅一个'}｜默认宽度 ${definition.defaultSpan}${definition.status ? '｜可放状态条' : ''}\n  ${definition.description}\n  默认配置 ${JSON.stringify(definition.defaultConfig)}${fields ? `\n${fields}` : ''}`
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
          .map((page) => `# ${page.id}｜${page.name}｜图标 ${page.icon ?? '默认'}｜${page.components.length} 个组件${page.id === 'home' ? '｜固定项' : ''}\n${page.components.map((c) => `  - ${describeComponent(c)}`).join('\n') || '  （空）'}`)
          .join('\n')
        const status = workspace.statusbar.map((item) => `${item.type} ${JSON.stringify(item.config)}`).join('；') || '（空）'
        const addons = workspace.addons.map((id) => ADDONS.find((a) => a.id === id)?.name ?? id).join('、') || '（无）'
        return `${pages}\n\n已安装的市场组件：${addons}\n状态条：${status}\nDock：${workspace.dock ? `${workspace.dock.preset}${workspace.dock.css ? ' + 自定义 CSS' : ''}` : '默认（拟态液体玻璃）'}，用 get_dock / set_dock\n主题：${activeTheme(workspace).name}（${activeTheme(workspace).id}）｜明暗 ${workspace.theme.mode}｜主题库 ${workspace.themes.length} 个，用 list_themes 查看\n模板库：我的 ${workspace.templates.length} 个 + 内置预设，用 list_templates 查看`
      },
    },
  ),

  // ───── 写：页面 ─────
  define(
    {
      schema: {parse: (raw) => ({name: str(obj(raw).name), label: optStr(obj(raw).label), icon: optStr(obj(raw).icon)})},
      json: {
        type: 'object',
        properties: {
          name: {type: 'string', description: '页面名称'},
          label: {type: 'string', description: '侧栏短标签，不超过 4 字'},
          icon: {type: 'string', enum: PAGE_ICON_KEYS, description: '侧栏图标，按页面内容挑一个贴切的'},
        },
        required: ['name'],
      },
    },
    {
      name: 'add_page',
      title: '新建页面',
      description: '新建一个空页面，之后用 add_component 往里放组件。页面会出现在侧栏；页面多了侧栏会自动把放不下的收进「更多」，不用担心。务必给一个贴切的图标。',
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
      schema: {parse: (raw) => ({pageId: str(obj(raw).pageId), name: optStr(obj(raw).name), label: optStr(obj(raw).label), icon: optStr(obj(raw).icon)})},
      json: {
        type: 'object',
        properties: {pageId: {type: 'string'}, name: {type: 'string'}, label: {type: 'string'}, icon: {type: 'string', enum: PAGE_ICON_KEYS}},
        required: ['pageId'],
      },
    },
    {
      name: 'rename_page',
      title: '重命名页面',
      description: '修改页面的名称、侧栏标签或图标。首页是固定项，不能改。',
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
      description: '删除一个页面及其全部组件和组件数据。首页是固定项，不能删除。',
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
      description: '改变页面在侧栏中的位置。首页固定在第一位，其他页面最靠前是第二位。靠前的页面在侧栏里优先显示。',
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
      description:
        '微调当前主题：切换明暗，或覆盖变量（main 主色、bg 背景、bg2、text 文字、radius 圆角等），只写要改的。当前是默认主题时会自动另存为「自定义 N」再改，默认主题不会被改坏。要整套新风格并起名保存，用 save_theme。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          const result = ops.setTheme(getWorkspace(), args)
          commit(result.workspace)
          return result.forked ? `当前是默认主题，已另存为「${result.forked.name}」并应用修改。想起个名字可以用 save_theme。` : '主题已更新。'
        }),
    },
  ),

  // ───── 主题库 ─────
  define(
    {schema: {parse: obj}, json: {type: 'object', properties: {}}},
    {
      name: 'list_themes',
      title: '查看主题库',
      description: '列出所有存下来的主题（含默认主题）：id、名字、说明、变量、是否正在使用。用户想换主题、回到默认、或你要新做一个之前先看这个。',
      effect: 'read',
      highRisk: () => false,
      execute: async () => {
        const workspace = getWorkspace()
        return workspace.themes
          .map((item) => `${item.id}｜${item.name}｜${item.id === workspace.theme.active ? '使用中' : '未使用'}${item.builtin ? '｜默认（不可改删）' : ''}${item.mode ? `｜自带${item.mode}` : ''}\n  ${item.description || '（无说明）'}\n  变量 ${JSON.stringify(item.overrides)}`)
          .join('\n')
      },
    },
  ),
  define(
    {
      schema: {
        parse: (raw) => {
          const value = obj(raw)
          return {id: optStr(value.id), name: optStr(value.name), description: optStr(value.description), overrides: value.overrides, mode: optStr(value.mode), activate: value.activate === false ? false : undefined}
        },
      },
      json: {
        type: 'object',
        properties: {
          name: {type: 'string', description: '主题名，20 字以内，例如「深海」「黄昏」'},
          description: {type: 'string', description: '一两句话说明这个主题的气质，之后在列表里看'},
          overrides: {type: 'object', description: 'CSS 变量覆盖，键不带 `--`：main 主色、bg/bg2/bg3 背景层级、text/text2/text3 文字层级、radius 圆角等'},
          mode: {type: 'string', enum: ['light', 'dark'], description: '主题自带的明暗；启用时会一并切过去'},
          id: {type: 'string', description: '要更新的已有主题 id；不填则按名字匹配，匹配不到就新建'},
          activate: {type: 'boolean', description: '存完是否立刻启用，默认启用'},
        },
      },
    },
    {
      name: 'save_theme',
      title: '保存主题',
      description:
        '把一套配色存进主题库并（默认）启用。用户让你「做一个xx风格的主题」时用这个：起一个好记的名字、写一句说明、给出完整的变量。同名或同 id 的会被更新；默认主题不能改。深色类主题记得带 mode:"dark" 并把 bg/text 一起配好。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          const result = ops.saveTheme(getWorkspace(), args)
          commit(result.workspace)
          return `${result.created ? '已新建' : '已更新'}主题「${result.theme.name}」（${result.theme.id}）${args.activate === false ? '，未启用' : '，并已启用'}。`
        }),
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({ref: str(obj(raw).ref)})},
      json: {type: 'object', properties: {ref: {type: 'string', description: '主题 id 或名字；回到默认就传 default'}}, required: ['ref']},
    },
    {
      name: 'apply_theme',
      title: '切换主题',
      description: '切换到主题库里的某个主题。「换回默认」「还原」就是 ref:"default"。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          const result = ops.applyTheme(getWorkspace(), args.ref)
          commit(result.workspace)
          return `已切换到主题「${result.theme.name}」。`
        }),
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({ref: str(obj(raw).ref)})},
      json: {type: 'object', properties: {ref: {type: 'string', description: '主题 id 或名字'}}, required: ['ref']},
    },
    {
      name: 'delete_theme',
      title: '删除主题',
      description: '从主题库删掉一个主题。正在使用的会回到默认主题；默认主题删不掉。',
      effect: 'write',
      highRisk: () => true,
      execute: (args) =>
        guard(() => {
          const result = ops.removeTheme(getWorkspace(), args.ref)
          commit(result.workspace)
          return `已删除主题「${result.removed.name}」。`
        }),
    },
  ),

  // ───── 模板库 ─────
  define(
    {schema: {parse: obj}, json: {type: 'object', properties: {}}},
    {
      name: 'list_templates',
      title: '查看模板库',
      description: '列出所有页面模板：用户存下来的，和内置预设。模板是整套页面设计（页面、组件、状态条、版式、主题）的快照。用户想「换一套布局」「回到之前那版」「有没有现成的模板」时先看这个。',
      effect: 'read',
      highRisk: () => false,
      execute: async () => {
        const workspace = getWorkspace()
        const own = workspace.templates.map(
          (item) => `${item.id}｜${item.name}｜${item.id === workspace.template ? '最近使用' : '未使用'}｜${isSynced(workspace, item) ? '与当前一致' : '与当前不同'}\n  ${item.description || '（无说明）'}\n  ${summarize(item.snapshot)}`,
        )
        const presets = PRESETS.map((item) => `${item.id}｜${item.name}｜内置预设（不可改删）\n  ${item.description}\n  包含：${item.tags.join('、')}`)
        return `【我的模板】\n${own.join('\n') || '（还没有）'}\n\n【内置预设】\n${presets.join('\n')}`
      },
    },
  ),
  define(
    {
      schema: {
        parse: (raw) => {
          const value = obj(raw)
          return {id: optStr(value.id), name: optStr(value.name), description: optStr(value.description), withTheme: value.withTheme === false ? false : undefined}
        },
      },
      json: {
        type: 'object',
        properties: {
          name: {type: 'string', description: '模板名，20 字以内，例如「工作日」「周末」'},
          description: {type: 'string', description: '一两句话说明这套布局适合什么场景'},
          id: {type: 'string', description: '要覆盖更新的已有模板 id；不填则按名字匹配，匹配不到就新建'},
          withTheme: {type: 'boolean', description: '是否把当前主题一起存进去，默认是'},
        },
      },
    },
    {
      name: 'save_template',
      title: '保存模板',
      description:
        '把当前整套页面设计（所有页面和组件、状态条、版式、自定义组件、已装的市场组件，默认含当前主题）存成模板。组件里的数据（待办、便签等）不会存进去。用户做完一版满意的设计、或想「存一下现在的布局」时用。同名或同 id 的会被更新成当前设计。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          const result = ops.saveTemplate(getWorkspace(), args)
          commit(result.workspace)
          return `${result.created ? '已新建' : '已更新'}模板「${result.template.name}」（${result.template.id}）：${summarize(result.template.snapshot)}。`
        }),
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({ref: str(obj(raw).ref)})},
      json: {type: 'object', properties: {ref: {type: 'string', description: '模板 id 或名字，内置预设也可以（如 preset-night）'}}, required: ['ref']},
    },
    {
      name: 'apply_template',
      title: '套用模板',
      description:
        '套用一个模板：整体替换当前所有页面、组件、状态条、版式和已装的市场组件（带主题的会一并切换）。组件里的数据不动。这会覆盖当前设计，所以套用前如果当前设计还没存过，先问用户要不要 save_template；用户可以用撤销找回。',
      effect: 'write',
      highRisk: () => true,
      execute: (args) =>
        guard(() => {
          const result = ops.applyTemplate(getWorkspace(), args.ref)
          commit(result.workspace)
          return `已套用模板「${result.name}」。`
        }),
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({ref: str(obj(raw).ref)})},
      json: {type: 'object', properties: {ref: {type: 'string', description: '模板 id 或名字'}}, required: ['ref']},
    },
    {
      name: 'delete_template',
      title: '删除模板',
      description: '从模板库删掉一个用户存的模板（只删记录，不影响当前页面）。内置预设删不掉。',
      effect: 'write',
      highRisk: () => true,
      execute: (args) =>
        guard(() => {
          const result = ops.removeTemplate(getWorkspace(), args.ref)
          commit(result.workspace)
          return `已删除模板「${result.removed.name}」。`
        }),
    },
  ),

  // ───── 灵魂与记忆 ─────
  define(
    {
      schema: {parse: (raw) => ({text: str(obj(raw).text), kind: optStr(obj(raw).kind)})},
      json: {
        type: 'object',
        properties: {
          text: {type: 'string', description: '要记住的一件事，一条一事，写成陈述句，100 字以内。例如「喜欢深色、低饱和的页面」「在做前端，常用 React」'},
          kind: {type: 'string', enum: ['preference', 'fact', 'lesson'], description: 'preference 偏好；fact 背景事实；lesson 从用户纠正里学到的做法'},
        },
        required: ['text'],
      },
    },
    {
      name: 'remember',
      title: '记住一件事',
      description: '把关于这个用户的稳定认识存进长期记忆，之后每次对话都会带着它。用户说出偏好、背景、习惯，或纠正你的做法时用。不要记一次性的任务细节，不要记密钥密码；已经记过的别重复记。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          const result = addMemory({text: args.text, kind: args.kind, by: 'ai'})
          return `已记住（${result.memory.id}）：${result.memory.text}`
        }),
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({id: str(obj(raw).id)})},
      json: {type: 'object', properties: {id: {type: 'string', description: '记忆 id，形如 m1a2b3c4，在「你对用户的记忆」里能看到'}}, required: ['id']},
    },
    {
      name: 'forget',
      title: '忘掉一条记忆',
      description: '删掉一条过时、错误或被用户推翻的记忆。用户让你「忘了这个」时用。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          const removed = removeMemory(args.id)
          return `已忘掉：${removed.text}`
        }),
    },
  ),
  define(
    {schema: {parse: obj}, json: {type: 'object', properties: {}}},
    {
      name: 'list_memories',
      title: '查看记忆',
      description: '列出全部长期记忆（含 id）。提示里只带了最近的一部分，需要找较早的、或要整理合并时用。',
      effect: 'read',
      highRisk: () => false,
      execute: async () => {
        const {memory} = getPersona()
        if (!memory.items.length) return '（还没有记忆）'
        return memory.items.map((item) => `${item.id}｜${MEMORY_KINDS[item.kind]}｜${item.by === 'ai' ? '你记的' : '用户写的'}｜${item.text}`).join('\n')
      },
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({mode: str(obj(raw).mode) === 'replace' ? ('replace' as const) : ('append' as const), text: str(obj(raw).text), reason: optStr(obj(raw).reason)})},
      json: {
        type: 'object',
        properties: {
          mode: {type: 'string', enum: ['append', 'replace'], description: 'append：在灵魂末尾追加一两行（小改用这个）；replace：用 text 整体替换灵魂，text 必须是完整的新灵魂'},
          text: {type: 'string', description: 'append 时是要追加的内容；replace 时是完整的新灵魂（Markdown）'},
          reason: {type: 'string', description: '一句话说明为什么改，会记在修改记录里'},
        },
        required: ['text'],
      },
    },
    {
      name: 'update_soul',
      title: '修改灵魂',
      description:
        '修改你自己的「灵魂」（性格、语气、做事原则）。只在用户明确要你换性格 / 语气 / 原则，或明确表达了对你行为方式的长期要求时用；关于用户的事实偏好请用 remember。每次修改都会留下记录，用户可以回滚；用户可以关掉这个权限。改完要告诉用户你改了什么。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          const persona = aiEditSoul(args)
          return `灵魂已更新（${args.mode === 'replace' ? '整体重写' : '追加'}），现在 ${persona.soul.text.length} 字。修改记录里留了一条，用户可以回滚。`
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

  // ───── 素材库：炫酷效果 ─────
  define(
    {
      schema: {parse: (raw) => ({id: optStr(obj(raw).id), kind: optStr(obj(raw).kind)})},
      json: {
        type: 'object',
        properties: {
          id: {type: 'string', description: '效果 id；给了就返回该效果的完整参数表'},
          kind: {type: 'string', enum: ['background', 'text', 'card', 'overlay', 'scene'], description: '只看某一类'},
        },
      },
    },
    {
      name: 'list_effects',
      title: '查看特效素材库',
      description: [
        '素材库里有二十多种现成的炫酷效果（来自 React Bits 和 Spline），你可以像搭积木一样自由组合。不带参数先看概览；要用某个效果，再带 id 查完整参数。',
        '类别：',
        '  background  动态背景（极光、丝绸、光束、星系、虹彩、液态金属、光球、粒子、丝线、波纹线、点阵）→ 用 set_page_layers 铺满整页，或 add_component(type:"fx") 做成横幅块',
        '  text        会动的文字（分字入场、模糊显影、流光、渐变、解码、打字机、轮播词、数字滚动、毛边故障字、滚动字幕）→ add_component(type:"fx")',
        '  card        带光效的卡片（聚光、扫光）→ add_component(type:"fx")',
        '  overlay     整页质感层（胶片颗粒、点击火花）→ 只能 set_page_layers',
        '  scene       Spline 3D 场景 → 整页图层或横幅块',
        '组装思路：整页背景图层（1~2 层）+ 一个大标题特效块 + 若干信息组件。图层最多 3 层，别叠太多，保持可读。',
      ].join('\n'),
      effect: 'read',
      highRisk: () => false,
      execute: async (args) => {
        if (args.id) {
          const def = getFx(args.id)
          if (!def) return `没有这个效果：${args.id}。可用：${FX_DEFS.map((d) => d.id).join('、')}`
          return JSON.stringify(describeFx(def), null, 1)
        }
        return FX_DEFS.filter((def) => !args.kind || def.kind === args.kind)
          .map((def) => {
            const info = describeFx(def)
            return `${def.id}｜${def.name}｜${def.kind}｜可用于 ${info.use.join('+')}\n  ${def.description}\n  参数：${Object.keys(def.params).join('、') || '无'}`
          })
          .join('\n')
      },
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({pageId: str(obj(raw).pageId), layers: Array.isArray(obj(raw).layers) ? (obj(raw).layers as unknown[]) : []})},
      json: {
        type: 'object',
        properties: {
          pageId: {type: 'string'},
          layers: {
            type: 'array',
            description: '图层数组，最多 3 层，整体替换。传 [] 清空。靠前的在下面。',
            items: {
              type: 'object',
              properties: {
                effect: {type: 'string', description: 'background / scene / overlay 类效果的 id'},
                params: {type: 'object', description: '效果参数，键见 list_effects(id)；省略的参数用设计好的默认值'},
              },
              required: ['effect'],
            },
          },
        },
        required: ['pageId', 'layers'],
      },
    },
    {
      name: 'set_page_layers',
      title: '设置页面特效图层',
      description:
        '给整页铺动态背景或叠质感层，整体替换该页现有图层。例如 [{"effect":"aurora","params":{"colorStops":["#ff5a3c","#ffb86b","#7c5cff"]}},{"effect":"noise"}]。文字、卡片类效果不能当图层，请用 add_component(type:"fx")。设置后用户立刻能看到。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          commit(ops.setLayers(getWorkspace(), args.pageId, args.layers))
          return `已更新页面 ${args.pageId} 的特效图层（${args.layers.length} 层）。`
        }),
    },
  ),

  // ───── 沙盒应用：最大自由度 ─────
  define(
    {
      schema: {
        parse: (raw) => ({
          pageId: str(obj(raw).pageId),
          title: optStr(obj(raw).title),
          html: typeof obj(raw).html === 'string' ? (obj(raw).html as string) : '',
          css: typeof obj(raw).css === 'string' ? (obj(raw).css as string) : '',
          js: typeof obj(raw).js === 'string' ? (obj(raw).js as string) : '',
          height: num(obj(raw).height),
          span: optStr(obj(raw).span),
        }),
      },
      json: {
        type: 'object',
        properties: {
          pageId: {type: 'string'},
          title: {type: 'string', description: '应用名称，不超过 24 字'},
          html: {type: 'string', description: 'body 内的 HTML 片段'},
          css: {type: 'string', description: 'CSS'},
          js: {type: 'string', description: 'JavaScript，作为 ES module 运行'},
          height: {type: 'number', description: '高度 px，120~900，默认 320'},
          span: {type: 'string', enum: ['full', 'two-thirds', 'half', 'third']},
        },
        required: ['pageId', 'html'],
      },
    },
    {
      name: 'create_app',
      title: '创建沙盒应用',
      description: [
        '写一个完整的小应用放到页面上：小游戏、自定义图表、Canvas/Three.js 场景、番茄钟、计算器……素材库和声明式组件做不到时用它。',
        '你写 html（body 内片段）、css、js；运行在隔离 iframe 里，不会影响主页，也读不到主页数据。',
        '',
        '可用能力：',
        '  · 库：js 里直接 import，例如 import * as THREE from "https://esm.sh/three"、import gsap from "https://esm.sh/gsap"。只允许 esm.sh / cdn.jsdelivr.net / unpkg.com。',
        '  · 样式：已注入主页的 CSS 变量（var(--bg) --text --text2 --text3 --border --main --font-serif/--font-sans/--font-mono）。',
        '    请用这些变量，应用就能和主页风格一致、自动适配深浅色。内置类：.kicker（小标签）.muted .mono .serif .card .btn .btn.primary；input/textarea 已有基础样式。',
        '  · window.tada.store.get(key) / .set(key, value)：本应用私有的持久存储，Promise，值需可 JSON 化，总共约 100KB。',
        '  · window.tada.fetch(url)：取数，Promise<{ok,status,text,json}>。域名必须先被用户授权，未授权会自动弹出授权请求。应用自己不能直接 fetch/XHR。',
        '  · window.tada.open(url)：新标签打开 https 链接。window.tada.ask(text)：把一句话发给搭搭助手。window.tada.dark：是否深色。',
        '  · 图片只能来自 data:/blob:、images.unsplash.com 和已授权域名。',
        '',
        '写法建议：先把 html 结构写好，js 里用 const el=document.querySelector(...) 绑事件；动画优先用 requestAnimationFrame；',
        '背景保持透明，让主页的纸张底色透出来；不要给 body 设置固定背景色。出错时用户会看到空白，所以先在脑子里走一遍代码。',
      ].join('\n'),
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          const result = ops.addComponent(getWorkspace(), {
            pageId: args.pageId,
            type: 'app',
            span: args.span,
            title: args.title,
            config: {html: args.html, css: args.css, js: args.js, ...(args.height ? {height: args.height} : {})},
          })
          commit(result.workspace)
          return `已创建沙盒应用，id=${result.instance.id}。用 update_app 修改。`
        }),
    },
  ),
  define(
    {
      schema: {
        parse: (raw) => ({
          ref: str(obj(raw).ref),
          pageId: optStr(obj(raw).pageId),
          html: typeof obj(raw).html === 'string' ? (obj(raw).html as string) : undefined,
          css: typeof obj(raw).css === 'string' ? (obj(raw).css as string) : undefined,
          js: typeof obj(raw).js === 'string' ? (obj(raw).js as string) : undefined,
          height: num(obj(raw).height),
        }),
      },
      json: {
        type: 'object',
        properties: {
          ref: {type: 'string', description: '应用的实例 id 或标题'},
          pageId: {type: 'string'},
          html: {type: 'string', description: '给了就整体替换 html'},
          css: {type: 'string', description: '给了就整体替换 css'},
          js: {type: 'string', description: '给了就整体替换 js'},
          height: {type: 'number'},
        },
        required: ['ref'],
      },
    },
    {
      name: 'update_app',
      title: '修改沙盒应用',
      description: '修改已有沙盒应用的 html / css / js / 高度。只传要改的字段；传了的字段整体替换。能力和限制同 create_app。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          const config: Obj = {}
          for (const key of ['html', 'css', 'js', 'height'] as const) if (args[key] !== undefined) config[key] = args[key]
          const result = ops.updateComponent(getWorkspace(), args.ref, {config}, args.pageId)
          if (result.instance.type !== 'app') throw new WorkspaceError(`${args.ref} 不是沙盒应用`)
          commit(result.workspace)
          return `已更新沙盒应用 ${result.instance.id}。`
        }),
    },
  ),

  // ───── 视图 ─────
  define(
    {
      schema: {parse: (raw) => ({items: obj(raw).items})},
      json: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: '状态条的完整内容，按从左到右的顺序。会整体替换现有的。传空数组清空。',
            items: {
              type: 'object',
              properties: {
                type: {type: 'string', description: '组件类型，必须是 list_component_types 里标了「可放状态条」的，如 clock / weather / monitor'},
                config: {type: 'object', description: '该组件自己的配置，如 clock 的 {showSeconds:true}'},
              },
              required: ['type'],
            },
          },
        },
        required: ['items'],
      },
    },
    {
      name: 'set_statusbar',
      title: '设置状态条',
      description:
        '设置顶栏右侧「状态条」里的内容：每一项是某个组件的紧凑形态，用来实时看一眼状态（时间、天气、服务在线数等）。整体替换，最多 5 项。默认只有一个时钟，别随意塞太多，要保持克制。先 get_workspace 看现有的，需要保留的要一并传回。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          commit(ops.setStatusbar(getWorkspace(), args.items))
          const now = getWorkspace().statusbar
          return `状态条已更新：${now.map((item) => item.type).join('、') || '空'}。`
        }),
    },
  ),
  // ───── Dock（侧栏 / 手机底栏）的样式 ─────
  define(
    {schema: {parse: obj}, json: {type: 'object', properties: {}}},
    {
      name: 'get_dock',
      title: '查看 Dock 样式',
      description: '查看 Dock（电脑的侧栏、手机的底部栏）现在用的是哪个预设、有没有自定义 CSS，以及可选的预设。动手改之前先看。',
      effect: 'read',
      highRisk: () => false,
      execute: async () => {
        const dock = getWorkspace().dock ?? {preset: 'glass'}
        return [
          `当前预设：${dock.preset}（${DOCK_PRESETS.find((item) => item.id === dock.preset)?.name}）`,
          dock.css ? `自定义 CSS（${dock.css.length} 字）：\n${dock.css}` : '没有自定义 CSS',
          `可选预设：${DOCK_PRESETS.map((item) => `${item.id}（${item.name}：${item.description}）`).join('；')}`,
        ].join('\n')
      },
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({preset: optStr(obj(raw).preset), css: typeof obj(raw).css === 'string' ? (obj(raw).css as string) : undefined, reset: obj(raw).reset === true})},
      json: {
        type: 'object',
        properties: {
          preset: {type: 'string', enum: DOCK_PRESETS.map((item) => item.id), description: DOCK_PRESETS.map((item) => `${item.id}＝${item.name}`).join('，')},
          css: {type: 'string', description: '整套自定义 CSS，会叠在预设之上；传空字符串清掉自定义样式。要改就把完整的一份传回来（整体替换，不是追加）。'},
          reset: {type: 'boolean', description: '回到默认的拟态液体玻璃，并清掉自定义 CSS'},
        },
      },
    },
    {
      name: 'set_dock',
      title: '设置 Dock 样式',
      description: `设置 Dock（电脑的侧栏、手机的底部栏）的外观。默认是「拟态液体玻璃」；可以选内置预设，也可以自己写一整份 CSS 做成全新的样子。改完用户马上能看到，不满意可以撤销。\n\n${DOCK_GUIDE}`,
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          if (!args.reset && args.preset === undefined && args.css === undefined) throw new WorkspaceError('至少给 preset、css、reset 之一')
          commit(ops.setDock(getWorkspace(), args))
          const dock = getWorkspace().dock
          return dock ? `Dock 已更新：预设 ${dock.preset}${dock.css ? `，带 ${dock.css.length} 字的自定义 CSS` : ''}。` : 'Dock 已回到默认的拟态液体玻璃。'
        }),
    },
  ),
  // ───── 组件市场 ─────
  define(
    {schema: {parse: obj}, json: {type: 'object', properties: {}}},
    {
      name: 'list_addons',
      title: '查看组件市场',
      description: '列出组件市场里的所有组件，以及哪些已安装。热榜、订阅、书桌、书签、监控默认没装，用户需要时先看这个。',
      effect: 'read',
      highRisk: () => false,
      execute: async () => {
        const workspace = getWorkspace()
        return ADDONS.map((addon) => `${addon.id}｜${addon.name}｜${workspace.addons.includes(addon.id) ? '已安装' : '未安装'}\n  ${addon.description}\n  安装后：${addon.after}`).join('\n\n')
      },
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({id: str(obj(raw).id)})},
      json: {type: 'object', properties: {id: {type: 'string', enum: ADDONS.map((addon) => addon.id), description: '市场组件 id'}}, required: ['id']},
    },
    {
      name: 'install_addon',
      title: '安装市场组件',
      description: '安装组件市场里的一个组件。需要页面的会自动建好页面并出现在侧栏。装完才能 add_component 它的组件类型。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          const result = ops.installAddon(getWorkspace(), args.id)
          commit(result.workspace)
          return `已安装「${result.addon.name}」。${result.addon.after}`
        }),
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({id: str(obj(raw).id)})},
      json: {type: 'object', properties: {id: {type: 'string', enum: ADDONS.map((addon) => addon.id), description: '市场组件 id'}}, required: ['id']},
    },
    {
      name: 'uninstall_addon',
      title: '卸载市场组件',
      description: '卸载一个市场组件：页面和状态条上它的组件会被移除，它自己建的页面空了就一并删掉。组件保存的数据留在本机。',
      effect: 'write',
      highRisk: () => true,
      execute: (args) =>
        guard(() => {
          const result = ops.uninstallAddon(getWorkspace(), args.id)
          commit(result.workspace)
          return `已卸载「${result.addon.name}」。`
        }),
    },
  ),

  // ───── 书签 ─────
  define(
    {
      schema: {parse: (raw) => ({group: optStr(obj(raw).group), query: optStr(obj(raw).query)})},
      json: {
        type: 'object',
        properties: {
          group: {type: 'string', description: '只看这个分组（分组名）'},
          query: {type: 'string', description: '按名称或网址搜索'},
        },
      },
    },
    {
      name: 'list_bookmarks',
      title: '查看书签',
      description: '列出书签：每个分组和里面的书签（id｜名称｜网址）。整理、查重、删除之前先看这个。书签很多时用 group 或 query 缩小范围。',
      effect: 'read',
      highRisk: () => false,
      execute: async (args) => {
        if (!isInstalled(getWorkspace(), 'bookmarks')) return '书签组件还没安装，先用 install_addon 装上 bookmarks。'
        const groups = getBookmarks()
        if (!groups.length) return '还没有任何书签。'
        const q = args.query?.toLowerCase()
        const LIMIT = 300
        let shown = 0
        const lines: string[] = []
        for (const g of groups) {
          if (args.group && g.name !== args.group) continue
          const items = g.items.filter((i) => !q || i.name.toLowerCase().includes(q) || i.url.toLowerCase().includes(q))
          if (!items.length && (q || args.group)) continue
          lines.push(`# ${g.name}（${g.items.length} 个${q ? `，匹配 ${items.length}` : ''}）`)
          for (const i of items) {
            if (shown >= LIMIT) break
            lines.push(`  ${i.id}｜${i.name}｜${i.url}`)
            shown += 1
          }
        }
        if (shown >= LIMIT) lines.push(`（只列出前 ${LIMIT} 个，用 group 或 query 缩小范围）`)
        return `共 ${countBookmarks(groups)} 个书签\n${lines.join('\n')}`
      },
    },
  ),
  define(
    {
      schema: {
        parse: (raw) => ({
          items: (Array.isArray(obj(raw).items) ? (obj(raw).items as unknown[]) : []).slice(0, 200).map((item) => ({url: str(obj(item).url), name: optStr(obj(item).name), group: optStr(obj(item).group)})),
        }),
      },
      json: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: '要添加的书签，一次最多 200 个',
            items: {
              type: 'object',
              properties: {
                url: {type: 'string', description: '网址，没写协议会补 https://'},
                name: {type: 'string', description: '名称，不写就用域名'},
                group: {type: 'string', description: '分组名，不存在会新建；不写放进第一个分组'},
              },
              required: ['url'],
            },
          },
        },
        required: ['items'],
      },
    },
    {
      name: 'add_bookmarks',
      title: '添加书签',
      description: '批量添加书签。分组不存在会自动新建；已经有的网址会自动跳过，不会重复。用户给了一堆网址、或让你推荐一批站点时用这个，别一个一个加。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          if (!isInstalled(getWorkspace(), 'bookmarks')) return '书签组件还没安装，先用 install_addon 装上 bookmarks。'
          if (!args.items.length) return '没有要添加的书签。'
          const result = addBookmarks(getBookmarks(), args.items)
          setBookmarks(result.groups)
          return `已添加 ${result.added} 个书签。${result.skipped.length ? `跳过 ${result.skipped.length} 个：${result.skipped.slice(0, 10).join('、')}` : ''}`
        }),
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({id: str(obj(raw).id), name: optStr(obj(raw).name), url: optStr(obj(raw).url), group: optStr(obj(raw).group)})},
      json: {
        type: 'object',
        properties: {
          id: {type: 'string', description: '书签 id（list_bookmarks 里看）'},
          name: {type: 'string'},
          url: {type: 'string'},
          group: {type: 'string', description: '移到这个分组，不存在会新建'},
        },
        required: ['id'],
      },
    },
    {
      name: 'update_bookmark',
      title: '修改书签',
      description: '改一个书签的名称、网址，或把它移到另一个分组。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          const result = updateBookmark(getBookmarks(), args.id, args)
          if (result.error) return `没有成功：${result.error}`
          setBookmarks(result.groups)
          return '已修改。'
        }),
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({ids: strList(obj(raw).ids), group: str(obj(raw).group)})},
      json: {
        type: 'object',
        properties: {
          ids: {type: 'array', items: {type: 'string'}, description: '要移动的书签 id'},
          group: {type: 'string', description: '目标分组名，不存在会新建'},
        },
        required: ['ids', 'group'],
      },
    },
    {
      name: 'move_bookmarks',
      title: '批量移动书签',
      description: '把一批书签移到同一个分组。整理书签（按用途归类）时，先 list_bookmarks，再按分组分批调用这个。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          if (!args.group) return '没有成功：要给目标分组名'
          let groups = getBookmarks()
          let moved = 0
          for (const id of args.ids) {
            const result = updateBookmark(groups, id, {group: args.group})
            if (!result.error) {
              groups = result.groups
              moved += 1
            }
          }
          setBookmarks(groups)
          return `已移动 ${moved} 个书签到「${args.group}」${moved < args.ids.length ? `，${args.ids.length - moved} 个 id 不存在` : ''}。`
        }),
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({ids: strList(obj(raw).ids), urls: strList(obj(raw).urls)})},
      json: {
        type: 'object',
        properties: {
          ids: {type: 'array', items: {type: 'string'}, description: '书签 id'},
          urls: {type: 'array', items: {type: 'string'}, description: '或按网址删'},
        },
      },
    },
    {
      name: 'remove_bookmarks',
      title: '删除书签',
      description: '按 id 或网址删除书签。删除是高危操作，会让用户确认。',
      effect: 'write',
      highRisk: () => true,
      execute: (args) =>
        guard(() => {
          const result = removeBookmarks(getBookmarks(), args)
          setBookmarks(result.groups)
          return `已删除 ${result.removed} 个书签。`
        }),
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({group: str(obj(raw).group), name: optStr(obj(raw).name), remove: obj(raw).remove === true})},
      json: {
        type: 'object',
        properties: {
          group: {type: 'string', description: '分组名'},
          name: {type: 'string', description: '改成这个新名字'},
          remove: {type: 'boolean', description: '为 true 则删除整个分组及里面的书签'},
        },
        required: ['group'],
      },
    },
    {
      name: 'edit_bookmark_group',
      title: '编辑书签分组',
      description: '给分组改名，或删除整个分组（连同里面的书签，高危，会让用户确认）。',
      effect: 'write',
      highRisk: (args) => args.remove,
      execute: (args) =>
        guard(() => {
          const groups = getBookmarks()
          const target = groups.find((g) => g.name === args.group)
          if (!target) return `没有叫「${args.group}」的分组`
          if (args.remove) {
            setBookmarks(removeGroup(groups, target.id))
            return `已删除分组「${target.name}」和里面的 ${target.items.length} 个书签。`
          }
          if (!args.name) return '没有成功：要给新名字，或设 remove 为 true'
          const result = renameGroup(groups, target.id, args.name)
          if (result.error) return `没有成功：${result.error}`
          setBookmarks(result.groups)
          return `已改名为「${args.name}」。`
        }),
    },
  ),

  // ───── 浏览器里的真书签（需要「搭搭书签桥」扩展） ─────
  define(
    {
      schema: {parse: (raw) => ({query: optStr(obj(raw).query), folder: optStr(obj(raw).folder)})},
      json: {
        type: 'object',
        properties: {
          query: {type: 'string', description: '按标题或网址搜索'},
          folder: {type: 'string', description: '只看这个文件夹，例如「书签栏/开发」'},
        },
      },
    },
    {
      name: 'list_browser_bookmarks',
      title: '查看浏览器书签',
      description: '读取用户浏览器里真正的书签（不是搭搭里的）：id｜标题｜网址｜所在文件夹。需要用户装了「搭搭书签桥」扩展并在此网站启用；没连上会告诉你怎么引导用户。整理浏览器书签前先看这个。',
      effect: 'read',
      highRisk: () => false,
      execute: (args) =>
        bridge(async () => {
          const {items, folders} = await listBrowser()
          const q = args.query?.toLowerCase()
          const folder = args.folder?.split('/').map((p) => p.trim()).filter(Boolean)
          const inFolder = (path: string[]) => !folder || folder.every((seg, i) => path[i] === seg)
          const hits = items.filter((i) => inFolder(i.path) && (!q || i.title.toLowerCase().includes(q) || i.url.toLowerCase().includes(q)))
          const LIMIT = 300
          const lines = hits.slice(0, LIMIT).map((i) => `  ${i.id}｜${i.title}｜${i.url}｜${i.path.join('/')}`)
          return `浏览器共 ${items.length} 个书签，${folders.length} 个文件夹；${q || folder ? `匹配 ${hits.length} 个` : '以下是书签'}：\n${lines.join('\n')}${hits.length > LIMIT ? `\n（只列出前 ${LIMIT} 个，用 query 或 folder 缩小范围）` : ''}\n文件夹：${folders.map((f) => f.path.join('/')).join('；')}`
        }),
    },
  ),
  define(
    {
      schema: {
        parse: (raw) => ({
          items: (Array.isArray(obj(raw).items) ? (obj(raw).items as unknown[]) : []).slice(0, 200).map((item) => ({url: str(obj(item).url), title: optStr(obj(item).title), folder: optStr(obj(item).folder)})),
        }),
      },
      json: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                url: {type: 'string'},
                title: {type: 'string'},
                folder: {type: 'string', description: '文件夹路径，例如「书签栏/开发」，不存在会新建；不写则放进书签栏的「搭搭」文件夹'},
              },
              required: ['url'],
            },
          },
        },
        required: ['items'],
      },
    },
    {
      name: 'add_browser_bookmarks',
      title: '添加到浏览器书签',
      description: '往用户浏览器书签里批量添加（需要扩展）。同一文件夹里已有的网址会跳过。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        bridge(async () => {
          const items = args.items.map((i) => ({url: i.url, title: i.title, path: i.folder ? i.folder.split('/').map((p) => p.trim()).filter(Boolean) : ['@bar', SYNC_FOLDER]}))
          const result = await call<{created: number; skipped: string[]}>('create', {items}, 30000)
          return `已添加 ${result.created} 个到浏览器书签。${result.skipped.length ? `跳过 ${result.skipped.length} 个：${result.skipped.slice(0, 10).join('、')}` : ''}`
        }),
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({ids: strList(obj(raw).ids), folder: str(obj(raw).folder)})},
      json: {
        type: 'object',
        properties: {
          ids: {type: 'array', items: {type: 'string'}, description: '浏览器书签 id（list_browser_bookmarks 里看）'},
          folder: {type: 'string', description: '目标文件夹路径，例如「书签栏/开发」，不存在会新建'},
        },
        required: ['ids', 'folder'],
      },
    },
    {
      name: 'move_browser_bookmarks',
      title: '移动浏览器书签',
      description: '把浏览器里的一批书签移到某个文件夹（需要扩展）。整理浏览器书签时，先 list_browser_bookmarks，想好分类再分批移动。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        bridge(async () => {
          if (!args.folder) return '没有成功：要给目标文件夹'
          const result = await call<{moved: number}>('move', {ids: args.ids, path: args.folder.split('/').map((p) => p.trim()).filter(Boolean)}, 30000)
          return `已移动 ${result.moved} 个浏览器书签到「${args.folder}」。`
        }),
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({ids: strList(obj(raw).ids)})},
      json: {type: 'object', properties: {ids: {type: 'array', items: {type: 'string'}}}, required: ['ids']},
    },
    {
      name: 'remove_browser_bookmarks',
      title: '删除浏览器书签',
      description: '删除浏览器里的书签（需要扩展；只删书签，不删文件夹）。会真的从用户浏览器里删掉，高危，会让用户确认。',
      effect: 'write',
      highRisk: () => true,
      execute: (args) =>
        bridge(async () => {
          const result = await call<{removed: number}>('remove', {ids: args.ids}, 30000)
          return `已从浏览器删除 ${result.removed} 个书签。`
        }),
    },
  ),
  define(
    {schema: {parse: obj}, json: {type: 'object', properties: {}}},
    {
      name: 'import_browser_bookmarks',
      title: '把浏览器书签导入搭搭',
      description: '把浏览器里的全部书签并进搭搭的书签页（需要扩展，重复的网址自动跳过）。用户说「导入我的书签」时用这个。',
      effect: 'write',
      highRisk: () => false,
      execute: () =>
        bridge(async () => {
          if (!isInstalled(getWorkspace(), 'bookmarks')) return '书签组件还没安装，先用 install_addon 装上 bookmarks。'
          return importFromBrowser()
        }),
    },
  ),
  define(
    {schema: {parse: obj}, json: {type: 'object', properties: {}}},
    {
      name: 'push_bookmarks_to_browser',
      title: '把搭搭书签同步到浏览器',
      description: '把搭搭书签页的书签写进浏览器书签栏的「搭搭」文件夹，只增不删（需要扩展）。',
      effect: 'write',
      highRisk: () => false,
      execute: () => bridge(() => pushToBrowser()),
    },
  ),
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

  // ───── 站点功能：订阅、热榜、待办、便签、天气、监控、设置、技能 ─────
  ...SITE_TOOLS,

  // ───── 生活：日期、日程、倒数日、番茄钟、音乐 ─────
  ...LIFE_TOOLS,

  // ───── 搜索：帮用户去搜（open_search）、自己联网查（web_search / web_fetch） ─────
  ...SEARCH_TOOLS,
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
