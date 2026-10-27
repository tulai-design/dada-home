import {createToolFactory, type AgentToolSchema, type ToolContext, type ToolDefinition} from '@tulai-design/agent-core'
import {removeData} from './componentData'
import * as ops from './ops'
import {WorkspaceError} from './errors'
import {FX_DEFS, describeFx, getFx} from '../fx/catalog'
import {FX_BUDGET_LIMITS, FX_COMPACT_LIMITS, FX_COMPACT_WIDTH, assessPageEffects, planPageEffects} from '../fx/policy'
import {getDefinition, listDefinitions} from './registry'
import {getWorkspace, commit} from './workspaceStore'
import {PAGE_ICON_KEYS} from './pageIcons'
import {ADDONS, isInstalled, typeAvailable} from './market'
import {NO_EXTENSION_HINT, SYNC_FOLDER, call, detect, importFromBrowser, listBrowser, pushToBrowser} from './browserBookmarks'
import {addBookmarks, countBookmarks, getBookmarks, removeBookmarks, removeGroup, renameGroup, setBookmarks, updateBookmark} from './bookmarks'
import {activeTheme} from './workspace'
import {getAppearance, resetAppearance} from './appearance'
import {createApplication, updateApplication, configureApplication, findApplication, listApplications, mountApplication, removeApplication} from './applications'
import type {ApplicationOpenMode} from './workspace'
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
  /** 从应用目录打开，展示位置不改变安装记录。 */
  openApplication?: (id: string, mode?: ApplicationOpenMode) => void
}

export type HomeToolContext = ToolContext<void> & ToolHost

const define = createToolFactory<HomeToolContext, void>()

