export const ROW_LIMIT = 500
export const COLUMN_LIMIT = 8
export const PAGE_SIZES = [5, 10, 20, 50] as const
export type DataTableCell = string | number | boolean | null
export type DataTableColumn = {key: string; label: string; type: 'text' | 'number'; priority: 1 | 2 | 3}
export type DataTableRow = {id: string; values: Record<string, DataTableCell>}
export type DataTableState = {
  query: string
  sort: {key: string; direction: 'asc' | 'desc'} | null
  page: number
  pageSize: (typeof PAGE_SIZES)[number]
  selectedIds: string[]
}
export type DataTablePatch = Partial<DataTableState>
export type DataTableData = {title: string; columns: DataTableColumn[]; rows: DataTableRow[]; state: DataTableState; selectable: boolean}
export type DataTableResult = {ok: true; data: DataTableData} | {ok: false; error: string}
export type DataTableView = {state: DataTableState; rows: DataTableRow[]; totalCount: number; filteredCount: number; pageCount: number}

/** Shared display text keeps search and rendered values consistent. */
export const dataTableText = (value: DataTableCell): string => value === null ? '—' : typeof value === 'boolean' ? value ? '是' : '否' : String(value)

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const validId = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 80
const collator = new Intl.Collator('zh-CN', {sensitivity: 'base'})

/** Validate the sandbox boundary before deriving a visible page; never truncate records. */
export function normalizeDataTable(raw: unknown): DataTableResult {
  if (!record(raw)) return {ok: false, error: '数据表参数必须是对象。'}
  if (raw.title !== undefined && !validId(raw.title)) return {ok: false, error: '数据表标题必须是 1–80 字符的文本。'}
  if (!Array.isArray(raw.columns) || !raw.columns.length || raw.columns.length > COLUMN_LIMIT) return {ok: false, error: `数据表需要 1–${COLUMN_LIMIT} 列。`}
  const columns: DataTableColumn[] = [], keys = new Set<string>()
  for (const item of raw.columns) {
    if (!record(item) || typeof item.key !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(item.key) || ['constructor', 'prototype'].includes(item.key) || keys.has(item.key)) return {ok: false, error: '列 key 必须是唯一的英文字母开头标识，不含路径或保留名称。'}
    if (!validId(item.label)) return {ok: false, error: `“${item.key}”需要 1–80 字符的列名。`}
    if (item.type !== undefined && item.type !== 'text' && item.type !== 'number') return {ok: false, error: `“${item.label}”的 type 只能是 text 或 number。`}
    if (item.priority !== undefined && item.priority !== 1 && item.priority !== 2 && item.priority !== 3) return {ok: false, error: `“${item.label}”的 priority 只能是 1、2 或 3。`}
    keys.add(item.key)
    columns.push({key: item.key, label: item.label.trim(), type: item.type ?? 'text', priority: item.priority ?? 2})
  }
  if (!Array.isArray(raw.rows) || raw.rows.length > ROW_LIMIT) return {ok: false, error: `rows 必须是最多 ${ROW_LIMIT} 条记录的数组；先整理数据，不要静默截断。`}
  const rows: DataTableRow[] = [], ids = new Set<string>()
  for (const [index, item] of raw.rows.entries()) {
    if (!record(item) || !validId(item.id) || ids.has(item.id)) return {ok: false, error: `第 ${index + 1} 条记录需要唯一且稳定的 1–80 字符 id。`}
    if (!record(item.values)) return {ok: false, error: `记录“${item.id}”缺少 values 对象。`}
    const values: Record<string, DataTableCell> = {}
    for (const column of columns) {
      const value = item.values[column.key]
      if (!Object.hasOwn(item.values, column.key)) return {ok: false, error: `记录“${item.id}”缺少“${column.label}”；未知值使用 null。`}
      const scalar = value === null || typeof value === 'boolean' || typeof value === 'string' && value.length <= 500 || typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e12
      if (!scalar || column.type === 'number' && value !== null && typeof value !== 'number') return {ok: false, error: `记录“${item.id}”的“${column.label}”无效；文本最多 500 字符，数字须有限且绝对值不超过 1e12，缺失用 null。`}
      values[column.key] = value as DataTableCell
    }
    ids.add(item.id)
    rows.push({id: item.id, values})
  }
  if (!record(raw.state)) return {ok: false, error: 'state 必须是受控视图状态对象。'}
  const state = raw.state
  if (state.query !== undefined && (typeof state.query !== 'string' || state.query.length > 200)) return {ok: false, error: '查询文本最多 200 字符。'}
  let sort: DataTableState['sort'] = null
  if (state.sort !== undefined && state.sort !== null) {
    if (!record(state.sort) || typeof state.sort.key !== 'string' || !keys.has(state.sort.key) || state.sort.direction !== 'asc' && state.sort.direction !== 'desc') return {ok: false, error: '排序需要已有列 key 和 asc 或 desc 方向。'}
    sort = {key: state.sort.key, direction: state.sort.direction}
  }
  if (state.page !== undefined && (typeof state.page !== 'number' || !Number.isSafeInteger(state.page) || state.page < 0)) return {ok: false, error: 'page 必须是从 0 开始的非负整数。'}
  if (state.pageSize !== undefined && !PAGE_SIZES.includes(state.pageSize as DataTableState['pageSize'])) return {ok: false, error: 'pageSize 只能是 5、10、20 或 50。'}
  if (state.selectedIds !== undefined && (!Array.isArray(state.selectedIds) || state.selectedIds.length > ROW_LIMIT)) return {ok: false, error: `selectedIds 必须是最多 ${ROW_LIMIT} 个 id 的数组。`}
  const selectedIds: string[] = []
  for (const id of (state.selectedIds ?? []) as unknown[]) {
    if (!validId(id)) return {ok: false, error: 'selectedIds 中的 id 必须是 1–80 字符的文本。'}
    if (!selectedIds.includes(id)) selectedIds.push(id)
  }
  if (raw.selectable !== undefined && typeof raw.selectable !== 'boolean') return {ok: false, error: 'selectable 必须是布尔值。'}
  return {ok: true, data: {title: typeof raw.title === 'string' ? raw.title.trim() : '记录', columns, rows, selectable: raw.selectable === true, state: {query: typeof state.query === 'string' ? state.query : '', sort, page: typeof state.page === 'number' ? state.page : 0, pageSize: state.pageSize as DataTableState['pageSize'] | undefined ?? 10, selectedIds}}}
}

