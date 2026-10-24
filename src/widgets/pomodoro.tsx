import {useMemo, useState} from 'react'
import {ActionIcon, Block, Button, Flexbox, Input, Segmented, Statistic, Switch, Text, Tooltip} from '@lobehub/ui'
import {Minus, Pause, Play, Plus, RotateCcw, Settings2, SkipForward, Timer} from 'lucide-react'
import {Group, Row} from '../components/ios'
import {useNow} from '../hooks'
import {registerApp} from '../lib/apps'
import {SHARED, useComponentData} from '../lib/componentData'
import {
  PHASE_LABEL,
  focusActions,
  focusStats,
  focusWeek,
  mmss,
  readFocusSettings,
  remaining,
  useFocus,
  writeFocusSettings,
  type FocusPhase,
  type FocusRecord,
} from '../lib/focus'
import {registerComponent, type ComponentProps} from '../lib/registry'

type PomodoroConfig = {
  showStats: boolean
  /** 可以给这一轮写一句「在做什么」 */
  askLabel: boolean
}

const PHASES: FocusPhase[] = ['focus', 'short', 'long']
const TICKS = 60
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六']

/** 表盘：60 根刻度，走过的亮起来。比一条连续的圆环更像一个计时的东西。 */
function Dial({progress, phase, children}: {progress: number; phase: FocusPhase; children: React.ReactNode}) {
  const lit = Math.round(progress * TICKS)
  return (
    <div className="pomo-dial" data-phase={phase}>
      <svg viewBox="-120 -120 240 240" aria-hidden>
        {Array.from({length: TICKS}, (_, i) => {
          const a = (i / TICKS) * Math.PI * 2 - Math.PI / 2
          const major = i % 5 === 0
          const r1 = major ? 100 : 104
          return <line key={i} className="pomo-tick" data-lit={i < lit} x1={Math.cos(a) * r1} y1={Math.sin(a) * r1} x2={Math.cos(a) * 114} y2={Math.sin(a) * 114} />
        })}
      </svg>
      <div className="pomo-center">{children}</div>
    </div>
  )
}

function Pomodoro({config, host}: ComponentProps<PomodoroConfig>) {
  const state = useFocus()
  useNow(state.status === 'running' ? 250 : 60_000)
  const settings = readFocusSettings()
  const [log] = useComponentData<FocusRecord[]>(SHARED.focusLog, [])
  const stats = useMemo(() => focusStats(log), [log])
  const week = useMemo(() => focusWeek(log), [log])
  const peak = Math.max(30, ...week.map((d) => d.minutes))

  const left = remaining(state)
  const progress = state.status === 'idle' ? 0 : 1 - left / state.totalMs
  const running = state.status === 'running'
  const idle = state.status === 'idle'
  // 当前循环里已完成的专注数，用小圆点表示离长休息还有几个
  const done = state.round % settings.longEvery

  return (
    <Flexbox className="page-pane pomo" gap={24} align="center" data-phase={state.phase}>
      <Segmented
        value={state.phase}
        disabled={!idle}
        options={PHASES.map((phase) => ({value: phase, label: PHASE_LABEL[phase]}))}
        onChange={(value) => focusActions.switchTo(value as FocusPhase)}
      />

      <Dial progress={progress} phase={state.phase}>
        <b className="pomo-time">{mmss(left)}</b>
        <span className="pomo-sub">{state.status === 'paused' ? '已暂停' : state.phase === 'focus' ? state.label || '专注' : PHASE_LABEL[state.phase]}</span>
        <span className="pomo-rounds" aria-label={`本轮已完成 ${done} / ${settings.longEvery} 个专注`}>
          {Array.from({length: settings.longEvery}, (_, i) => (
            <i key={i} data-done={i < done} />
          ))}
        </span>
      </Dial>

      {config.askLabel && state.phase === 'focus' && idle && (
        <Input
          className="pomo-label"
          variant="filled"
          placeholder="这一轮要做什么（可选）"
          value={state.label ?? ''}
          onValueChange={focusActions.setLabel}
          maxLength={60}
          style={{textAlign: 'center'}}
        />
      )}

      <Flexbox horizontal gap={12} align="center">
        <Tooltip title="放弃这一段">
          <ActionIcon icon={RotateCcw} size="large" disabled={idle} onClick={focusActions.stop} aria-label="放弃这一段" />
        </Tooltip>
        {running ? (
          <Button className="ink-button" type="primary" size="large" icon={<Pause size={16} />} onClick={focusActions.pause} style={{minWidth: 128}}>
            暂停
          </Button>
        ) : state.status === 'paused' ? (
          <Button className="ink-button" type="primary" size="large" icon={<Play size={16} />} onClick={focusActions.resume} style={{minWidth: 128}}>
            继续
          </Button>
        ) : (
          <Button className="ink-button" type="primary" size="large" icon={<Play size={16} />} onClick={() => focusActions.start()} style={{minWidth: 128}}>
            开始{PHASE_LABEL[state.phase]}
          </Button>
        )}
        {state.phase !== 'focus' ? (
          <Tooltip title="跳过休息">
            <ActionIcon icon={SkipForward} size="large" onClick={() => focusActions.switchTo('focus')} aria-label="跳过休息" />
          </Tooltip>
        ) : (
          <Tooltip title="番茄钟设置">
            <ActionIcon icon={Settings2} size="large" onClick={() => host.openSettings('focus')} aria-label="番茄钟设置" />
          </Tooltip>
        )}
      </Flexbox>

      {config.showStats && (
        <Block className="pomo-stats" variant="outlined" padding={16} gap={16} width="100%">
          <Flexbox horizontal justify="space-around" width="100%">
            <Statistic title="今天" value={stats.todayCount} suffix="个" />
            <Statistic title="专注" value={stats.todayMinutes} suffix="分钟" />
            <Statistic title="连续" value={stats.streak} suffix="天" />
          </Flexbox>
          <div className="pomo-week" aria-label="最近 7 天的专注时长">
            {week.map((d, i) => (
              <Tooltip key={d.day} title={`${d.day.slice(5)}　${d.minutes} 分钟`}>
                <div className="pomo-bar" data-today={i === 6}>
                  <i style={{height: `${Math.max(4, (d.minutes / peak) * 100)}%`}} data-empty={d.minutes === 0} />
                  <span>{i === 6 ? '今' : WEEKDAY[new Date(`${d.day}T00:00:00`).getDay()]}</span>
                </div>
              </Tooltip>
            ))}
          </div>
        </Block>
      )}
    </Flexbox>
  )
}

