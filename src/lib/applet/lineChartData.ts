export const POINT_LIMIT = 120
export const SERIES_LIMIT = 4
export const LINE_CHART_TONES = ['accent', 'blue', 'green', 'orange'] as const
export type LineChartTone = (typeof LINE_CHART_TONES)[number]
export type LineChartSeries = {
  name: string
  tone: LineChartTone
  values: (number | null)[]
  summary: {latest: {label: string; value: number} | null; min: number | null; max: number | null; missingCount: number}
}
export type LineChartData = {title: string; unit: string; height: number; labels: string[]; series: LineChartSeries[]}
export type LineChartResult = {ok: true; data: LineChartData} | {ok: false; error: string}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** Validate the host's chart boundary without changing or silently dropping business values. */
export function normalizeLineChart(raw: unknown): LineChartResult {
  if (!record(raw)) return {ok: false, error: '图表参数必须是对象。'}
  if (!Array.isArray(raw.labels)) return {ok: false, error: 'labels 必须是标签数组。'}
  if (raw.labels.length > POINT_LIMIT) return {ok: false, error: `图表最多显示 ${POINT_LIMIT} 个数据点，先按日、周或月聚合数据。`}
  for (const label of raw.labels) if (typeof label !== 'string' || label.length > 80) return {ok: false, error: '每个标签必须是最多 80 字符的文本。'}
  if (!Array.isArray(raw.series) || !raw.series.length || raw.series.length > SERIES_LIMIT) return {ok: false, error: `series 必须包含 1–${SERIES_LIMIT} 个数据系列。`}
  if (raw.title !== undefined && (typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 80)) return {ok: false, error: '图表标题必须是 1–80 字符的文本。'}
  if (raw.unit !== undefined && (typeof raw.unit !== 'string' || raw.unit.length > 16)) return {ok: false, error: '单位必须是最多 16 字符的文本。'}
  if (raw.height !== undefined && (typeof raw.height !== 'number' || !Number.isFinite(raw.height))) return {ok: false, error: '图表高度必须是有限数字。'}
  const labels = raw.labels.slice() as string[]
  const series: LineChartSeries[] = []
  for (const [index, item] of raw.series.entries()) {
    if (!record(item) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80) return {ok: false, error: `第 ${index + 1} 个系列需要 1–80 字符的名称。`}
    if (!Array.isArray(item.values) || item.values.length !== labels.length) return {ok: false, error: `“${item.name}”的数据数量必须与标签数量一致。`}
    if (item.tone !== undefined && !LINE_CHART_TONES.includes(item.tone as LineChartTone)) return {ok: false, error: `“${item.name}”的 tone 只能是 accent、blue、green 或 orange。`}
    const values: (number | null)[] = []
    let latest: LineChartSeries['summary']['latest'] = null
    let min: number | null = null, max: number | null = null, missingCount = 0
    for (const [position, value] of item.values.entries()) {
      if (value === null) {values.push(null); missingCount++; continue}
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) return {ok: false, error: `“${item.name}”第 ${position + 1} 个值必须是绝对值不超过 1e12 的有限数字；缺失值使用 null。`}
      values.push(value)
      latest = {label: labels[position], value}
      min = min === null ? value : Math.min(min, value)
      max = max === null ? value : Math.max(max, value)
    }
    series.push({name: item.name.trim(), tone: item.tone as LineChartTone | undefined ?? LINE_CHART_TONES[index], values, summary: {latest, min, max, missingCount}})
  }
  return {ok: true, data: {title: typeof raw.title === 'string' ? raw.title.trim() : '趋势', unit: typeof raw.unit === 'string' ? raw.unit : '', height: typeof raw.height === 'number' ? Math.max(160, Math.min(360, raw.height)) : 220, labels, series}}
}
