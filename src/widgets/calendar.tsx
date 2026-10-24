import {useMemo, useState} from 'react'
import {ActionIcon, Block, Button, DatePicker, datePickerLocaleZhCN, Empty, Flexbox, Input, Switch, Tag, Text, Tooltip} from '@lobehub/ui'
import {CalendarDays, ChevronLeft, ChevronRight, Plus, RefreshCw, Trash2} from 'lucide-react'
import {Group, Row, TextRow} from '../components/ios'
import {useNow} from '../hooks'
import {registerApp, useAppSettings} from '../lib/apps'
import {
  REPEAT_LABEL,
  WEEKDAYS_CN,
  addDays,
  cleanIcsUrl,
  dayInfo,
  daysBetween,
  makeEvent,
  monthGrid,
  readEvents,
  readSubs,
  subscribedOccurrences,
  writeEvents,
  writeSubs,
  ymd,
  type Occurrence,
} from '../lib/calendar'
import {SHARED, useComponentData} from '../lib/componentData'
import {registerComponent, type ComponentProps} from '../lib/registry'
import {uid} from '../lib/store'
import type {IcsSub} from '../lib/calendar'
import {useOccurrences} from '../lib/useCalendar'

/* ───────────── 共用：一条日程 ───────────── */

const timeText = (item: Occurrence) => (item.time ? (item.endTime ? `${item.time}–${item.endTime}` : item.time) : '全天')

const removeEvent = (id: string) => writeEvents(readEvents().filter((event) => event.id !== id))

function EventRow({item}: {item: Occurrence}) {
  return (
    <div className="ev-row" title={item.note}>
      <span className="ev-time">{timeText(item)}</span>
      <span className="ev-title">{item.title}</span>
      {item.repeat && (
        <Tag size="small" variant="borderless">
          {REPEAT_LABEL[item.repeat]}
        </Tag>
      )}
      {item.source && (
        <Tag size="small" variant="borderless">
          {item.source}
        </Tag>
      )}
      {item.eventId && (
        <ActionIcon
          className="ev-remove"
          icon={Trash2}
          size="small"
          aria-label={`删除「${item.title}」`}
          title={item.repeat ? '删除（连同所有重复）' : '删除'}
          onClick={() => removeEvent(item.eventId!)}
        />
      )}
    </div>
  )
}

/* ───────────── 日历 ───────────── */

type CalendarConfig = {
  weekStart: 'mon' | 'sun'
  showLunar: boolean
  showEvents: boolean
}

const HEAD_MON = [1, 2, 3, 4, 5, 6, 0]
const HEAD_SUN = [0, 1, 2, 3, 4, 5, 6]