/** 状态条形态：一个番茄和剩余时间，点一下暂停 / 继续；没在计时就是一个「开始专注」。 */
function PomodoroStatus() {
  const state = useFocus()
  useNow(state.status === 'running' ? 500 : 60_000)
  if (state.status === 'idle') {
    return (
      <Button size="small" type="text" icon={<Timer size={12} />} onClick={() => focusActions.start()}>
        开始专注
      </Button>
    )
  }
  const running = state.status === 'running'
  return (
    <Tooltip title={running ? '点一下暂停' : '点一下继续'}>
      <Button size="small" type="text" className="status-focus" data-running={running} onClick={() => (running ? focusActions.pause() : focusActions.resume())}>
        {state.phase === 'focus' ? '🍅' : '☕'} {mmss(remaining(state))}
      </Button>
    </Tooltip>
  )
}

registerComponent<PomodoroConfig>({
  type: 'pomodoro',
  name: '番茄钟',
  description:
    '番茄工作法计时器：专注 → 短休息，几轮后长休息。表盘随时间亮起，计时在后台持续（切页面、刷新都不会断），到点响一声并弹系统通知，标签页标题里显示剩余时间。记录每天的专注，显示今天的统计和近 7 天柱状图。舞台型组件，独占一页时居中。能放进状态条。',
  category: 'tool',
  defaultConfig: {showStats: true, askLabel: true},
  configSchema: {
    showStats: {kind: 'boolean', label: '显示专注统计'},
    askLabel: {kind: 'boolean', label: '允许写下这一轮在做什么'},
  },
  defaultSpan: 'third',
  stage: {width: 400},
  component: Pomodoro,
  status: PomodoroStatus,
  multiple: false,
})

/* ───────────── 设置：时长 ───────────── */

/** 用加减按钮调数字：输入框清空再输入会经过非法值，调起来很别扭。按档位吸附。 */
function Stepper({label, value, min, max, step = 1, onChange}: {label: string; value: number; min: number; max: number; step?: number; onChange: (next: number) => void}) {
  return (
    <Row label={label}>
      <Flexbox horizontal align="center" gap={8}>
        <ActionIcon icon={Minus} size="small" aria-label="减少" disabled={value <= min} onClick={() => onChange(Math.max(min, (Math.ceil(value / step) - 1) * step))} />
        <Text style={{minWidth: 28, textAlign: 'center', fontVariantNumeric: 'tabular-nums'}}>{value}</Text>
        <ActionIcon icon={Plus} size="small" aria-label="增加" disabled={value >= max} onClick={() => onChange(Math.min(max, (Math.floor(value / step) + 1) * step))} />
      </Flexbox>
    </Row>
  )
}

function FocusSettings() {
  const [, bump] = useState(0)
  const settings = readFocusSettings()
  const set = (part: Parameters<typeof writeFocusSettings>[0]) => {
    writeFocusSettings(part)
    bump((n) => n + 1)
  }
  return (
    <>
      <Group title="时长（分钟）" footer="改动对下一段生效；正在计时的这一段不受影响。">
        <Stepper label="专注" value={settings.focusMin} min={1} max={180} step={5} onChange={(v) => set({focusMin: v})} />
        <Stepper label="短休息" value={settings.shortMin} min={1} max={60} onChange={(v) => set({shortMin: v})} />
        <Stepper label="长休息" value={settings.longMin} min={1} max={120} step={5} onChange={(v) => set({longMin: v})} />
        <Stepper label="几个专注后长休息" value={settings.longEvery} min={2} max={12} onChange={(v) => set({longEvery: v})} />
      </Group>
      <Group title="行为">
        <Row label="专注结束后自动开始休息">
          <Switch checked={settings.autoBreak} onChange={(v) => set({autoBreak: v})} />
        </Row>
        <Row label="结束时提醒" hint="响一声；标签页不在前台时再弹系统通知（首次开始计时时会请求通知权限）。">
          <Switch checked={settings.alert} onChange={(v) => set({alert: v})} />
        </Row>
      </Group>
    </>
  )
}

registerApp({
  id: 'focus',
  name: '番茄钟',
  icon: Timer,
  color: '#ff6b35',
  description: '设置番茄钟的专注与休息时长、提醒方式。',
  summary: () => {
    const s = readFocusSettings()
    return `${s.focusMin} / ${s.shortMin} 分钟`
  },
  Panel: FocusSettings,
})
