import {useId} from 'react'
import {Empty, Text} from '@lobehub/ui'
import {normalizeLineChart} from './lineChartData'
import {useContainerWidth} from './useContainerWidth'
import '../../applet-charts.css'

const COLORS = {accent: 'var(--main)', blue: 'var(--c-blue)', green: 'var(--c-green)', orange: 'var(--c-orange)'}
const DASHES = ['', '8 4', '2 4', '8 4 2 4']
const compactNumber = new Intl.NumberFormat('zh-CN', {notation: 'compact', maximumSignificantDigits: 3})
const axisLabel = (value: number) => value !== 0 && Math.abs(value) < 0.01 ? value.toExponential(1) : compactNumber.format(value)

export function LineChart({p}: {p: Record<string, unknown>}) {
  const {ref, width: measuredWidth} = useContainerWidth()
  const id = useId()
  const result = normalizeLineChart(p)
  if (!result.ok) return <div ref={ref} className="ap-line-chart-container"><div className="ap-line-chart-error" role="alert"><Text type="danger" fontSize={12}>{result.error}</Text></div></div>
  const {title, labels, series, unit, height} = result.data
  const values = series.flatMap(item => item.values.filter((value): value is number => value !== null))
  const hasData = values.length > 0
  const low = Math.min(0, ...values)
  const high = Math.max(0, ...values)
  const minimum = low === high ? -1 : low
  const maximum = low === high ? 1 : high
  const axisTicks = [maximum, (minimum + maximum) / 2, minimum].map(value => ({value, label: axisLabel(value)}))
  const width = measuredWidth || 320
  // Reserve room for signs and exponents; compact Chinese units need wider glyphs.
  const axisLabelWidth = Math.max(...axisTicks.map(({label}) => Array.from(label).reduce((size, glyph) => size + (glyph.charCodeAt(0) > 127 ? 12 : 8), 0)))
  const left = Math.max(width < 240 ? 40 : 56, axisLabelWidth + 16)
  const right = Math.max(left + 1, width - 12)
  const top = 16
  const bottom = height - 32
  const x = (index: number) => labels.length <= 1 ? (left + right) / 2 : left + index / (labels.length - 1) * (right - left)
  const y = (value: number) => bottom - (value - minimum) / (maximum - minimum) * (bottom - top)
  const tickCount = Math.min(labels.length, Math.max(2, Math.min(6, Math.floor((right - left) / 96) + 1)))
  const ticks = tickCount <= 1 ? [0] : Array.from({length: tickCount}, (_, index) => Math.round(index * (labels.length - 1) / (tickCount - 1)))
  const labelLimit = Math.max(2, Math.min(16, Math.floor((right - left) / Math.max(1, tickCount - 1) / 14)))
  const shorten = (label: string) => label.length > labelLimit ? label.slice(0, labelLimit - 1) + '…' : label
  const summary = series.map(item => item.summary.latest
    ? `${item.name}：${item.summary.latest.label} ${item.summary.latest.value}${unit}，范围 ${item.summary.min}–${item.summary.max}${unit}${item.summary.missingCount ? `，缺失 ${item.summary.missingCount} 项` : ''}`
    : `${item.name}：暂无有效数据`)

  return <div ref={ref} className="ap-line-chart-container"><figure className="ap-line-chart" aria-labelledby={`${id}-heading`}>
    <figcaption id={`${id}-heading`} className="ap-line-chart-title">{title}</figcaption>
    <ul className="ap-line-chart-summary">{summary.map((text, index) => <li key={index}>{text}</li>)}</ul>
    {series.length > 1 && <ul className="ap-line-chart-legend" aria-label="图例">
      {series.map((item, index) => <li key={index}>
        <svg width="24" height="12" aria-hidden="true"><line x1="0" x2="24" y1="6" y2="6" stroke={COLORS[item.tone]} strokeWidth="2" strokeDasharray={DASHES[index]} /></svg>
        <span>{item.name}</span>
      </li>)}
    </ul>}
    <div className="ap-line-chart-plot">
      {hasData ? <svg role="img" aria-labelledby={`${id}-title ${id}-description`} width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <title id={`${id}-title`}>{title}</title>
        <desc id={`${id}-description`}>{summary.join('；')}。横轴按标签顺序排列，缺失值不连线。完整数值见下方“查看数据”。</desc>
        {axisTicks.map(({value, label}, index) => <g key={index} className="ap-line-chart-axis">
          <line x1={left} x2={right} y1={y(value)} y2={y(value)} />
          <text x={left - 8} y={y(value)} dominantBaseline="middle" textAnchor="end">{label}</text>
        </g>)}
        {ticks.map((index, position) => <text key={index} className="ap-line-chart-tick" x={x(index)} y={height - 8} textAnchor={ticks.length === 1 ? 'middle' : position === 0 ? 'start' : position === ticks.length - 1 ? 'end' : 'middle'}>{shorten(labels[index])}</text>)}
        {series.map((item, seriesIndex) => {
          const segments: {x: number; y: number}[][] = []
          let segment: {x: number; y: number}[] = []
          item.values.forEach((value, index) => {
            if (value === null) {if (segment.length) segments.push(segment); segment = []; return}
            segment.push({x: x(index), y: y(value)})
          })
          if (segment.length) segments.push(segment)
          return <g key={seriesIndex} className="ap-line-chart-series" stroke={COLORS[item.tone]} fill={COLORS[item.tone]}>
            {segments.map((points, segmentIndex) => <g key={segmentIndex}>
              {points.length > 1 && <polyline fill="none" strokeWidth="2" strokeLinejoin="round" strokeDasharray={DASHES[seriesIndex]} points={points.map(point => `${point.x},${point.y}`).join(' ')} />}
              {points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="3" strokeWidth="0" />)}
            </g>)}
          </g>
        })}
      </svg> : <Empty title="暂无趋势数据" description="添加有效记录后查看趋势，缺失值会保留在明细中。" />}
    </div>
    {labels.length > 0 && <details className="ap-line-chart-details">
      <summary>查看数据</summary>
      <div className="ap-line-chart-table-wrap" tabIndex={0} role="region" aria-label={`${title}数据明细`}>
        <table>
          <caption>{title}数据{unit ? `（${unit}）` : ''}</caption>
          <thead><tr><th scope="col">标签</th>{series.map((item, index) => <th key={index} scope="col">{item.name}</th>)}</tr></thead>
          <tbody>{labels.map((label, index) => <tr key={index}><th scope="row">{label}</th>{series.map((item, seriesIndex) => <td key={seriesIndex}>{item.values[index] === null ? '缺失' : String(item.values[index])}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>}
  </figure></div>
}
