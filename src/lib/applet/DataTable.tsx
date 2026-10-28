import {useEffect, useId, useRef, useState} from 'react'
import {Button, Checkbox, Empty, Input, Select, Table, Text, type TableColumnsType} from '@lobehub/ui'
import {dataTableText, deriveDataTable, normalizeDataTable, PAGE_SIZES, type DataTableData, type DataTablePatch, type DataTableRow, type DataTableState} from './dataTableData'
import {useContainerWidth} from './useContainerWidth'
import '../../applet-data-table.css'

const stateKeys = ['query', 'sort', 'page', 'pageSize', 'selectedIds'] as const
const encode = (value: unknown) => JSON.stringify(value)
const originalOrder = '__original'

/** Keep each optimistic slice until its echo arrives; unrelated patches cannot overwrite it. */
function useTableState(prop: DataTableState, snapshot: unknown, onChange: (patch: DataTablePatch) => void) {
  const [local, setLocal] = useState(prop)
  const current = useRef(local)
  const previous = useRef(prop)
  const sent = useRef(new Map<keyof DataTableState, Set<string>>())
  useEffect(() => {
    const next = {...current.current}
    for (const key of stateKeys) {
      const value = encode(prop[key])
      if (value === encode(current.current[key])) {
        sent.current.delete(key)
        continue
      }
      if (value === encode(previous.current[key]) || sent.current.get(key)?.has(value)) continue
      Object.assign(next, {[key]: prop[key]})
      sent.current.delete(key)
    }
    previous.current = prop
    current.current = next
    setLocal(next)
    // A new sandbox snapshot may acknowledge coalesced edits even when its values are unchanged.
    // Container rerenders keep the original snapshot, so they are not acknowledgements.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot])
  const patch = (change: DataTablePatch) => {
    for (const key of stateKeys) if (Object.hasOwn(change, key)) {
      const pending = sent.current.get(key) ?? new Set<string>()
      pending.add(encode(change[key]))
      while (pending.size > 64) pending.delete(pending.values().next().value!)
      sent.current.set(key, pending)
    }
    current.current = {...current.current, ...change}
    setLocal(current.current)
    onChange(change)
  }
  return [local, patch] as const
}

export function DataTable({p, onChange}: {p: Record<string, unknown>; onChange?: (patch: DataTablePatch) => void}) {
  const {ref, width} = useContainerWidth()
  const result = normalizeDataTable(p)
  const error = !result.ok ? result.error : !onChange ? '数据表需要 onChange 事件以保存视图操作。' : null
  return <div ref={ref} className="ap-data-table-container">
    {error ? <div role="alert" className="ap-data-table-error"><Text type="danger" fontSize={12}>{error}</Text></div>
      : result.ok && onChange && <DataTableView data={result.data} snapshot={p.state} width={width} onChange={onChange} />}
  </div>
}

function DataTableView({data, snapshot, width, onChange}: {data: DataTableData; snapshot: unknown; width: number; onChange: (patch: DataTablePatch) => void}) {
  const id = useId()
  const [local, patch] = useTableState(data.state, snapshot, onChange)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const view = deriveDataTable(data, local)
  const state = view.state
  const priority = [...data.columns].sort((a, b) => a.priority - b.priority)
  const limit = width < 480 ? 1 : width < 720 ? 2 : 4
  const visible = priority.slice(0, limit)
  const primary = priority[0]
  const rowLabel = (row: DataTableRow) => dataTableText(row.values[primary.key])
  // UTF-16 code units also handle valid JSON strings containing lone surrogates.
  const detailId = (row: DataTableRow) => `${id}-detail-${row.id.split('').map(unit => unit.charCodeAt(0).toString(16)).join('-')}`
  const selected = new Set(state.selectedIds)
  const allSelected = view.rows.length > 0 && view.rows.every(row => selected.has(row.id))
  const someSelected = view.rows.some(row => selected.has(row.id))
  const selectPage = (checked: boolean) => {
    const next = new Set(state.selectedIds)
    for (const row of view.rows) checked ? next.add(row.id) : next.delete(row.id)
    patch({selectedIds: [...next]})
  }
  const columns: TableColumnsType<DataTableRow> = visible.map(column => ({
    key: column.key,
    title: column.label,
    rowScope: column.key === primary.key ? 'row' : undefined,
    align: column.type === 'number' ? 'right' : 'left',
    onHeaderCell: () => ({scope: 'col', 'aria-sort': state.sort?.key === column.key ? state.sort.direction === 'asc' ? 'ascending' : 'descending' : undefined}),
    render: (_value: unknown, row: DataTableRow) => <span className="ap-data-table-value">{dataTableText(row.values[column.key])}</span>,
  }))
  if (data.selectable) columns.unshift({
    key: '_selection', width: 56,
    onCell: () => ({style: {padding: '0 4px'}}),
    onHeaderCell: () => ({style: {padding: '0 4px'}}),
    title: <Checkbox aria-label="全选当前页" checked={allSelected} indeterminate={someSelected && !allSelected} disabled={!view.rows.length} onChange={selectPage} className="ap-data-table-checkbox" classNames={{text: 'ap-data-table-sr-only'}}>全选当前页</Checkbox>,
    render: (_value: unknown, row: DataTableRow) => <Checkbox aria-label={`选择 ${rowLabel(row)}`} checked={selected.has(row.id)} onChange={checked => {
      const next = new Set(state.selectedIds)
      checked ? next.add(row.id) : next.delete(row.id)
      patch({selectedIds: [...next]})
    }} className="ap-data-table-checkbox" classNames={{text: 'ap-data-table-sr-only'}}>选择 {rowLabel(row)}</Checkbox>,
  })
  columns.push({
    key: '_details', title: '详情', width: 72,
    render: (_value: unknown, row: DataTableRow) => {
      const expanded = expandedId === row.id
      return <Button type="text" className="ap-data-table-details-button" aria-label={`${expanded ? '收起' : '查看'} ${rowLabel(row)} 的详情`} aria-expanded={expanded} aria-controls={detailId(row)} onClick={() => setExpandedId(expanded ? null : row.id)}>{expanded ? '收起' : '详情'}</Button>
    },
  })
  return <section className="ap-data-table" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`} className="ap-data-table-title">{data.title}</h3>
    <div className="ap-data-table-search">
      <Input aria-label="搜索记录" placeholder="搜索全部字段" value={state.query} maxLength={200} onValueChange={query => patch({query, page: 0})} style={{width: '100%', minWidth: 0}} />
      {state.query && <Button type="text" onClick={() => patch({query: '', page: 0})}>清空搜索</Button>}
    </div>
    <div className="ap-data-table-toolbar">
      <label htmlFor={`${id}-sort`} className="ap-data-table-control-label">排序字段</label>
      <Select id={`${id}-sort`} value={state.sort?.key ?? originalOrder} options={[{value: originalOrder, label: '原顺序'}, ...data.columns.map(column => ({value: column.key, label: column.label}))]} onChange={key => {
        if (typeof key === 'string') patch({sort: key !== originalOrder ? {key, direction: 'asc'} : null, page: 0})
      }} style={{width: 160, minWidth: 0, maxWidth: '100%'}} />
      {state.sort && <Button type="text" aria-label={state.sort.direction === 'asc' ? '升序' : '降序'} onClick={() => patch({sort: {...state.sort!, direction: state.sort!.direction === 'asc' ? 'desc' : 'asc'}, page: 0})}>{state.sort.direction === 'asc' ? '升序' : '降序'}</Button>}
    </div>
    <div className="ap-data-table-summary" aria-live="polite">
      <span>{state.query.trim() ? `${view.filteredCount} 条匹配 · 共 ${view.totalCount} 条` : `共 ${view.totalCount} 条`}</span>
      {data.selectable && <><span>已选 {state.selectedIds.length} 条</span>{state.selectedIds.length > 0 && <Button type="text" onClick={() => patch({selectedIds: []})}>清空选择</Button>}</>}
    </div>
    <Table<DataTableRow>
      className="ap-data-table-grid"
      rowKey="id"
      columns={columns}
      dataSource={view.rows}
      pagination={false}
      tableLayout="fixed"
      variant="borderless"
      size="small"
      onRow={row => ({'data-row-id': row.id, 'aria-selected': data.selectable ? selected.has(row.id) : undefined})}
      locale={{emptyText: <Empty title={view.totalCount ? '没有匹配的记录' : '暂无记录'} description={view.totalCount ? '试试其他关键词，或清空搜索。' : '添加记录后在这里查看和整理。'} />}}
      expandable={{
        showExpandColumn: false,
        expandedRowKeys: expandedId ? [expandedId] : [],
        expandedRowRender: row => <div id={detailId(row)} role="region" aria-label={`${rowLabel(row)}详情`} className="ap-data-table-detail">
          <dl>{data.columns.map(column => <div key={column.key}><dt>{column.label}</dt><dd>{dataTableText(row.values[column.key])}</dd></div>)}</dl>
        </div>,
      }}
    />
    <div className="ap-data-table-pagination">
      <div className="ap-data-table-pages">
        <Button disabled={state.page === 0} onClick={() => patch({page: state.page - 1})}>上一页</Button>
        <span aria-live="polite">第 {state.page + 1} / {view.pageCount} 页</span>
        <Button disabled={state.page + 1 >= view.pageCount} onClick={() => patch({page: state.page + 1})}>下一页</Button>
      </div>
      <div className="ap-data-table-page-size">
        <label htmlFor={`${id}-size`} className="ap-data-table-control-label">每页条数</label>
        <Select id={`${id}-size`} value={state.pageSize} options={PAGE_SIZES.map(value => ({value, label: `${value} 条`}))} onChange={pageSize => {
          const size = PAGE_SIZES.find(value => value === pageSize)
          if (size !== undefined) patch({pageSize: size, page: 0})
        }} style={{width: 96}} />
      </div>
    </div>
  </section>
}
