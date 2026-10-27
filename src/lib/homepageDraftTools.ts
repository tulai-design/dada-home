import {createToolFactory} from '@tulai-design/agent-core'
import {WorkspaceError} from './errors'
import {listHomepageRecipes} from './homepageRecipes'
import {applyHomepageDraft, createHomepageDraft, describeHomepageDraft, discardHomepageDraft, updateHomepageDraft} from './homepageDraft'
import {unavailableHomepageDraftInspection} from './homepageDraftInspection'
import type {HomeToolContext} from './tools'

const define = createToolFactory<HomeToolContext, void>()
type Input = Record<string, unknown>
const object = (raw: unknown, allowed: string[]): Input => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new WorkspaceError('参数必须是对象')
  const input = raw as Input
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new WorkspaceError('包含不支持的草稿字段')
  return input
}
const string = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new WorkspaceError(`${name} 必须是非空字符串`)
  return value.trim()
}
const recipe = (value: unknown): string => {
  const id = string(value, 'recipeId')
  if (!listHomepageRecipes().recipes.some((item) => item.id === id)) throw new WorkspaceError('recipeId 必须是目录中的首页组合')
  return id
}
const revision = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new WorkspaceError('expectedRevision 必须是当前草稿的正整数版本')
  return value
}
const empty = (raw: unknown) => object(raw, [])
const identity = (raw: unknown) => {
  const input = object(raw, ['draftId'])
  return {draftId: string(input.draftId, 'draftId')}
}
const versioned = (input: Input) => ({draftId: string(input.draftId, 'draftId'), expectedRevision: revision(input.expectedRevision)})
const recipeProperties = {
  recipeId: {type: 'string', enum: ['minimal', 'productivity', 'editorial', 'showcase'], description: 'list_homepage_recipes 的方向 ID；只组织当前首页已有内容'},
  focusId: {type: 'string', minLength: 1, description: '可选的首页已有组件 ID，指定主视觉焦点；不复制、添加或移动其他页面内容'},
}
const draftProperties = {draftId: {type: 'string', minLength: 1, description: 'create/get_homepage_draft 返回的草稿 ID'}}
const versionProperties = {...draftProperties, expectedRevision: {type: 'integer', minimum: 1, description: '最近读取的草稿 revision；旧版本拒绝执行，先重新 get_homepage_draft'}}
const draftJson = {type: 'object', additionalProperties: false, properties: draftProperties, required: ['draftId']}
const scope = '仅预览首页布局。应用、业务数据、壁纸及动态效果不在草稿中运行，静态占位的内部视觉未知；草稿只在内存中，刷新丢弃。'

