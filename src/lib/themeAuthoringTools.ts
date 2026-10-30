import {createToolFactory} from '@tulai-design/agent-core'
import {WorkspaceError} from './errors'
import {getWorkspace} from './workspaceStore'
import {themePatchJsonSchema, type ThemeField} from './themeAuthoring/catalog'
import {applyThemeDraft, createThemeDraft, describeThemeDraft, describeThemeSchema, discardThemeDraft, updateThemeDraft} from './themeAuthoring/store'
import {inspectThemeDraftPreview} from './themeAuthoring/previewBridge'
import type {HomeToolContext} from './tools'

const define = createToolFactory<HomeToolContext, void>()
type Input = Record<string, unknown>
function object(raw: unknown, allowed: string[]): Input {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new WorkspaceError('参数必须是对象')
  const value = raw as Input
  const extra = Object.keys(value).find(key => !allowed.includes(key))
  if (extra) throw new WorkspaceError(`不支持的主题草稿参数：${extra}`)
  return value
}
function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new WorkspaceError(`${field} 必须是非空字符串`)
  return value.trim()
}
function versioned(value: Input) {
  if (typeof value.expectedRevision !== 'number' || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 1) throw new WorkspaceError('expectedRevision 必须是当前草稿的正整数版本')
  return {draftId: string(value.draftId, 'draftId'), expectedRevision: value.expectedRevision}
}
const empty = (raw: unknown) => object(raw, [])
const versionProperties = {
  draftId: {type: 'string', minLength: 1, description: 'create/get_theme_draft 返回的草稿 ID'},
  expectedRevision: {type: 'integer', minimum: 1, description: '最近读取的草稿 revision；过期则先 get_theme_draft'},
}
const versionJson = {type: 'object', additionalProperties: false, properties: versionProperties, required: ['draftId', 'expectedRevision']}
const scope = '草稿只在内存中，刷新丢弃；固定示例在独立文档中预览，不运行用户应用、业务数据、模型或同步。'

