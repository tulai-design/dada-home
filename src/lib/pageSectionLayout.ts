import type {ComponentInstance, Page, PageSection} from './workspace'

type Placement = {row?: number; column?: string; sectionId?: string; kind?: PageSection['kind']; align?: 'start' | 'center'; start?: 'group' | 'row'}
export type PageLayoutEntry =
  | ({type: 'widget'; instance: ComponentInstance} & Placement)
  | ({type: 'heading'; title: string; sectionId: string} & Placement)

/** One flat child list preserves component identity when sections, width or theme change. */
export function planPageSections(page: Page, columnsOf: (instance: ComponentInstance) => number): PageLayoutEntry[] {
  if (!page.sections?.length) return page.components.map((instance) => ({type: 'widget', instance}))
  const entries: PageLayoutEntry[] = []
  const instances = new Map(page.components.map((instance) => [instance.id, instance]))
  const used = new Set<string>()
  let row = 1
  const take = (ids: string[]) => ids.flatMap((id) => {
    const instance = instances.get(id)
    if (!instance || used.has(id)) return []
    used.add(id)
    return [instance]
  })
  for (const section of page.sections) {
    const primary = take(section.kind === 'split' ? section.primary : section.items)
    const secondary = section.kind === 'split' ? take(section.secondary) : []
    if (!primary.length && !secondary.length) continue
    const base = {sectionId: section.id, kind: section.kind, ...(section.kind === 'hero' ? {align: section.align ?? 'start'} : {})}
    const gap = entries.length > 0
    if (section.title) entries.push({type: 'heading', ...base, title: section.title, row: row++, column: '1 / -1', start: gap ? 'group' : undefined})
    if (section.kind === 'split') {
      const primaryColumns = section.ratio === 'equal' ? 6 : 8
      primary.forEach((instance, index) => entries.push({type: 'widget', instance, ...base, row: row + index, column: `1 / span ${primaryColumns}`, start: gap && !section.title && index === 0 ? 'group' : undefined}))
      secondary.forEach((instance, index) => entries.push({type: 'widget', instance, ...base, row: row + index, column: `${primaryColumns + 1} / -1`, start: gap && !section.title && index === 0 ? (primary.length ? 'row' : 'group') : undefined}))
      row += Math.max(primary.length, secondary.length)
    } else {
      const columns = section.kind === 'hero' ? 1 : section.columns ?? 2
      const span = 12 / columns
      primary.forEach((instance, index) => entries.push({type: 'widget', instance, ...base, row: row + Math.floor(index / columns), column: `${(index % columns) * span + 1} / span ${span}`, start: gap && !section.title && index < columns ? (index === 0 ? 'group' : 'row') : undefined}))
      row += Math.ceil(primary.length / columns)
    }
  }
  // Unassigned components stay visible and retain their span, after the structured content.
  let column = 1
  for (const instance of page.components) {
    if (used.has(instance.id)) continue
    const span = Math.max(1, Math.min(12, columnsOf(instance)))
    if (column + span > 13) {row += 1; column = 1}
    entries.push({type: 'widget', instance, row, column: `${column} / span ${span}`})
    column += span
  }
  return entries
}