/** 草稿操作显式分离于正式页面工具；领域错误交给统一工具分发，失败不能记作成功。 */
export const HOMEPAGE_DRAFT_TOOLS = [
  define({schema: {parse: empty}, json: {type: 'object', additionalProperties: false, properties: {}}}, {
    name: 'list_homepage_recipes', title: '查看首页组合',
    description: '查看极简启动页、效率工作台、编辑式内容页和视觉展示页的规则。首页改版先选组合并创建草稿，保留现有组件、应用 ID 与数据，不自动安装功能或覆盖整套模板。',
    effect: 'read', highRisk: () => false,
    execute: async () => JSON.stringify({...listHomepageRecipes(), scope}),
  }),
  define({
    schema: {parse: (raw) => {
      const input = object(raw, ['recipeId', 'focusId'])
      return {recipeId: recipe(input.recipeId), ...(input.focusId === undefined ? {} : {focusId: string(input.focusId, 'focusId')})}
    }},
    json: {type: 'object', additionalProperties: false, properties: recipeProperties, required: ['recipeId']},
  }, {
    name: 'create_homepage_draft', title: '预览首页方案',
    description: `从当前首页生成隔离草稿并显示布局预览；已有草稿时不会覆盖，先读或取消。${scope} 正式页面不变；返回 draftId/revision 后用 update_homepage_draft 修正，inspect_homepage_draft 检查。`,
    effect: 'write', highRisk: () => false,
    execute: async (args) => {createHomepageDraft(args); return JSON.stringify(describeHomepageDraft())},
  }),
  define({schema: {parse: empty}, json: {type: 'object', additionalProperties: false, properties: {}}}, {
    name: 'get_homepage_draft', title: '查看首页草稿',
    description: '读取当前临时草稿的 ID、版本、分区、有效阅读顺序、组件摘要与正式首页冲突状态；不读取业务数据。返回 null 表示没有草稿。修改和应用必须使用这里的最新 revision。',
    effect: 'read', highRisk: () => false,
    execute: async () => JSON.stringify(describeHomepageDraft()),
  }),
  define({
    schema: {parse: (raw) => {
      const input = object(raw, ['draftId', 'expectedRevision', 'recipeId', 'focusId', 'sections'])
      const hasSections = Object.prototype.hasOwnProperty.call(input, 'sections')
      const hasRecipe = Object.prototype.hasOwnProperty.call(input, 'recipeId')
      if (hasSections === hasRecipe) throw new WorkspaceError('必须且只能提供 sections 或 recipeId 其中一个')
      const id = versioned(input)
      if (hasSections) {
        if (input.sections === undefined || input.sections !== null && !Array.isArray(input.sections)) throw new WorkspaceError('sections 必须是数组或显式 null')
        if (input.focusId !== undefined) throw new WorkspaceError('focusId 只能与 recipeId 一起提供')
        return {...id, sections: input.sections}
      }
      return {...id, recipeId: recipe(input.recipeId), ...(input.focusId === undefined ? {} : {focusId: string(input.focusId, 'focusId')})}
    }},
    json: {
      type: 'object', additionalProperties: false,
      properties: {
        ...versionProperties, ...recipeProperties,
        sections: {description: '整体替换草稿分区；hero/section/split 的字段见 list_page_layouts。仅引用草稿已有组件，最多8区。null/[]明确清除结构；省略不表示清除。与recipeId互斥。', anyOf: [{type: 'null'}, {type: 'array', maxItems: 8, items: {type: 'object', properties: {id: {type: 'string'}, kind: {type: 'string', enum: ['hero', 'section', 'split']}, title: {type: 'string'}, items: {type: 'array', items: {type: 'string'}}, primary: {type: 'array', items: {type: 'string'}}, secondary: {type: 'array', items: {type: 'string'}}, align: {type: 'string', enum: ['start', 'center']}, columns: {type: 'integer', enum: [1, 2, 3]}, ratio: {type: 'string', enum: ['equal', 'wide-primary']}}, required: ['id', 'kind']}}]},
      }, required: ['draftId', 'expectedRevision'],
      oneOf: [{required: ['sections'], not: {anyOf: [{required: ['recipeId']}, {required: ['focusId']}]}}, {required: ['recipeId'], not: {required: ['sections']}}],
    },
  }, {
    name: 'update_homepage_draft', title: '调整首页草稿',
    description: '修正当前草稿的分区或切换组合方向。只改临时布局，不提交正式页面，不新增或删除内容；必须提供当前 draftId/expectedRevision。成功后 revision 递增，重新检查；不要用正式 set_page_sections 代替。',
    effect: 'write', highRisk: () => false,
    execute: async (args) => {updateHomepageDraft(args); return JSON.stringify(describeHomepageDraft())},
  }),
  define({schema: {parse: identity}, json: draftJson}, {
    name: 'inspect_homepage_draft', title: '检查首页草稿布局',
    description: '只读检查当前可见草稿的真实容器和组件外框，报告带 draftId/revision、主题、尺寸及静态预览 unknown。不会导航或应用，不读取私有值。issues为空只代表该尺寸下的有限测量，不能证明应用内部、照片/特效、对比度或审美通过。',
    effect: 'read', highRisk: () => false,
    execute: async (args, context) => JSON.stringify(context?.inspectHomepageDraft
      ? await context.inspectHomepageDraft(args, context.signal)
      : unavailableHomepageDraftInspection(args.draftId, 'host-unavailable', '当前宿主没有提供首页草稿检查能力。')),
  }),
  define({
    schema: {parse: (raw) => versioned(object(raw, ['draftId', 'expectedRevision']))},
    json: {type: 'object', additionalProperties: false, properties: versionProperties, required: ['draftId', 'expectedRevision']},
  }, {
    name: 'apply_homepage_draft', title: '应用首页草稿',
    description: '用户确认后，将指定最新草稿的分区与顺序整体应用到首页，一次提交可撤销。保留组件 ID、内容、应用与数据。正式首页自创建后有变化则拒绝覆盖，草稿保留；不强制覆盖或自动重建。成功后清除草稿。',
    effect: 'write', highRisk: () => true,
    execute: async (args) => {applyHomepageDraft(args); return JSON.stringify({applied: true, draftId: args.draftId, revision: args.expectedRevision, undoable: true})},
  }),
  define({schema: {parse: identity}, json: draftJson}, {
    name: 'discard_homepage_draft', title: '取消首页草稿',
    description: '丢弃指定临时草稿并关闭预览，不修改正式首页、撤销历史或任何业务数据。ID不匹配会拒绝，避免取消另一个方案。',
    effect: 'write', highRisk: () => false,
    execute: async (args) => {discardHomepageDraft(args); return JSON.stringify({discarded: true, draftId: args.draftId})},
  }),
] as const