export function deriveDataTable(data: DataTableData, state: DataTableState = data.state): DataTableView {
  const query = state.query.trim().toLocaleLowerCase('zh-CN')
  const filtered = data.rows.filter(row => !query || data.columns.some(column => dataTableText(row.values[column.key]).toLocaleLowerCase('zh-CN').includes(query)))
  const column = state.sort && data.columns.find(item => item.key === state.sort?.key)
  if (column && state.sort) {
    const direction = state.sort.direction === 'asc' ? 1 : -1
    filtered.sort((a, b) => {
      const av = a.values[column.key], bv = b.values[column.key]
      if (av === null || bv === null) return av === bv ? 0 : av === null ? 1 : -1
      return direction * (column.type === 'number' ? (av as number) - (bv as number) : collator.compare(dataTableText(av), dataTableText(bv)))
    })
  }
  const pageCount = Math.max(1, Math.ceil(filtered.length / state.pageSize))
  const page = Math.min(state.page, pageCount - 1)
  const ids = new Set(data.rows.map(row => row.id))
  const selectedIds = [...new Set(state.selectedIds)].filter(id => ids.has(id))
  return {state: {...state, sort: state.sort && {...state.sort}, selectedIds, page}, rows: filtered.slice(page * state.pageSize, (page + 1) * state.pageSize), totalCount: data.rows.length, filteredCount: filtered.length, pageCount}
}