/** UI 与 Agent 共用作者领域入口；工具不拼接工作空间，也不把检查结果当作审美验收。 */
export const THEME_AUTHORING_TOOLS = [
  define({
    schema: {parse: raw => {
      const value = object(raw, ['themeRef', 'group'])
      const group = value.group
      if (group !== undefined && (typeof group !== 'string' || !['tokens', 'recipes', 'shell', 'resources'].includes(group))) throw new WorkspaceError('group 必须是 tokens、recipes、shell 或 resources')
      return {themeRef: value.themeRef === undefined ? undefined : string(value.themeRef, 'themeRef'), group: group as ThemeField['group'] | undefined}
    }},
    json: {type: 'object', additionalProperties: false, properties: {
      themeRef: {type: 'string', description: '来源主题 ID 或名称；默认当前正式主题'},
      group: {type: 'string', enum: ['tokens', 'recipes', 'shell', 'resources'], description: '按需查看颜色尺寸、部件、外壳或字体资源'},
    }},
  }, {
    name: 'describe_theme_schema', title: '查看主题定制能力',
    description: '创作主题前读取适用字段、类型、范围、作用域、造型/外壳限制和两模式有效值来源。只开放实际消费的字段；任意 CSS、JSX、远端代码不在能力内。数据有效不代表可读性或视觉验收通过。',
    effect: 'read', highRisk: () => false,
    execute: async args => JSON.stringify(describeThemeSchema(getWorkspace(), args.themeRef, args.group)),
  }),
  define({
    schema: {parse: raw => {
      const value = object(raw, ['from', 'intent', 'name'])
      if (value.intent !== 'derive' && value.intent !== 'edit') throw new WorkspaceError('intent 必须明确为 derive 或 edit')
      return {intent: value.intent as 'derive' | 'edit', ...(value.from === undefined ? {} : {from: string(value.from, 'from')}), ...(value.name === undefined ? {} : {name: string(value.name, 'name')})}
    }},
    json: {type: 'object', additionalProperties: false, properties: {
      from: {type: 'string', description: '来源主题 ID 或名称；默认当前正式主题'},
      intent: {type: 'string', enum: ['derive', 'edit'], description: 'derive 完整派生新方案；edit 修改已有自定义方案，内置方案不能 edit'},
      name: {type: 'string', minLength: 1, maxLength: 20, description: '方案名称'},
    }, required: ['intent']},
  }, {
    name: 'create_theme_draft', title: '创建主题草稿',
    description: `完整复制来源设计并打开作者面板，保留 skin/shell 和未修改字段；已有草稿先读或取消，不能覆盖。${scope} 不提交正式主题，返回 id/revision 用于后续修改、检查和应用。`,
    effect: 'write', highRisk: () => false,
    execute: async args => {createThemeDraft(args); return JSON.stringify(describeThemeDraft())},
  }),
  define({schema: {parse: empty}, json: {type: 'object', additionalProperties: false, properties: {}}}, {
    name: 'get_theme_draft', title: '查看主题草稿',
    description: '读取当前草稿 ID、版本、完整设计、差异及冲突/准备状态。无草稿返回 null。所有修改、检查、应用或取消必须使用最新 revision；正式主题仍独立存在。',
    effect: 'read', highRisk: () => false,
    execute: async () => JSON.stringify(describeThemeDraft()),
  }),
  define({
    schema: {parse: raw => {
      const value = object(raw, ['draftId', 'expectedRevision', 'operations', 'name', 'description'])
      if (value.operations !== undefined && !Array.isArray(value.operations)) throw new WorkspaceError('operations 必须是目录字段修改数组')
      if (value.description !== undefined && typeof value.description !== 'string') throw new WorkspaceError('description 必须是字符串')
      return {...versioned(value), ...(value.operations === undefined ? {} : {operations: value.operations}), ...(value.name === undefined ? {} : {name: string(value.name, 'name')}), ...(value.description === undefined ? {} : {description: value.description})}
    }},
    json: {type: 'object', additionalProperties: false, properties: {
      ...versionProperties, operations: themePatchJsonSchema(),
      name: {type: 'string', minLength: 1, maxLength: 20}, description: {type: 'string', maxLength: 120},
    }, required: ['draftId', 'expectedRevision']},
  }, {
    name: 'update_theme_draft', title: '修改主题草稿',
    description: '按 describe_theme_schema 的 path/scope/value 修改，整批最多32项。颜色明确 light/dark/both，尺寸 shared，部件 recipe，外壳 shell，字体 resource；null 删除显式值，fonts:[] 明确系统后备。未知字段、错作用域、范围或能力不匹配整次失败；成功递增 revision 并使旧检查失效，不写正式主题。',
    effect: 'write', highRisk: () => false,
    execute: async args => {updateThemeDraft(args); return JSON.stringify(describeThemeDraft())},
  }),
  define({schema: {parse: raw => versioned(object(raw, ['draftId', 'expectedRevision']))}, json: versionJson}, {
    name: 'inspect_theme_draft', title: '检查主题预览',
    description: '等待指定最新版本的独立预览，报告资源状态与该固定示例容器下的有限几何。检查不会应用主题；不可用、字体降级、未测量及审美/对比度未知会明确报告，不把无溢出说成完整视觉验收。',
    effect: 'read', highRisk: () => false,
    execute: async (args, context) => JSON.stringify(await inspectThemeDraftPreview({draftId: args.draftId, revision: args.expectedRevision, signal: context?.signal})),
  }),
  define({
    schema: {parse: raw => {
      const value = object(raw, ['draftId', 'expectedRevision', 'action'])
      if (value.action !== 'apply' && value.action !== 'discard') throw new WorkspaceError('action 必须是 apply 或 discard')
      return {...versioned(value), action: value.action}
    }},
    json: {...versionJson, properties: {...versionProperties, action: {type: 'string', enum: ['apply', 'discard']}}, required: ['draftId', 'expectedRevision', 'action']},
  }, {
    name: 'finish_theme_draft', title: '应用或取消主题草稿',
    description: '用户要求应用时 action=apply：检查当前版本、来源、选择和资源，等待后再核对，一次正式提交可撤销，保留期间无关业务编辑。冲突或资源失败保留草稿，禁止强制覆盖。用户只要求预览时不能自行应用。action=discard 清空指定最新草稿且零正式写入。',
    effect: 'write', highRisk: () => false,
    execute: async (args, context) => {
      const target = {draftId: args.draftId, expectedRevision: args.expectedRevision}
      if (args.action === 'discard') discardThemeDraft(target)
      else await applyThemeDraft(target, {signal: context?.signal})
      return JSON.stringify({[args.action === 'apply' ? 'applied' : 'discarded']: true, draftId: args.draftId, revision: args.expectedRevision, undoable: args.action === 'apply'})
    },
  }),
] as const
