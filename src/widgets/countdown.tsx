import {useMemo, useState} from 'react'
import {ActionIcon, Block, Button, DatePicker, datePickerLocaleZhCN, Empty, Flexbox, Input, Popover, Switch, Text} from '@lobehub/ui'
import {Plus, Trash2} from 'lucide-react'
import {useNow} from '../hooks'
import {ymd} from '../lib/calendar'
import {SHARED, useComponentData} from '../lib/componentData'
import {lunarLabel, makeCountdown, readCountdowns, sortCountdowns, writeCountdowns, type Countdown} from '../lib/countdown'
import {registerComponent, type ComponentProps} from '../lib/registry'

type CountdownConfig = {
  heading: string
  /** 最近的一条放大显示 */
  featured: boolean
  limit: number
  allowAdd: boolean
}

/** 右侧的大数字和单位：未来「还有 N 天」，今天「今天」，过去「已过 N 天」。 */
function Days({days}: {days: number}) {
  if (days === 0) return <span className="cd-num cd-today">今天</span>
  return (
    <span className="cd-num" data-past={days < 0}>
      {Math.abs(days)}
      <small>{days > 0 ? '天后' : '天前'}</small>
    </span>
  )
}

function Countdowns({config}: ComponentProps<CountdownConfig>) {
  // 订阅数据变化即可重绘；日期随时间走，所以再订一个分钟级的时钟
  const [list] = useComponentData<Countdown[]>(SHARED.countdowns, [])
  const now = useNow(60_000)
  const today = ymd(now)
  const sorted = useMemo(() => sortCountdowns(list, today), [list, today])
  const shown = sorted.slice(0, config.limit > 0 ? config.limit : undefined)

  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(today)
  const [yearly, setYearly] = useState(false)
  const [lunar, setLunar] = useState(false)
  const [error, setError] = useState('')

  const add = () => {
    try {
      writeCountdowns([...readCountdowns(), makeCountdown({title, date, repeat: yearly ? 'yearly' : 'none', lunar})])
      setTitle('')
      setYearly(false)
      setLunar(false)
      setError('')
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const [first, ...rest] = shown
  const featured = config.featured && first?.resolved && first.resolved.days >= 0 ? first : null
  const rows = featured ? rest : shown

  return (
    <Flexbox className="page-pane cd" gap={10}>
      <Flexbox horizontal align="center" justify="space-between">
        {config.heading ? <Text as="h2">{config.heading}</Text> : <span />}
        {config.allowAdd && (
          <Popover
            trigger="click"
            placement="bottomRight"
            open={open}
            onOpenChange={setOpen}
            content={
              <Flexbox gap={12} style={{width: 288}}>
                <Input placeholder="叫什么，例如：生日、考试、放假" value={title} onValueChange={setTitle} onPressEnter={add} />
                <DatePicker
                  locale={datePickerLocaleZhCN}
                  placeholder="选择日期"
                  style={{width: '100%'}}
                  allowClear={false}
                  value={new Date(`${date}T00:00:00`)}
                  onChange={(value) => value && setDate(ymd(value as Date))}
                />
                <Flexbox horizontal align="center" justify="space-between">
                  <Text fontSize={13}>每年重复</Text>
                  <Switch size="small" checked={yearly || lunar} disabled={lunar} onChange={setYearly} />
                </Flexbox>
                <Flexbox horizontal align="center" justify="space-between">
                  <Text fontSize={13}>按农历（生日、传统节日）</Text>
                  <Switch size="small" checked={lunar} onChange={setLunar} />
                </Flexbox>
                {error && (
                  <Text type="danger" fontSize={12}>
                    {error}
                  </Text>
                )}
                <Button className="ink-button" type="primary" disabled={!title.trim() || !date} onClick={add}>
                  添加
                </Button>
              </Flexbox>
            }
          >
            <ActionIcon icon={Plus} size="small" aria-label="添加倒数日" active={open} />
          </Popover>
        )}
      </Flexbox>

      {featured?.resolved && (
        <Block className="cd-hero" variant="outlined" padding={16} gap={4}>
          <Text type="secondary">
            {featured.item.icon} {featured.item.title}
          </Text>
          <div className="cd-hero-num">
            {featured.resolved.days === 0 ? '就是今天' : featured.resolved.days}
            {featured.resolved.days > 0 && <small>天</small>}
          </div>
          <Text type="secondary" fontSize={12}>
            {featured.resolved.on}
            {lunarLabel(featured.item) && ` · ${lunarLabel(featured.item)}`}
            {featured.resolved.nth ? ` · 第 ${featured.resolved.nth} 个周年` : ''}
          </Text>
        </Block>
      )}

      {rows.length ? (
        <div className="cd-list">
          {rows.map(({item, resolved}) => (
            <div key={item.id} className="cd-row">
              <div className="cd-main">
                <span className="cd-title">
                  {item.icon && <span className="cd-icon">{item.icon}</span>}
                  {item.title}
                </span>
                <span className="cd-date">
                  {resolved ? resolved.on : '无法换算'}
                  {lunarLabel(item) && ` · ${lunarLabel(item)}`}
                  {item.repeat === 'yearly' && !item.lunar && ' · 每年'}
                </span>
              </div>
              {resolved ? <Days days={resolved.days} /> : <span className="cd-num">—</span>}
              {config.allowAdd && (
                <ActionIcon className="cd-remove" icon={Trash2} size="small" aria-label={`删除「${item.title}」`} title="删除" onClick={() => writeCountdowns(readCountdowns().filter((entry) => entry.id !== item.id))} />
              )}
            </div>
          ))}
        </div>
      ) : (
        !featured && <Empty title="还没有倒数日" description="记下重要的日子：考试、旅行、生日、纪念日。也可以让搭搭帮你加。" />
      )}
    </Flexbox>
  )
}

registerComponent<CountdownConfig>({
  type: 'countdown',
  name: '倒数日',
  description: '倒数日 / 纪念日：距离某一天还有几天，已过去几天。支持每年重复（生日、纪念日）和按农历计算（农历生日、春节）。最近的一条可以放大显示。数据与 AI 共用。',
  category: 'info',
  defaultConfig: {heading: '倒数日', featured: true, limit: 6, allowAdd: true},
  configSchema: {
    heading: {kind: 'string', label: '标题', placeholder: '留空则不显示'},
    featured: {kind: 'boolean', label: '最近的一条放大显示'},
    limit: {kind: 'number', label: '最多显示条数', description: '0 表示不限制', min: 0, max: 50},
    allowAdd: {kind: 'boolean', label: '允许在这里添加和删除'},
  },
  defaultSpan: 'third',
  component: Countdowns,
  multiple: true,
})
