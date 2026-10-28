/** This same executable source is delivered to the AI guide and exercised by the runner tests. */
export const RECORD_APPLET_SOURCE = `
const applyPageSize = (s, ctx) => {
  s.table.pageSize = ['5', '10', '20'].includes(ctx.settings.pageSize) ? Number(ctx.settings.pageSize) : 5
  s.table.page = 0
}
applet({
  state: {records: [], nextId: 1, title: '', amount: 0, category: '生活', note: '', error: '', table: {query: '', sort: null, page: 0, pageSize: 5, selectedIds: []}},
  persist: ['records', 'nextId'],
  init: applyPageSize,
  onSettingsChange: applyPageSize,
  view: (s, ctx) => {
    if (ctx.surface === 'status') return ui.Text({text: s.records.length + ' 笔记录', size: 'sm', mono: true})
    const add = () => {
      const title = s.title.trim()
      if (!title) {s.error = '填写项目名称'; return}
      if (title.length > 80) {s.error = '项目名称最多 80 字符'; return}
      if (!Number.isFinite(s.amount) || s.amount < 0 || s.amount > 1e9) {s.error = '金额须在 0–1000000000 之间'; return}
      if (s.note.length > 200) {s.error = '备注最多 200 字符'; return}
      if (s.records.length >= 100) {s.error = '最多保留 100 条记录，先删除一些再添加'; return}
      s.records.unshift({id: 'record-' + s.nextId++, title, amount: s.amount, category: s.category, note: s.note})
      s.title = ''; s.note = ''; s.error = ''; s.table.query = ''; s.table.page = 0
    }
    const remove = () => {
      const selected = new Set(s.table.selectedIds)
      s.records = s.records.filter(record => !selected.has(record.id))
      s.table.selectedIds = []; s.error = ''
    }
    return ui.Stack({gap: 16}, [
      ui.Stack({direction: ctx.viewport.compact ? 'column' : 'row', align: 'stretch', gap: 12}, [
        ui.Stack({gap: 8, grow: true}, [ui.Text({text: '项目', size: 'sm'}), ui.Input({value: s.title, placeholder: '项目', maxLength: 80, onChange: value => {s.title = value}, onEnter: add})]),
        ui.Stack({gap: 8}, [ui.Text({text: '金额（元）', size: 'sm'}), ui.NumberInput({value: s.amount, min: 0, max: 1e9, step: 1, onChange: value => {s.amount = value}})]),
        ui.Stack({gap: 8}, [ui.Text({text: '分类', size: 'sm'}), ui.Select({value: s.category, options: ['生活', '工作', '其他'], onChange: value => {s.category = value}})]),
      ]),
      ui.TextArea({value: s.note, placeholder: '备注（选填）', rows: 2, onChange: value => {s.note = value}}),
      ui.Stack({direction: 'row', gap: 8}, [
        ui.Button({label: '添加记录', variant: 'primary', onClick: add}),
        ui.Button({label: '删除所选', variant: 'text', danger: true, disabled: s.table.selectedIds.length === 0, onClick: remove}),
      ]),
      s.error && ui.Text({text: s.error, tone: 'danger', size: 'sm'}),
      ui.DataTable({
        title: '开销记录',
        columns: [{key: 'title', label: '项目', priority: 1}, {key: 'amount', label: '金额（元）', type: 'number'}, {key: 'category', label: '分类'}, {key: 'note', label: '备注', priority: 3}],
        rows: s.records.map(record => ({id: record.id, values: {title: record.title, amount: record.amount, category: record.category, note: record.note}})),
        state: s.table, selectable: true,
        onChange: patch => {Object.assign(s.table, patch)},
      }),
    ])
  },
})`.trim()

export const RECORD_APPLET_EXAMPLE = {
  title: '开销记录',
  description: '记录开销，查找和整理每笔记录',
  group: '生活',
  openMode: 'drawer',
  dock: false,
  status: false,
  statusMode: 'launcher',
  settingsSchema: {
    pageSize: {kind: 'select', label: '默认每页条数', default: '5', options: [{value: '5', label: '5 条'}, {value: '10', label: '10 条'}, {value: '20', label: '20 条'}]},
  },
  settings: {pageSize: '5'},
  source: RECORD_APPLET_SOURCE,
} as const