/** "HH:mm" ⇄ Date：Lobe 的时间选择器用 Date，我们存字符串。 */
const toDate = (time: string) => (time ? new Date(`2000-01-01T${time}:00`) : null)
const fromDate = (date: Date | null | undefined) => (date ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` : '')

function Calendar({config, host}: ComponentProps<CalendarConfig>) {
  const now = useNow(60_000)
  const todayText = ymd(now)
  const [cursor, setCursor] = useState(() => ({year: now.getFullYear(), month: now.getMonth()}))
  const [selected, setSelected] = useState(todayText)
  const [title, setTitle] = useState('')
  const [time, setTime] = useState('')
  const [error, setError] = useState('')

  const weekStart = config.weekStart === 'sun' ? 0 : 1
  const grid = useMemo(() => monthGrid(cursor.year, cursor.month, weekStart), [cursor, weekStart])
  const {items, errors} = useOccurrences(grid[0], grid[41], host.proxy)
  const byDay = useMemo(() => {
    const map = new Map<string, Occurrence[]>()
    for (const item of items) map.set(item.date, [...(map.get(item.date) ?? []), item])
    return map
  }, [items])

  const move = (delta: number) =>
    setCursor((prev) => {
      const d = new Date(prev.year, prev.month + delta, 1)
      return {year: d.getFullYear(), month: d.getMonth()}
    })
  const backToToday = () => {
    setCursor({year: now.getFullYear(), month: now.getMonth()})
    setSelected(todayText)
  }

  const add = () => {
    try {
      writeEvents([...readEvents(), makeEvent({title, date: selected, time: time || undefined})])
      setTitle('')
      setTime('')
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const head = weekStart === 1 ? HEAD_MON : HEAD_SUN
  const info = dayInfo(selected)
  const dayItems = byDay.get(selected) ?? []
  const marks = [info.holiday && info.rest && `${info.holiday}假期`, info.festival && info.festival !== info.holiday && info.festival, info.term].filter(Boolean) as string[]

  return (
    <Flexbox className="page-pane cal" gap={16}>
      <Flexbox horizontal align="baseline" justify="space-between">
        <Flexbox horizontal align="baseline" gap={8}>
          <span className="cal-title">{cursor.month + 1} 月</span>
          <Text type="secondary" fontSize={13}>
            {cursor.year} 年
          </Text>
        </Flexbox>
        <Flexbox horizontal gap={4} align="center">
          <ActionIcon icon={ChevronLeft} aria-label="上个月" onClick={() => move(-1)} />
          <Button size="small" onClick={backToToday}>
            今天
          </Button>
          <ActionIcon icon={ChevronRight} aria-label="下个月" onClick={() => move(1)} />
        </Flexbox>
      </Flexbox>

      <div className="cal-grid" role="grid" aria-label={`${cursor.year} 年 ${cursor.month + 1} 月`}>
        {head.map((day) => (
          <div key={day} className="cal-weekday" data-weekend={day === 0 || day === 6}>
            {WEEKDAYS_CN[day]}
          </div>
        ))}
        {grid.map((day) => {
          const d = dayInfo(day)
          const events = byDay.get(day) ?? []
          const inMonth = Number(day.slice(5, 7)) === cursor.month + 1
          return (
            <button
              key={day}
              type="button"
              className="cal-cell"
              aria-label={`${day} ${d.label}${events.length ? `，${events.length} 条日程` : ''}`}
              aria-pressed={day === selected}
              data-out={!inMonth}
              data-today={day === todayText}
              data-selected={day === selected}
              data-rest={d.rest && !!d.holiday}
              onClick={() => setSelected(day)}
            >
              <span className="cal-top">
                <span className="cal-num">{Number(day.slice(8))}</span>
                {d.makeup ? (
                  <i className="cal-mark" data-kind="work">
                    班
                  </i>
                ) : d.holiday && d.rest ? (
                  <i className="cal-mark" data-kind="rest">
                    休
                  </i>
                ) : null}
              </span>
              {config.showLunar && (
                <span className="cal-sub" data-hot={Boolean(d.holiday || d.festival || d.term)}>
                  {d.label}
                </span>
              )}
              {config.showEvents && events.length > 0 && (
                <span className="cal-chips">
                  <span className="cal-chip" data-sub={Boolean(events[0].source)}>
                    {events[0].title}
                  </span>
                  {events.length > 1 && <span className="cal-more">+{events.length - 1}</span>}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <Block className="cal-day" variant="outlined" padding={16} gap={12}>
        <Flexbox horizontal align="center" justify="space-between" wrap="wrap" gap={8}>
          <Flexbox horizontal align="baseline" gap={8}>
            <span className="cal-day-date">
              {Number(selected.slice(5, 7))} 月 {Number(selected.slice(8))} 日
            </span>
            <Text type="secondary" fontSize={13}>
              周{WEEKDAYS_CN[info.weekday]}
              {daysBetween(todayText, selected) === 0 ? ' · 今天' : ''}
            </Text>
          </Flexbox>
          <Flexbox horizontal gap={4} wrap="wrap">
            {info.lunarFull && <Tag variant="borderless">农历{info.lunarFull}</Tag>}
            {marks.map((mark) => (
              <Tag key={mark} color="red" variant="borderless">
                {mark}
              </Tag>
            ))}
            {info.makeup && <Tag color="orange" variant="borderless">调休上班</Tag>}
          </Flexbox>
        </Flexbox>

        {dayItems.length ? (
          <Flexbox className="ev-list">
            {dayItems.map((item) => (
              <EventRow key={item.key} item={item} />
            ))}
          </Flexbox>
        ) : (
          <Text type="secondary" fontSize={13}>
            这一天没有日程
          </Text>
        )}

        <Flexbox horizontal gap={8} align="center">
          <Input
            style={{flex: 1}}
            placeholder={`给 ${Number(selected.slice(5, 7))}月${Number(selected.slice(8))}日添一条日程`}
            value={title}
            onValueChange={setTitle}
            onPressEnter={add}
          />
          <DatePicker.TimePicker
            locale={datePickerLocaleZhCN}
            style={{width: 116}}
            format="HH:mm"
            minuteStep={5}
            needConfirm={false}
            placeholder="全天"
            value={toDate(time)}
            onChange={(value) => setTime(fromDate(value as Date | null))}
          />
          <Button className="ink-button" type="primary" icon={<Plus size={14} />} disabled={!title.trim()} onClick={add}>
            添加
          </Button>
        </Flexbox>
        {error && (
          <Text type="danger" fontSize={12}>
            {error}
          </Text>
        )}
        {errors.length > 0 && (
          <Tooltip title={errors.join('\n')}>
            <Text type="danger" fontSize={12}>
              有 {errors.length} 个订阅日历没取到，把鼠标放在这里看详情
            </Text>
          </Tooltip>
        )}
      </Block>
    </Flexbox>
  )
}

registerComponent<CalendarConfig>({
  type: 'calendar',
  name: '日历',
  description:
    '月历。每一格显示农历、节气、传统节日、法定假日（休）和调休上班（班），有日程的日子在格子里显示日程标题；点一天可以看当天日程、添加（可选时间）。日程与「日程」组件、AI 共用，也能订阅 .ics 日历。',
  category: 'tool',
  defaultConfig: {weekStart: 'mon', showLunar: true, showEvents: true},
  configSchema: {
    weekStart: {
      kind: 'select',
      label: '每周从',
      options: [
        {value: 'mon', label: '周一'},
        {value: 'sun', label: '周日'},
      ],
    },
    showLunar: {kind: 'boolean', label: '显示农历、节日和节气'},
    showEvents: {kind: 'boolean', label: '在格子里显示日程'},
  },
  defaultSpan: 'half',
  component: Calendar,
  multiple: true,
})

/* ───────────── 日程（接下来要发生的事） ───────────── */

type AgendaConfig = {
  heading: string
  /** 往后看几天 */
  days: number
  limit: number
  showHoliday: boolean
}

function dayName(day: string, today: string): string {
  const gap = daysBetween(today, day)
  return gap === 0 ? '今天' : gap === 1 ? '明天' : gap === 2 ? '后天' : `周${WEEKDAYS_CN[dayInfo(day).weekday]}`
}

/** 往后 200 天里的下一个法定假日（连休只取第一天）。 */
function nextHoliday(today: string): {name: string; date: string; days: number} | null {
  for (let i = 0; i <= 200; i += 1) {
    const date = addDays(today, i)
    const info = dayInfo(date)
    if (info.holiday && info.rest && dayInfo(addDays(date, -1)).holiday !== info.holiday) return {name: info.holiday, date, days: i}
  }
  return null
}

function Agenda({config, host}: ComponentProps<AgendaConfig>) {
  const now = useNow(60_000)
  const today = ymd(now)
  const to = addDays(today, Math.max(1, config.days) - 1)
  const {items} = useOccurrences(today, to, host.proxy)
  const upcoming = useMemo(() => {
    const nowTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    // 今天已经结束的定时日程不再列出；全天的留着
    return items.filter((item) => item.date > today || !item.time || (item.endTime ?? item.time) >= nowTime).slice(0, config.limit > 0 ? config.limit : undefined)
  }, [items, today, now, config.limit])
  const groups = useMemo(() => {
    const map = new Map<string, Occurrence[]>()
    for (const item of upcoming) map.set(item.date, [...(map.get(item.date) ?? []), item])
    return [...map.entries()]
  }, [upcoming])
  const holiday = config.showHoliday ? nextHoliday(today) : null

  return (
    <Flexbox className="page-pane agenda" gap={16}>
      {config.heading && <Text as="h2">{config.heading}</Text>}
      {groups.length ? (
        <Flexbox gap={16}>
          {groups.map(([day, list]) => (
            <div key={day} className="agenda-day">
              <div className="agenda-date">
                <span className="agenda-num">{Number(day.slice(8))}</span>
                <span className="agenda-label">
                  {Number(day.slice(5, 7))} 月 · {dayName(day, today)}
                </span>
              </div>
              <Flexbox className="ev-list">
                {list.map((item) => (
                  <EventRow key={item.key} item={item} />
                ))}
              </Flexbox>
            </div>
          ))}
        </Flexbox>
      ) : (
        <Empty title="接下来没有日程" description={`未来 ${config.days} 天是空的。让搭搭帮你记一条，或在日历里添加。`} />
      )}
      {holiday && (
        <Block variant="outlined" padding={12}>
          <Flexbox horizontal align="center" gap={8}>
            <Tag color="red" variant="borderless">
              假期
            </Tag>
            <Text fontSize={13}>
              {holiday.name}
              {holiday.days === 0 ? '，就是今天' : `，还有 ${holiday.days} 天`}
            </Text>
            <Text type="secondary" fontSize={12} style={{marginLeft: 'auto'}}>
              {holiday.date.slice(5).replace('-', '月')}日
            </Text>
          </Flexbox>
        </Block>
      )}
    </Flexbox>
  )
}

registerComponent<AgendaConfig>({
  type: 'agenda',
  name: '日程',
  description: '接下来几天要发生的事，按日期分组，含订阅的日历；底部可以提示下一个法定假日还有几天。适合放在首页。',
  category: 'info',
  defaultConfig: {heading: '接下来', days: 7, limit: 8, showHoliday: true},
  configSchema: {
    heading: {kind: 'string', label: '标题', placeholder: '留空则不显示'},
    days: {kind: 'number', label: '往后看几天', min: 1, max: 60},
    limit: {kind: 'number', label: '最多显示条数', description: '0 表示不限制', min: 0, max: 50},
    showHoliday: {kind: 'boolean', label: '提示下一个假期'},
  },
  defaultSpan: 'third',
  component: Agenda,
  multiple: true,
})

/* ───────────── 设置：订阅日历 ───────────── */

function CalendarSettings() {
  const {settings} = useAppSettings()
  const [subs, setSubs] = useComponentData<IcsSub[]>(SHARED.icsSubs, readSubs())
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const [report, setReport] = useState('')
  const check = async () => {
    setChecking(true)
    const from = ymd(new Date())
    const result = await subscribedOccurrences(subs, settings.proxy, from, addDays(from, 30), true)
    setReport(result.errors.length ? result.errors.join('；') : `刷新成功：未来 30 天共 ${result.items.length} 条事件`)
    setChecking(false)
  }
  const patch = (id: string, part: Partial<IcsSub>) => {
    const next = subs.map((sub) => (sub.id === id ? {...sub, ...part} : sub))
    setSubs(next)
    writeSubs(next)
  }

  const add = () => {
    const clean = cleanIcsUrl(url)
    if (!clean) {
      setError('地址要以 http://、https:// 或 webcal:// 开头。')
      return
    }
    setError('')
    const next = [...subs, {id: uid(), name: name.trim() || new URL(clean).hostname, url: clean, enabled: true}]
    setSubs(next)
    writeSubs(next)
    setUrl('')
    setName('')
  }

  return (
    <>
      <Group title={`订阅的日历 · ${subs.length} 个`} footer="订阅链接通常带有私密的访问码，只保存在这台设备的浏览器里，不会交给 AI，也默认不参与跨设备同步。取数走「网络」里设置的代理。">
        <TextRow label="名称" value={name} placeholder="可选，例如：工作日历" onChange={setName} />
        <TextRow label="地址" value={url} placeholder="https://… 或 webcal://…（.ics）" onChange={setUrl} onEnter={add} />
        <Row label="添加订阅" icon={<Plus size={16} />} onClick={add} />
        {error && (
          <Row label={<span style={{color: 'var(--main)'}}>{error}</span>} />
        )}
        {subs.length > 0 && <Row label={checking ? '正在刷新…' : '立即刷新并检查'} hint={report} icon={<RefreshCw size={16} />} onClick={() => void check()} />}
      </Group>
      {subs.map((sub) => (
        <Group key={sub.id}>
          <TextRow label="名称" value={sub.name} onChange={(v) => patch(sub.id, {name: v})} />
          <Row label="启用">
            <Switch checked={sub.enabled} onChange={(v) => patch(sub.id, {enabled: v})} />
          </Row>
          <Row
            label="删除这个订阅"
            icon={<Trash2 size={16} />}
            danger
            onClick={() => {
              const next = subs.filter((item) => item.id !== sub.id)
              setSubs(next)
              writeSubs(next)
            }}
          />
        </Group>
      ))}
    </>
  )
}

registerApp({
  id: 'calendar',
  name: '日历',
  icon: CalendarDays,
  color: '#ff3b30',
  description: '订阅 .ics 日历（Google、Apple、Outlook、各类课表和赛程都支持），事件会出现在日历和日程里。',
  summary: () => {
    const count = readSubs().filter((sub) => sub.enabled).length
    return count ? `${count} 个订阅` : '未订阅'
  },
  Panel: CalendarSettings,
})
