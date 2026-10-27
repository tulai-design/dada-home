import {WorkspaceError} from './errors'
import type {ComponentInstance, Page, PageSection} from './workspace'

export const PAGE_SECTION_CATALOG = {
  maxSections: 8,
  maxHero: 1,
  compactWidth: 720,
  order: '分区依次展开；split先primary再secondary；未分组组件按原相对顺序追加。这也是键盘和窄容器阅读顺序。',
  clear: 'sections传null或[]恢复扁平布局，保留当前组件顺序、宽度、ID、配置和应用数据。',
  rules: 'id为1–48位ASCII字母、数字、下划线或短横线，全页唯一；title可省略、最多80字；每个组件只能引用一次且必须属于本页。实际内容容器小于720px时单列；空分区不显示标题或占位。',
  layouts: [
    {kind: 'hero', name: '主视觉', description: '按items顺序满行展示现有内容，每页至多一个；不自动新建内容或增加动画。', fields: {items: '组件ID数组', align: ['start', 'center']}, defaults: {align: 'start'}},
    {kind: 'section', name: '内容分区', description: '现有组件组成1–3等列；标题可选。', fields: {items: '组件ID数组', columns: [1, 2, 3]}, defaults: {columns: 2}},
    {kind: 'split', name: '主次分栏', description: '主栏与辅栏按相同行索引对齐；窄容器先主栏后辅栏，不提供独立列瀑布流。', fields: {primary: '主栏组件ID数组', secondary: '辅栏组件ID数组', ratio: ['equal', 'wide-primary']}, defaults: {ratio: 'wide-primary'}},
  ],
} as const

const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const sectionRefs = (section: PageSection): string[] => section.kind === 'split' ? [...section.primary, ...section.secondary] : section.items

/** 新写入严格拒绝错误；历史读取过滤坏引用，但从不删除组件实体。 */
function parseSections(raw: unknown, components: readonly ComponentInstance[], strict: boolean): PageSection[] | undefined {
  if (raw === null || raw === undefined && !strict) return undefined
  if (!Array.isArray(raw)) {
    if (strict) throw new WorkspaceError('sections 必须是数组，传 null 可清除分区')
    return undefined
  }
  if (strict && raw.length > PAGE_SECTION_CATALOG.maxSections) throw new WorkspaceError('每页最多 8 个分区')
  const known = new Set(components.map((item) => item.id))
  const used = new Set<string>(), ids = new Set<string>()
  const sections: PageSection[] = []
  let hasHero = false
  for (const rawSection of raw) {
    if (sections.length >= PAGE_SECTION_CATALOG.maxSections) break
    try {
      const value = record(rawSection)
      if (!value || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,48}$/.test(value.id) || ids.has(value.id)) throw new WorkspaceError('分区 id 必须是唯一的 1–48 位字母、数字、下划线或短横线')
      if (value.kind !== 'hero' && value.kind !== 'section' && value.kind !== 'split') throw new WorkspaceError('分区 kind 只能是 hero / section / split')
      if (value.kind === 'hero' && hasHero) throw new WorkspaceError('每页只能有一个主视觉分区')
      if (value.title !== undefined && (typeof value.title !== 'string' || value.title.trim().length > 80)) throw new WorkspaceError('分区标题必须是最多 80 字的字符串')
      const allowed = new Set(['id', 'kind', 'title', ...(value.kind === 'split' ? ['primary', 'secondary', 'ratio'] : value.kind === 'hero' ? ['items', 'align'] : ['items', 'columns'])])
      if (strict && Object.keys(value).some((key) => !allowed.has(key))) throw new WorkspaceError(`分区 ${value.id} 包含不支持的字段`)
      if (value.kind === 'hero' && value.align !== undefined && value.align !== 'start' && value.align !== 'center') throw new WorkspaceError('hero.align 只能是 start / center')
      if (value.kind === 'section' && value.columns !== undefined && ![1, 2, 3].includes(value.columns as number)) throw new WorkspaceError('section.columns 只能是 1 / 2 / 3')
      if (value.kind === 'split' && value.ratio !== undefined && value.ratio !== 'equal' && value.ratio !== 'wide-primary') throw new WorkspaceError('split.ratio 只能是 equal / wide-primary')
      const local = new Set(used)
      const refs = (input: unknown): string[] => {
        if (!Array.isArray(input)) throw new WorkspaceError(`分区 ${value.id} 的组件引用必须是数组`)
        const kept: string[] = []
        for (const id of input) {
          if (typeof id !== 'string' || !known.has(id) || local.has(id)) {
            if (strict) throw new WorkspaceError(`分区 ${value.id} 的组件引用不存在或重复：${String(id)}`)
            continue
          }
          local.add(id); kept.push(id)
        }
        return kept
      }
      const title = typeof value.title === 'string' && value.title.trim() ? {title: value.title.trim()} : {}
      const common = {id: value.id, ...title}
      const section: PageSection = value.kind === 'split'
        ? {...common, kind: 'split', primary: refs(value.primary), secondary: refs(value.secondary), ratio: value.ratio === 'equal' ? 'equal' : 'wide-primary'}
        : value.kind === 'hero'
          ? {...common, kind: 'hero', items: refs(value.items), align: value.align === 'center' ? 'center' : 'start'}
          : {...common, kind: 'section', items: refs(value.items), columns: (value.columns ?? 2) as 1 | 2 | 3}
      sections.push(section); ids.add(section.id)
      if (section.kind === 'hero') hasHero = true
      for (const id of local) used.add(id)
    } catch (error) {
      if (strict) throw error
    }
  }
  return sections.length ? sections : undefined
}