type Obj = Record<string, unknown>
const obj = (raw: unknown): Obj => (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Obj) : {})
const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const optStr = (value: unknown): string | undefined => str(value) || undefined
const strList = (value: unknown): string[] => (Array.isArray(value) ? value.map(str).filter(Boolean) : [])
const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
const themeVars = (value: unknown, field: string): Record<string, unknown> | null | undefined => {
  if (value === undefined || value === null) return value
  if (typeof value !== 'object' || Array.isArray(value)) throw new WorkspaceError(`${field} 必须是 CSS 变量对象或 null`)
  return value as Record<string, unknown>
}
const applicationPatch = (raw: unknown) => {
  const value = obj(raw)
  for (const key of ['dock', 'status'] as const) if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new WorkspaceError(`${key} 必须是布尔值`)
  return {
    title: optStr(value.title), description: typeof value.description === 'string' ? value.description : undefined,
    group: typeof value.group === 'string' ? value.group : undefined,
    openMode: optStr(value.openMode), dock: value.dock as boolean | undefined, status: value.status as boolean | undefined,
    statusMode: optStr(value.statusMode),
    settingsSchema: value.settingsSchema, settings: value.settings, span: optStr(value.span),
  }
}
const applicationProperties = {
  title: {type: 'string', description: '应用名称，不超过 24 字'},
  description: {type: 'string', description: '用途说明'},
  group: {type: 'string', description: '应用分组，例如 效率、生活、开发；空字符串取消分组'},
  openMode: {type: 'string', enum: ['modal', 'drawer', 'page'], description: '从市场、Dock 或状态栏打开的形式，默认 modal 弹窗；drawer 抽屉；page 全页面'},
  dock: {type: 'boolean', description: '是否固定到左侧 Dock，默认 false，按用户需要开启'},
  status: {type: 'boolean', description: '是否显示在顶部状态栏，默认 false，显示方式由 statusMode 决定'},
  statusMode: {type: 'string', enum: ['launcher', 'compact'], description: '默认 launcher 只显示打开入口；compact 需源码显式处理 ctx.surface === "status" / tada.surface === "status" 的单行布局。高32px，Applet桌面最大宽200/手机140px，App宽160/130px。主窗口或可见小组件运行时回退入口；无运行形态后不后台常驻'},
  settingsSchema: {type: 'object', description: '用户设置字段：{key:{kind:"string"|"number"|"boolean"|"select",label,description?,default?,min?,max?,options?:[{value,label}]}}，最多24项。系统自动在设置页生成表单'},
  settings: {type: 'object', description: '匹配 settingsSchema 的当前设置值；App 用 tada.settings 读取，变更后安全重载；Applet 用 ctx.settings 读取，依赖设置的副作用由 onSettingsChange(s,ctx,previous) 更新，init 不会重跑'},
  span: {type: 'string', enum: ['full', 'two-thirds', 'half', 'third']},
}

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
      description: '查看当前所有页面及组件、图层、特效预算和静态降级摘要。旧配置不会因超预算被删除；修改前先看清现状。默认外观、当前背景与样式差异用 get_appearance 查看。',
      effect: 'read',
      highRisk: () => false,
      execute: async () => {
        const workspace = getWorkspace()
        const pages = workspace.pages
          .map((page) => {
            const desktop = planPageEffects(page, {compact: false})
            const compact = planPageEffects(page, {compact: true})
            const effects = desktop.entries.length ? `\n  特效策略：${JSON.stringify({
              assessment: assessPageEffects(page),
              desktopStatic: desktop.entries.filter((entry) => entry.mode === 'static'),
              compactStatic: compact.entries.filter((entry) => entry.mode === 'static'),
              note: '静态降级保留配置；这是预算规划，实际减少动画/可见性与容器尺寸还会进一步限制，并非视觉验收。',
            })}` : ''
            return `# ${page.id}｜${page.name}｜图标 ${page.icon ?? '默认'}｜${page.components.length} 个组件${page.id === 'home' ? '｜固定项' : ''}\n${page.components.map((c) => `  - ${describeComponent(c)}`).join('\n') || '  （空）'}${page.layers?.length ? `\n  图层：${JSON.stringify(page.layers)}` : ''}${effects}`
          })
          .join('\n')
        const status = workspace.statusbar.map((item) => `${item.type} ${JSON.stringify(item.config)}`).join('；') || '（空）'
        const addons = workspace.addons.map((id) => ADDONS.find((a) => a.id === id)?.name ?? id).join('、') || '（无）'
        return `${pages}\n\n特效页面上限：${JSON.stringify({desktop: FX_BUDGET_LIMITS, compact: FX_COMPACT_LIMITS, compactWidth: FX_COMPACT_WIDTH})}；图层与特效块共同计量，小于窄容器阈值的 WebGL/Spline 静态显示。旧页允许各维度不增加超限的编辑；只覆盖注册特效，不计自编应用内部动画。\n已安装的市场组件：${addons}\n状态条：${status}\nDock：${workspace.dock ? `${workspace.dock.preset}${workspace.dock.css ? ' + 自定义 CSS' : ''}` : '默认（拟态液体玻璃）'}，用 get_dock / set_dock\n主题：${activeTheme(workspace).name}（${activeTheme(workspace).id}）｜明暗 ${workspace.theme.mode}｜主题库 ${workspace.themes.length} 个，用 list_themes 查看\n模板库：我的 ${workspace.templates.length} 个 + 内置预设，用 list_templates 查看\nAI 应用：${listApplications(workspace).length} 个，用 list_applications 查看源码、分组、入口与设置；默认从组件市场打开。\n完整外观（默认样式、背景、组件外观及差异）用 get_appearance 查看；恢复默认外观用 reset_appearance，不要用布局或模板操作替代。`
      },
    },
  ),

  define(
    {schema: {parse: obj}, json: {type: 'object', properties: {}}},
    {
      name: 'get_appearance',
      title: '查看完整外观',
      description: '读取系统默认外观、当前外观及差异：主题两套配色与字体、首页默认背景、Dock、每页壁纸与图层、页面 CSS 和组件外观。embeddedVisuals 列出独立特效组件和自编应用，它们的内容可能影响视觉，还原外观时会保留，需单独查看配置或源码。用户问默认长什么样、为什么还原后仍有背景或要恢复默认外观时先看这个；以返回的默认资料为准，不猜测。只读，不修改页面。',
      effect: 'read',
      highRisk: () => false,
      execute: async () => JSON.stringify(getAppearance(getWorkspace()), null, 2),
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
          return {mode: optStr(value.mode), overrides: themeVars(value.overrides, 'overrides'), light: themeVars(value.light, 'light'), dark: themeVars(value.dark, 'dark'), fonts: value.fonts}
        },
      },
      json: {
        type: 'object',
        properties: {
          mode: {type: 'string', enum: ['light', 'dark'], description: '切换当前显示模式，不锁定主题的其他模式'},
          overrides: {type: ['object', 'null'], description: '共享变量补丁，键不带 `--`，例如 {"main":"#2b6cf6","radius":"8px","frame":"0px"}。旧写法的 bg/text/border 等核心配色仅修改当前模式；推荐显式写 light/dark。传 null 清空全部自定义变量和字体'},
          light: {type: ['object', 'null'], description: '仅浅色模式的变量补丁，与已有浅色变量合并；bg/bg2/bg3、text/text2/text3/text4、border/rule 等放这里。传 null 清空这一分支，未传保留'},
          dark: {type: ['object', 'null'], description: '仅深色模式的变量补丁，与已有深色变量合并。传 null 清空这一分支，未传保留'},
          fonts: {type: 'array', description: '从 Google Fonts 引入的字体，一次传整个数组；传 [] 清掉', items: {type: 'object', properties: {family: {type: 'string'}, role: {type: 'string', enum: ['serif', 'sans', 'mono']}}, required: ['family']}},
        },
      },
    },
    {
      name: 'set_theme',
      title: '调整主题',
      description:
        '微调当前主题：mode 切当前明暗；overrides 放共享尺寸、外框或主色；light 和 dark 分别补丁合并两种模式配色，只写要改的。不要用一组固定 bg/text 代替两套适配；如只调深色，传 dark 即可，不影响浅色。修改后用 list_themes 核对两套分支，缺少的配色继承系统基础色。可改的变量（键不带 `--`）：main 主色；bg/bg2/bg3 背景层级；text/text2/text3/text4 文字层级；border、rule 线条；radius、radius-lg 圆角（默认 0，方角）；gutter 页面左右留白；frame 外框粗细（默认 7px，设 0px 就去掉外框，同时去掉外框占的边距）；frame-gap 外框占的边距（只想去掉红框但保留边距时，frame 设 0px 并把 frame-gap 设为 7px）；frame-color 外框颜色（默认跟随 main）；side-width 侧栏宽度。字体：用 fonts 从 Google Fonts 引入，例如 [{"family":"Playfair Display","role":"serif"},{"family":"Noto Sans SC","role":"sans"}]。role 决定它接管哪一类：serif=标题、大数字和正文（默认的衬线），sans=界面控件和小字，mono=数字、标签和顶栏的等宽字。不写 role 只加载不接管（再自己用 font-serif 等变量引用）。family 必须是 Google Fonts 上真实存在的名字，中文内容记得选支持中文的（Noto Serif SC、Noto Sans SC、ZCOOL XiaoWei、LXGW WenKai 等）。最多 4 个，一次传整个数组。当前是默认主题时会自动另存为「自定义 N」再改，默认主题不会被改坏。要整套新风格并起名保存，用 save_theme。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          const result = ops.setTheme(getWorkspace(), args)
          commit(result.workspace)
          const loaded = args.fonts !== undefined ? '字体来自 Google Fonts，需要联网加载；加载失败页面会提示。' : ''
          return loaded + (result.forked ? `当前是默认主题，已另存为「${result.forked.name}」并应用修改。想起个名字可以用 save_theme。` : '主题已更新。')
        }),
    },
  ),

  // ───── 主题库 ─────
  define(
    {schema: {parse: obj}, json: {type: 'object', properties: {}}},
    {
      name: 'list_themes',
      title: '查看主题库',
      description: '列出所有主题（含默认主题）：id、名字、说明、共享变量、light/dark 两套覆盖、初始模式与是否正在使用；缺分支会说明继承基础配色。创建前看现状，修改后核对双模式是否完整。',
      effect: 'read',
      highRisk: () => false,
      execute: async () => {
        const workspace = getWorkspace()
        return workspace.themes
          .map((item) => `${item.id}｜${item.name}｜${item.id === workspace.theme.active ? `使用中（当前 ${workspace.theme.mode}）` : '未使用'}${item.builtin ? '｜默认（不可改删）' : ''}${item.mode ? `｜应用时初始偏好 ${item.mode}（仍可切换）` : ''}\n  ${item.description || '（无说明）'}\n  共享 overrides ${JSON.stringify(item.overrides)}\n  浅色 light ${item.light && Object.keys(item.light).length ? JSON.stringify(item.light) : '未单独覆盖，继承共享变量与系统浅色基础配色'}\n  深色 dark ${item.dark && Object.keys(item.dark).length ? JSON.stringify(item.dark) : '未单独覆盖，继承共享变量与系统深色基础配色'}${item.fonts?.length ? `\n  字体 ${JSON.stringify(item.fonts)}` : ''}`)
          .join('\n')
      },
    },
  ),
  define(
    {
      schema: {
        parse: (raw) => {
          const value = obj(raw)
          return {id: optStr(value.id), name: optStr(value.name), description: optStr(value.description), overrides: themeVars(value.overrides, 'overrides'), light: themeVars(value.light, 'light'), dark: themeVars(value.dark, 'dark'), fonts: value.fonts, mode: optStr(value.mode), activate: value.activate === false ? false : undefined}
        },
      },
      json: {
        type: 'object',
        properties: {
          name: {type: 'string', description: '主题名，20 字以内，例如「深海」「黄昏」'},
          description: {type: 'string', description: '一两句话说明这个主题的气质，之后在列表里看'},
          overrides: {type: ['object', 'null'], description: '共享变量，键不带 `--`，如 main 主色、radius 圆角、frame 外框粗细（0px 去掉外框）。传入时替换整组共享变量，null 或 {} 清空共享变量，未传保留；bg/text 等核心配色应放进 light/dark'},
          light: {type: ['object', 'null'], description: '浅色模式的一整套覆盖。新建完整风格应与 dark 一起提供：bg/bg2/bg3、text/text2/text3/text4、border/rule 等。传入时替换整组浅色变量，null 或 {} 清空，未传保留'},
          dark: {type: ['object', 'null'], description: '深色模式的一整套覆盖。新建完整风格应与 light 一起提供，保证深浅色切换可读。传入时替换整组深色变量，null 或 {} 清空，未传保留'},
          fonts: {type: 'array', description: '从 Google Fonts 引入的字体，例如 [{"family":"Playfair Display","role":"serif"}]；role 为 serif / sans / mono，决定接管哪类字体', items: {type: 'object', properties: {family: {type: 'string'}, role: {type: 'string', enum: ['serif', 'sans', 'mono']}}, required: ['family']}},
          mode: {type: 'string', enum: ['light', 'dark'], description: '应用主题时的初始明暗偏好；不锁定模式，用户仍可切换，刷新保留用户选择'},
          id: {type: 'string', description: '要更新的已有主题 id；不填则按名字匹配，匹配不到就新建'},
          activate: {type: 'boolean', description: '存完是否立刻启用，默认启用'},
        },
      },
    },
    {
      name: 'save_theme',
      title: '保存主题',
      description:
        '把主题存进主题库并（默认）启用。用户让你「做一个xx风格的主题」时：先 list_themes，再起名字、写说明，并分别给 light 和 dark 两套配色；共享主色、尺寸、外框放 overrides，字体放 fonts。mode 只表示应用时的初始偏好，不能替代另一套配色。例：overrides:{main:"#397c95",radius:"8px"},light:{bg:"#f4fafb",text:"#172f38"},dark:{bg:"#10232b",text:"#e5f3f7"}。完整风格应配齐两边背景、文字层级和边线并检查可读性，不把固定 bg/text 写进一组共享覆盖。仅添加字体或外框可以不传配色；更新时允许只替换一套分支，其他分支保持。存完用 list_themes 核对两套覆盖和当前模式。可改的变量（键不带 `--`）：main 主色；bg/bg2/bg3 背景层级；text/text2/text3/text4 文字层级；border、rule 线条；radius、radius-lg 圆角（默认 0，方角）；gutter 页面左右留白；frame 外框粗细（默认 7px，0px 去掉外框与边距）；frame-gap 外框占的边距；frame-color 外框颜色（默认跟随 main）；side-width 侧栏宽度。字体用 fonts，例如 [{"family":"Playfair Display","role":"serif"},{"family":"Noto Sans SC","role":"sans"}]，role 为 serif（标题、大数字和正文）、sans（界面控件和小字）、mono（数字标签和顶栏）；不写 role 只加载。family 必须是 Google Fonts 上真实存在的名字，中文优先选支持中文的字体，最多 4 个，一次传整个数组。同名或同 id 的会被更新；默认主题不能改。',
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
      description: '只切换主题库里的配色与字体，不清页面背景、壁纸、CSS、组件外观或 Dock。用户只要「切纸张配色」可传 ref:"default"；用户说「还原默认主题／默认外观」时先 get_appearance，再用 reset_appearance scope:"all" 完整恢复外观。',
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
      schema: {
        parse: (raw) => {
          const value = obj(raw)
          if (value.scope !== undefined && value.scope !== 'all' && value.scope !== 'home') throw new WorkspaceError('scope 只能是 all 或 home')
          if (value.mode !== undefined && value.mode !== 'light' && value.mode !== 'dark') throw new WorkspaceError('mode 只能是 light 或 dark')
          return {scope: (value.scope ?? 'all') as 'all' | 'home', mode: value.mode as 'light' | 'dark' | undefined}
        },
      },
      json: {
        type: 'object',
        properties: {
          scope: {type: 'string', enum: ['all', 'home'], description: '默认 all：恢复默认主题、字体、外框、Dock，并清理所有页面的装饰与组件外观；home：只恢复首页背景与首页外观，不切全局主题或 Dock'},
          mode: {type: 'string', enum: ['light', 'dark'], description: '仅全局还原时可指定明暗；不传则保留当前明暗。仅还原首页时不改变明暗'},
        },
      },
    },
    {
      name: 'reset_appearance',
      title: '恢复默认外观',
      description: '用户说「还原默认主题」「恢复默认外观」用 scope:"all"：恢复默认纸张主题、字体、7px 外框与玻璃 Dock，清除所有页壁纸、特效图层、页面 CSS 和组件外观覆盖，首页恢复系统默认波浪背景。scope:"home" 仅还原首页装饰和组件外观，不改全局主题、字体、Dock 或明暗。保留页面和组件内容、顺序、宽度、配置、对齐以及业务数据，主题库和模板库也保留；独立特效组件和自编应用作为内容保留，其视觉需另查配置或源码。不要用恢复布局、套用模板或删除组件代替。操作一次提交可撤销；完成后用 get_appearance 核对差异。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          commit(resetAppearance(getWorkspace(), args))
          return args.scope === 'home' ? '已恢复首页默认外观，页面内容与全局主题保持。可撤销，用 get_appearance 查看结果。' : '已恢复默认外观，页面内容、布局与业务数据保持。可撤销，用 get_appearance 查看结果。'
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
              '外观：{variant, tone, titleSize, animation, css}。css 写纯属性声明，例如 "background: var(--bg2); color: var(--text); border-radius: var(--radius)"；颜色和圆角沿用主题变量，不写选择器和花括号。',
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
        '2. 自定义 CSS：css 字段写纯属性声明，例如 "background: var(--bg2); color: var(--text); padding: 16px; border-radius: var(--radius)"。先沿用主题，不默认添加大圆角、重阴影或固定配色。',
        '   只作用于这一块，不要写选择器、花括号、@import、url(http...)。',
        '优先通过内容层级、间距和预设档位调整；确需局部样式时再用 css。按实际容器布局，并核对浅色、深色两种模式。',
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

  // ───── 素材库：特效 ─────
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
        '素材库提供已注册的 React Bits 本地效果与 Spline 场景入口。先确定内容主次与用户想要的氛围，再按需选择；不带参数看概览，要用某个效果再带 id 查完整参数。',
        '类别：',
        '  background  动态背景（极光、丝绸、光束、星系、虹彩、液态金属、光球、粒子、丝线、波纹线、点阵）→ 用 set_page_layers 铺满整页，或 add_component(type:"fx") 做成横幅块',
        '  text        会动的文字（分字入场、模糊显影、流光、渐变、解码、打字机、轮播词、数字滚动、毛边故障字、滚动字幕）→ add_component(type:"fx")',
        '  card        带光效的卡片（聚光、扫光）→ add_component(type:"fx")',
        '  overlay     整页质感层（胶片颗粒、点击火花）→ 只能 set_page_layers',
        '  scene       Spline 3D 场景 → 整页图层或横幅块',
        `默认建议：一个主要视觉效果即可；信息密集页面优先静态装饰。图层与内容块共同计预算：桌面最多 ${FX_BUDGET_LIMITS.totalCost} 点、${FX_BUDGET_LIMITS.gpuCount} 个 GPU 效果、${FX_BUDGET_LIMITS.continuousCount} 个持续动画；最多 3 个图层另行保留。各效果点数见目录，不是性能测量。`,
        `按手机、抽屉和 AI 分栏的实际容器宽度适配：小于 ${FX_COMPACT_WIDTH}px 时预算 ${FX_COMPACT_LIMITS.totalCost} 点，WebGL/Spline 和光效卡片静态显示；减少动画时全部静态保留内容，隐藏/离屏卸载装饰，粗指针关闭跟随、卡片光效与点击火花。旧超限配置保留并可减负编辑，运行时按图层→内容块顺序分配预算。`,
        '配色：params.palette:"theme" 跟随宿主语义色；params.light / params.dark 分别提供本效果的颜色字段。优先级为普通params→语义色板→当前模式分支。分支只接受目录color/colors字段，不能改变动画、布局或scene；未声明新配色保持旧固定色。更新组件时light/dark各分支整体替换，传null清除；palette:null关闭语义色板。',
        '详情 theme 列出允许的颜色字段；Noise无颜色，Spline仅宿主横幅文字跟随主题，不能改远程场景。显式配色仍需核对明暗对比。详情 policy 披露质量上限、来源核对状态与实现局限；未知许可不能声称已核对。Spline 只在用户明确需要 3D 时使用。',
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
            return `${def.id}｜${def.name}｜${def.kind}｜可用于 ${info.use.join('+')}｜${info.policy.renderer} ${info.policy.cost}点｜默认 ${info.policy.motion}｜窄容器 ${info.policy.compact}\n  ${def.description}\n  来源许可：${info.policy.source?.license ?? 'needs-verification'}；完整策略与配色字段用 list_effects(id) 查看\n  参数：${Object.keys(def.params).join('、') || '无'}；配色 palette / light / dark${!info.theme.colorFields.length ? '（无可配置颜色）' : ''}`
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
        '给整页设置背景或质感层，整体替换该页现有图层。例如 [{"effect":"waves","params":{"speed":0.5}}]。先读取现有图层，保留仍需要的效果；不要默认叠加多个持续动画。文字、卡片类效果不能当图层，请用 add_component(type:"fx")。设置会立即应用，成功仅表示配置已写入，不代表已完成视觉验证。',
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
          ...applicationPatch(raw),
          pageId: optStr(obj(raw).pageId),
          html: typeof obj(raw).html === 'string' ? (obj(raw).html as string) : '',
          css: typeof obj(raw).css === 'string' ? (obj(raw).css as string) : '',
          js: typeof obj(raw).js === 'string' ? (obj(raw).js as string) : '',
          height: num(obj(raw).height),
        }),
      },
      json: {
        type: 'object',
        properties: {
          ...applicationProperties,
          pageId: {type: 'string', description: '可选：挂载为该页小组件；省略则只安装到组件市场，不创建页面或自动进入 Dock'},
          html: {type: 'string', description: 'body 内的 HTML 片段'},
          css: {type: 'string', description: 'CSS'},
          js: {type: 'string', description: 'JavaScript，作为 ES module 运行'},
          height: {type: 'number', description: '高度 px，120~900，默认 320'},
          span: {type: 'string', enum: ['full', 'two-thirds', 'half', 'third']},
        },
        required: ['html'],
      },
    },
    {
      name: 'create_app',
      title: '创建沙盒应用',
      description: [
        '写一个完整的小应用安装进组件市场：小游戏、Canvas/WebGL/Three.js 场景、需要完全自定义视觉的东西。普通的交互工具（计算器、生成器、记账、待办）请用 create_applet，它用系统控件，风格一致、交互可靠。',
        '你写 html（body 内片段）、css、js；运行在隔离 iframe 里，不会影响主页，也读不到主页数据。',
        '',
        '可用能力：',
        '  · 库：js 里直接 import，例如 import * as THREE from "https://esm.sh/three"、import gsap from "https://esm.sh/gsap"。只允许 esm.sh / cdn.jsdelivr.net / unpkg.com。',
        '  · 样式：已注入主页的 CSS 变量（var(--bg) --text --text2 --text3 --border --main --font-serif/--font-sans/--font-mono）。',
        '    用这些变量适配浅色/深色，圆角用 --radius/--radius-lg；主题切换会热更新变量、tada.dark，Canvas 等可监听 window 的 tada:themechange 事件（detail.dark）。内置类：.kicker .muted .mono .serif .card .btn .btn.primary（墨色主操作）.row（可换行）.grid（自适应网格）.table-wrap；input/textarea 已有基础样式。',
        '  · window.tada.store.get(key) / .set(key, value)：本应用私有的持久存储，Promise，值需可 JSON 化，总共约 100KB。',
        '  · window.tada.fetch(url)：取数，Promise<{ok,status,text,json}>。域名必须先被用户授权，未授权会自动弹出授权请求。应用自己不能直接 fetch/XHR。',
        '  · window.tada.open(url)：新标签打开 https 链接。window.tada.ask(text)：把一句话发给搭搭助手。window.tada.dark：是否深色。',
        '  · window.tada.settings：只读用户设置；window.tada.surface：当前 widget/modal/drawer/page/status。settingsSchema 定义设置表单，settings 提供值，修改后应用会安全重载，私有持久数据保留。',
        '默认只安装进组件市场，从市场打开和管理；pageId 可选，给出才挂载为页面小组件。不自动创建页面或 Dock；入口用 dock/status 按需开启，group 管理分组，openMode 选择打开形式。',
        '五种运行形态是 widget/modal/drawer/page/status。按 iframe 实际宽度响应，不用全窗口宽度；照顾320–375px手机、小组件半宽、弹窗和抽屉。.row可换行，.grid按容器收列，宽表放.table-wrap；避免固定宽度和100vw。',
        '顶部默认 statusMode:"launcher" 为启动入口。需真实状态时先按 tada.surface === "status" 输出单行分支，再启用 status:true,statusMode:"compact"；iframe桌面160×32px，手机130×32px，不放标题或整页表单。主窗口或可见小组件运行时状态栏回退入口。无运行形态后不提供后台常驻逻辑，计时器应保存截止时间；切换形态可能重新挂载。',
        '  · 图片只能来自 data:/blob:、images.unsplash.com 和已授权域名。',
        '',
        '写法建议：先把 html 结构写好，js 里用 const el=document.querySelector(...) 绑事件；动画优先用 requestAnimationFrame；',
        '背景透明、文案简短，不加口号、重复标题、大圆角卡片、层层边框或逐行上边框。完善空/加载/错误反馈与键盘操作；生成后用 list_applications 核对配置和源码。当前工具没有浏览器视觉反馈，不得宣称已通过视觉验证。',
      ].join('\n'),
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          const result = createApplication(getWorkspace(), {
            ...args,
            type: 'app',
            config: {html: args.html, css: args.css, js: args.js, ...(args.height ? {height: args.height} : {})},
          })
          commit(args.pageId ? mountApplication(result.workspace, result.application.id, args.pageId, args.span) : result.workspace)
          return `已安装沙盒应用，id=${result.application.id}。可从组件市场打开和设置；用 update_app 修改。`
        }),
    },
  ),
  define(
    {
      schema: {
        parse: (raw) => ({
          ...applicationPatch(raw),
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
          ...applicationProperties,
          ref: {type: 'string', description: '应用目录中的 id 或标题，未挂页面也可修改'},
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
      description: '修改应用目录中的沙盒应用源码、高度、打开方式、分组、入口或设置字段，未挂页面也可修改。只传要改的字段；传了的源码整体替换。能力和限制同 create_app。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          const config: Obj = {}
          for (const key of ['html', 'css', 'js', 'height'] as const) if (args[key] !== undefined) config[key] = args[key]
          if (findApplication(getWorkspace(), args.ref).instance.type !== 'app') throw new WorkspaceError(`${args.ref} 不是沙盒应用`)
          const result = updateApplication(getWorkspace(), args.ref, {...args, config})
          commit(result.workspace)
          return `已更新沙盒应用 ${result.application.id}。`
        }),
    },
  ),

  define(
    {
      schema: {
        parse: (raw) => ({
          ...applicationPatch(raw),
          pageId: optStr(obj(raw).pageId),
          source: str(obj(raw).source),
        }),
      },
      json: {
        type: 'object',
        properties: {
          ...applicationProperties,
          pageId: {type: 'string', description: '可选：挂载为该页小组件；不传只安装到组件市场'},
          source: {type: 'string', description: '脚本全文（ES module），里面调用一次 applet({...})'},
          span: {type: 'string', enum: ['full', 'two-thirds', 'half', 'third']},
        },
        required: ['source'],
      },
    },
    {
      name: 'create_applet',
      title: '创建小程序',
      description: [
        '做有交互的小工具首选：计算器、生成器、记账、待办、换算、抽签、问卷、小看板……',
        '你写的是逻辑（任意 JavaScript）；界面用系统自带的 Lobe 控件拼，所以风格和主页一致、深浅色自动适配、点击输入可靠。不要写 HTML/CSS。',
        '第一次用之前先 use_skill applet，取回完整的积木目录、写法和设计要求；按它写，别凭记忆。',
        '默认安装进组件市场；pageId 可选，给出才挂载小组件。不自动创建页面或 Dock；group 管分组，openMode 选 modal/drawer/page，dock/status 按需开启。settingsSchema 定义用户设置表单，运行时用 ctx.settings 读取，ctx.surface 得知当前展示位置。',
        '按实际容器适配widget/modal/drawer/page/status五种形态，ctx.viewport={width,compact}，compact指容器<480px。Grid默认按容器收列，responsive:false仅用于键盘等固定网格；Stack横排需要wrap或窄屏改纵排。init只启动一次，设置副作用用onSettingsChange(s,ctx,previous)重新设置；不要在view做副作用。',
        '顶部默认 statusMode:"launcher" 为入口；只有 view 按 ctx.surface === "status" 返回单行内容时才启用 status:true,statusMode:"compact"。限高32px，桌面最大宽200px、手机140px。主窗口或可见页面小组件运行时回退入口；无运行形态后不提供后台常驻任务，计时应保存截止时间。',
        '文案简短，不加口号、重复标题、大圆角卡片或逐行上边框。完整处理空/加载/错误反馈，适配深浅色与320–375px手机。用list_applications核对配置；工具没有浏览器视觉反馈，不得声称已通过视觉验证。',
        '做游戏、Canvas/WebGL/Three.js、需要完全自定义视觉的东西，才用 create_app。',
      ].join('\n'),
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          const result = createApplication(getWorkspace(), {...args, type: 'applet', config: {source: args.source}})
          commit(args.pageId ? mountApplication(result.workspace, result.application.id, args.pageId, args.span) : result.workspace)
          return `已安装小程序，id=${result.application.id}。可从组件市场打开和设置；用 update_applet 修改。`
        }),
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({...applicationPatch(raw), ref: str(obj(raw).ref), pageId: optStr(obj(raw).pageId), source: typeof obj(raw).source === 'string' ? obj(raw).source as string : undefined})},
      json: {
        type: 'object',
        properties: {
          ...applicationProperties,
          ref: {type: 'string', description: '应用目录中的小程序 id 或标题，未挂页面也可修改'},
          pageId: {type: 'string'},
          source: {type: 'string', description: '新的脚本全文，整体替换'},
        },
        required: ['ref'],
      },
    },
    {
      name: 'update_applet',
      title: '修改小程序',
      description: '更新应用目录中的小程序脚本、打开方式、分组、入口或设置。只传要改的项；source 给出时整体替换。改之前用 list_applications 取回现有源码，在它的基础上改。写法同 create_applet（先 use_skill applet）。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          if (findApplication(getWorkspace(), args.ref).instance.type !== 'applet') throw new WorkspaceError(`${args.ref} 不是小程序`)
          const result = updateApplication(getWorkspace(), args.ref, {...args, ...(args.source !== undefined ? {config: {source: args.source}} : {})})
          commit(result.workspace)
          return `已更新小程序 ${result.application.id}。`
        }),
    },
  ),

  define(
    {schema: {parse: (raw) => ({ref: optStr(obj(raw).ref), includeSource: obj(raw).includeSource !== false})}, json: {type: 'object', properties: {ref: {type: 'string', description: '可选应用 id 或名称，只查看这一项'}, includeSource: {type: 'boolean', description: '默认 true，返回源码以便修改；只看安装和分组时可 false'}}}},
    {
      name: 'list_applications', title: '查看 AI 应用',
      description: '查看组件市场里全部 AI 应用，含分组、源码、默认打开方式、Dock/顶部入口、设置字段与当前值、页面小组件挂载位置。编辑应用前先读；应用不需要挂到页面也能安装和运行。',
      effect: 'read', highRisk: () => false,
      execute: (args) => guard(() => {
        const workspace = getWorkspace()
        const applications = args.ref ? [findApplication(workspace, args.ref)] : listApplications(workspace)
        return JSON.stringify(applications.map((application) => ({
          ...application,
          instance: args.includeSource ? application.instance : {...application.instance, config: undefined},
          mountedPages: workspace.pages.filter((page) => page.components.some((item) => item.id === application.id)).map((page) => ({id: page.id, name: page.name})),
          settingsSection: `application:${application.id}`,
        })), null, 2)
      }),
    },
  ),
  define(
    {schema: {parse: (raw) => ({ref: str(obj(raw).ref), mode: optStr(obj(raw).mode)})}, json: {type: 'object', properties: {ref: {type: 'string'}, mode: {type: 'string', enum: ['modal', 'drawer', 'page'], description: '本次打开形式，不改默认打开偏好'}}, required: ['ref']}},
    {
      name: 'open_application', title: '打开 AI 应用',
      description: '按应用 id 或名称打开已安装 AI 应用，默认用它的打开方式，可选弹窗 modal、抽屉 drawer、全页面 page。不新建页面、不固定 Dock、不修改应用数据。',
      effect: 'read', highRisk: () => false,
      execute: (args, context) => guard(() => {
        const application = findApplication(getWorkspace(), args.ref)
        if (args.mode !== undefined && !['modal', 'drawer', 'page'].includes(args.mode)) throw new WorkspaceError('mode 只能是 modal、drawer 或 page')
        if (!context.openApplication) return '当前视图无法打开应用，请从组件市场进入。'
        context.openApplication(application.id, args.mode as ApplicationOpenMode | undefined)
        return `已打开「${application.instance.title}」。`
      }),
    },
  ),
  define(
    {schema: {parse: (raw) => ({...applicationPatch(raw), ref: str(obj(raw).ref)})}, json: {type: 'object', properties: {...applicationProperties, ref: {type: 'string'}}, required: ['ref']}},
    {
      name: 'configure_application', title: '配置 AI 应用',
      description: '修改 AI 应用的名称、分组、说明、默认打开方式、Dock/顶部状态栏、用户设置值或设置字段。按用户需要固定入口。settings 按字段合并；源码用 update_app / update_applet。statusMode 默认 launcher，compact 只有源码显式按 surface:"status" 实现单行紧凑视图后才能启用，主窗口或可见小组件运行时自动回退入口。',
      effect: 'write', highRisk: () => false,
      execute: (args) => guard(() => {commit(configureApplication(getWorkspace(), args.ref, args)); return '已更新应用配置，可在组件市场与设置页查看。'}),
    },
  ),
  define(
    {schema: {parse: (raw) => ({ref: str(obj(raw).ref), pageId: obj(raw).pageId === null ? null : str(obj(raw).pageId), span: optStr(obj(raw).span)})}, json: {type: 'object', properties: {ref: {type: 'string'}, pageId: {type: ['string', 'null'], description: '页面 id；传 null 从页面移除小组件，应用仍安装在市场'}, span: applicationProperties.span}, required: ['ref', 'pageId']}},
    {
      name: 'mount_application', title: '放置应用小组件',
      description: '把已安装 AI 应用放到一个页面作为小组件，或 pageId:null 仅取消挂载。保留同一应用 id 和私有数据；一个应用只挂一个页面，避免多份运行状态互相覆盖。',
      effect: 'write', highRisk: () => false,
      execute: (args) => guard(() => {commit(mountApplication(getWorkspace(), args.ref, args.pageId, args.span)); return args.pageId === null ? '已取消页面小组件，仍可从市场打开应用。' : '已放置应用小组件。'}),
    },
  ),
  define(
    {schema: {parse: (raw) => ({ref: str(obj(raw).ref)})}, json: {type: 'object', properties: {ref: {type: 'string'}}, required: ['ref']}},
    {
      name: 'uninstall_application', title: '卸载 AI 应用',
      description: '从组件市场卸载一个 AI 应用，并移除其页面小组件、Dock 和顶部入口。保留本机私有数据，支持撤销找回。卸载前确认用户确实要删除该应用。',
      effect: 'write', highRisk: () => true,
      execute: (args) => guard(() => {commit(removeApplication(getWorkspace(), args.ref)); return '已卸载应用，所有入口已移除。可撤销，本机私有数据保留。'}),
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
