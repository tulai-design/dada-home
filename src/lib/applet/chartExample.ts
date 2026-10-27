import {POINT_LIMIT} from './lineChartData'

/** One executable example, shared by the AI guide and runtime regression checks. */
export const TREND_APPLET_SOURCE = `
applet({
  state: {records: [], label: '', minutes: 25, error: ''},
  persist: ['records'],
  view: (s, ctx) => {
    const hours = ctx.settings.unit === 'hours'
    const unit = hours ? '小时' : '分钟'
    const valueOf = (minutes) => hours ? Math.round(minutes / 60 * 100) / 100 : minutes
    const range = ['7', '30', '${POINT_LIMIT}'].includes(ctx.settings.range) ? Number(ctx.settings.range) : 7
    const visible = s.records.slice(-range)
    if (ctx.surface === 'status') {
      const latest = s.records.at(-1)
      return ui.Text({text: latest ? valueOf(latest.minutes) + ' ' + unit : '暂无记录', size: 'sm', mono: true})
    }
    const add = () => {
      const label = s.label.trim()
      if (!label) {s.error = '填写日期或标签'; return}
      if (!Number.isFinite(s.minutes) || s.minutes < 0 || s.minutes > 1440) {s.error = '时长须在 0–1440 分钟之间'; return}
      if (s.records.length >= ${POINT_LIMIT}) {s.error = '最多保留 ${POINT_LIMIT} 条记录，先删除一条再添加'; return}
      s.records.push({label, minutes: s.minutes})
      s.label = ''; s.error = ''
    }
    return ui.Stack({gap: 16}, [
      ui.Stack({direction: ctx.viewport.compact ? 'column' : 'row', align: 'stretch', gap: 12}, [
        ui.Stack({gap: 8, grow: true}, [
          ui.Text({text: '日期或标签', size: 'sm'}),
          ui.Input({value: s.label, placeholder: '日期或标签', maxLength: 80, onChange: (value) => {s.label = value}, onEnter: add}),
        ]),
        ui.Stack({gap: 8}, [
          ui.Text({text: '时长（分钟）', size: 'sm'}),
          ui.NumberInput({value: s.minutes, min: 0, max: 1440, step: 5, onChange: (value) => {s.minutes = value}}),
        ]),
      ]),
      ui.Stack({direction: 'row', gap: 8}, [
        ui.Button({label: '添加记录', variant: 'primary', onClick: add}),
        ui.Button({label: '删除最近一条', variant: 'text', disabled: s.records.length === 0, onClick: () => {s.records.pop(); s.error = ''}}),
      ]),
      s.error && ui.Text({text: s.error, tone: 'danger', size: 'sm'}),
      ui.Text({text: '最近 ' + range + ' 条 · 已保存 ' + s.records.length + ' 条', size: 'sm', tone: 'secondary'}),
      ui.LineChart({title: '专注趋势', unit, labels: visible.map((record) => record.label), series: [{name: '专注', values: visible.map((record) => valueOf(record.minutes))}]}),
    ])
  },
})`.trim()

export const TREND_APPLET_EXAMPLE = {
  title: '专注趋势',
  description: '记录专注时长，查看最近记录的变化',
  group: '效率',
  openMode: 'drawer',
  dock: false,
  status: false,
  statusMode: 'launcher',
  settingsSchema: {
    unit: {kind: 'select', label: '显示单位', default: 'minutes', options: [{value: 'minutes', label: '分钟'}, {value: 'hours', label: '小时'}]},
    range: {kind: 'select', label: '观察范围', default: '7', options: [{value: '7', label: '最近 7 条'}, {value: '30', label: '最近 30 条'}, {value: String(POINT_LIMIT), label: '全部记录'}]},
  },
  settings: {unit: 'minutes', range: '7'},
  source: TREND_APPLET_SOURCE,
} as const