export const readPageSections = (raw: unknown, components: readonly ComponentInstance[]): PageSection[] | undefined => parseSections(raw, components, false)

function withSections(page: Page, sections: PageSection[] | undefined): Page {
  if (!sections) {
    if (page.sections === undefined) return page
    const {sections: _sections, ...rest} = page
    return rest
  }
  const lookup = new Map(page.components.map((item) => [item.id, item]))
  const referenced = sections.flatMap(sectionRefs)
  const grouped = new Set(referenced)
  return {...page, sections, components: [...referenced.map((id) => lookup.get(id)!), ...page.components.filter((item) => !grouped.has(item.id))]}
}

export function setPageSections(page: Page, raw: unknown): Page {
  return withSections(page, parseSections(raw, page.components, true))
}

/** 调整组件集合后清理悬空引用，并保持一份阅读顺序。 */
export function normalizePageSections(page: Page): Page {
  return page.sections === undefined ? page : withSections(page, readPageSections(page.sections, page.components))
}

/** 插入点属于目标组件的槽位；末尾及未分组目标仍落在未分组区域。 */
export function insertPageComponent(page: Page, instance: ComponentInstance, index?: number): Page {
  const base = normalizePageSections({...page, components: page.components.filter((item) => item.id !== instance.id)})
  const components = [...base.components]
  const at = index === undefined ? components.length : Math.max(0, Math.min(components.length, Number.isFinite(index) ? Math.trunc(index) : components.length))
  const anchor = components[at]?.id
  const insert = (refs: string[]) => {
    const where = anchor === undefined ? -1 : refs.indexOf(anchor)
    return where < 0 ? refs : [...refs.slice(0, where), instance.id, ...refs.slice(where)]
  }
  const sections = base.sections?.map((section): PageSection => section.kind === 'split'
    ? {...section, primary: insert(section.primary), secondary: insert(section.secondary)}
    : {...section, items: insert(section.items)})
  components.splice(at, 0, instance)
  return normalizePageSections({...base, components, ...(sections ? {sections} : {})})
}

/** 内置模板换实例ID时，共用同一映射更新引用；自存模板不调用。 */
export function remapPageSectionIds(sections: PageSection[] | undefined, ids: ReadonlyMap<string, string>): PageSection[] | undefined {
  const remap = (refs: string[]) => refs.map((id) => ids.get(id) ?? id)
  return sections?.map((section): PageSection => section.kind === 'split'
    ? {...section, primary: remap(section.primary), secondary: remap(section.secondary)}
    : {...section, items: remap(section.items)})
}
