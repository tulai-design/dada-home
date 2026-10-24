import {createToolFactory} from '@tulai-design/agent-core'
import {
  REPEAT_LABEL,
  WEEKDAYS_CN,
  addDays,
  dayInfo,
  daysBetween,
  describeDay,
  makeEvent,
  occurrencesIn,
  parseYmd,
  readEvents,
  readSubs,
  sortOccurrences,
  subscribedOccurrences,
  today,
  writeEvents,
  type Repeat,
} from './calendar'
import {describe, makeCountdown, readCountdowns, sortCountdowns, writeCountdowns} from './countdown'
import {defaultSettings} from './defaults'
import {WorkspaceError} from './errors'
import {PHASE_LABEL, focusActions, focusStats, getFocusState, mmss, readFocusLog, readFocusSettings, remaining, type FocusPhase} from './focus'
import {MODE_LABEL, PRESETS, addPreset, addTrack, currentTrack, getPlayerState, playerActions, readTracks, removeTrack, type PlayMode} from './player'
import {readStored} from './store'
import type {Settings} from './types'
import type {HomeToolContext} from './tools'

/**
 * 日期、日程、倒数日、番茄钟、音乐的工具。
 *
 * 原则和 siteTools 一致：读的放开、写的校验、删除类走审批。
 * 订阅日历的地址带有私密访问码，这里只暴露名称和启用状态，不读不写地址。
 */

const define = createToolFactory<HomeToolContext, void>()

type Obj = Record<string, unknown>
const obj = (raw: unknown): Obj => (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Obj) : {})
const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const optStr = (value: unknown): string | undefined => str(value) || undefined
const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
const bool = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined)
const strList = (value: unknown): string[] => (Array.isArray(value) ? value.map(str).filter(Boolean) : [])

async function guard(run: () => string | Promise<string>): Promise<string> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof WorkspaceError) return `没有成功：${error.message}`
    return `没有成功：${error instanceof Error ? error.message : String(error)}`
  }
}

const proxy = (): string => ({...defaultSettings(), ...readStored<Partial<Settings>>('settings', {})}).proxy

const REPEATS = Object.keys(REPEAT_LABEL) as Repeat[]
const DATE_HINT = '格式 YYYY-MM-DD'

export const LIFE_TOOLS = [
  /* ───── 日期 ───── */
  define(
    {
      schema: {parse: (raw) => ({date: optStr(obj(raw).date), days: num(obj(raw).days)})},
      json: {
        type: 'object',
        properties: {
          date: {type: 'string', description: `要查的日期，${DATE_HINT}；不填就是今天`},
          days: {type: 'number', description: '再往后看几天，列出这段时间里所有的节假日、调休和节气（最多 366）；不填只查这一天'},
        },
      },
    },
    {
      name: 'get_date_info',
      title: '查看日期信息',
      description: '查某一天的星期、农历、节日、节气、是否法定假日 / 调休上班；也可以列出接下来一段时间的节假日安排。用户问「今天几号 / 农历几月 / 国庆放几天 / 下个假期是什么时候 / 这周末要不要上班」时用它，不要凭记忆回答。',
      effect: 'read',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          const start = args.date ?? today()
          if (!parseYmd(start)) throw new WorkspaceError(`日期${DATE_HINT}，收到「${start}」。`)
          const head = `今天是 ${today()}（星期${WEEKDAYS_CN[new Date().getDay()]}）。\n${describeDay(dayInfo(start))}`
          if (!args.days) return head
          const span = Math.min(Math.max(Math.floor(args.days), 1), 366)
          const marks: string[] = []
          for (let i = 0; i <= span; i += 1) {
            const day = addDays(start, i)
            const info = dayInfo(day)
            if (info.holiday || info.makeup || info.festival || info.term) marks.push(`${describeDay(info)}（${daysBetween(today(), day)} 天后）`)
          }
          return `${head}\n\n${start} 起 ${span} 天内的节假日 / 调休 / 节日 / 节气：\n${marks.join('\n') || '没有'}`
        }),
    },
  ),

  /* ───── 日程 ───── */
  define(
    {
      schema: {parse: (raw) => ({from: optStr(obj(raw).from), to: optStr(obj(raw).to)})},
      json: {
        type: 'object',
        properties: {
          from: {type: 'string', description: `开始日期，${DATE_HINT}；不填是今天`},
          to: {type: 'string', description: `结束日期（含），${DATE_HINT}；不填是 from 后 14 天，区间最长 400 天`},
        },
      },
    },
    {
      name: 'list_events',
      title: '查看日程',
      description: '列出一段时间里的日程（自己记的，加上用户订阅的 .ics 日历），含重复日程的每次出现。每行开头的 id 可用于 remove_events；订阅来的日程只读，没有 id。',
      effect: 'read',
      highRisk: () => false,
      execute: (args) =>
        guard(async () => {
          const from = args.from ?? today()
          const to = args.to ?? addDays(from, 14)
          if (!parseYmd(from) || !parseYmd(to)) throw new WorkspaceError(`日期${DATE_HINT}。`)
          if (to < from) throw new WorkspaceError('结束日期不能早于开始日期。')
          const own = occurrencesIn(readEvents(), from, to)
          const subs = readSubs().filter((sub) => sub.enabled && sub.url.trim())
          const remote = subs.length ? await subscribedOccurrences(subs, proxy(), from, to) : {items: [], errors: []}
          const all = sortOccurrences([...own, ...remote.items])
          const lines = all.map((o) => `${o.date} ${o.time ? (o.endTime ? `${o.time}-${o.endTime}` : o.time) : '全天'}｜${o.title}${o.repeat ? `（${REPEAT_LABEL[o.repeat]}）` : ''}${o.source ? `｜来自订阅「${o.source}」` : `｜id ${o.eventId}`}${o.note ? `｜${o.note.slice(0, 80)}` : ''}`)
          const tail = remote.errors.length ? `\n（有订阅日历没取到：${remote.errors.join('；')}）` : ''
          return `${from} 至 ${to}，共 ${all.length} 条${lines.length ? `\n${lines.join('\n')}` : ''}${tail}`
        }),
    },
  ),
  define(
    {
      schema: {
        parse: (raw) => ({
          title: str(obj(raw).title),
          date: str(obj(raw).date),
          time: optStr(obj(raw).time),
          endTime: optStr(obj(raw).endTime),
          days: num(obj(raw).days),
          repeat: optStr(obj(raw).repeat),
          note: optStr(obj(raw).note),
        }),
      },
      json: {
        type: 'object',
        properties: {
          title: {type: 'string'},
          date: {type: 'string', description: `日期，${DATE_HINT}。用户说「明天 / 下周三」时，先用 get_date_info 确认今天是哪天再换算`},
          time: {type: 'string', description: '开始时间 HH:mm（24 小时制）；不填是全天日程'},
          endTime: {type: 'string', description: '结束时间 HH:mm，需要同时有 time'},
          days: {type: 'number', description: '连续几天（全天事件，比如出差 3 天填 3）'},
          repeat: {type: 'string', enum: REPEATS, description: '重复方式，默认 none'},
          note: {type: 'string', description: '备注'},
        },
        required: ['title', 'date'],
      },
    },
    {
      name: 'add_event',
      title: '添加日程',
      description: '往日历里记一条日程。可以带时间、持续天数、重复方式（每天 / 每周 / 每月 / 每年）。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          if (args.repeat && !REPEATS.includes(args.repeat as Repeat)) throw new WorkspaceError(`repeat 只能是 ${REPEATS.join(' / ')}。`)
          const event = makeEvent({...args, repeat: args.repeat as Repeat | undefined})
          writeEvents([...readEvents(), event])
          return `已记下：${event.date} ${event.time ?? '全天'} ${event.title}${event.repeat ? `（${REPEAT_LABEL[event.repeat]}）` : ''}，id ${event.id}。`
        }),
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({ids: strList(obj(raw).ids)})},
      json: {type: 'object', properties: {ids: {type: 'array', items: {type: 'string'}, description: '要删的日程 id（list_events 里的 id）'}}, required: ['ids']},
    },
    {
      name: 'remove_events',
      title: '删除日程',
      description: '删除自己记的日程。重复日程会连同所有重复一起删除。订阅来的日程不能删。',
      effect: 'write',
      highRisk: () => true,
      execute: (args) =>
        guard(() => {
          const events = readEvents()
          const gone = events.filter((event) => args.ids.includes(event.id))
          if (!gone.length) throw new WorkspaceError('没有找到这些日程，先用 list_events 看 id。')
          writeEvents(events.filter((event) => !args.ids.includes(event.id)))
          return `已删除 ${gone.length} 条：${gone.map((e) => e.title).join('、')}`
        }),
    },
  ),
  define(
    {schema: {parse: obj}, json: {type: 'object', properties: {}}},
    {
      name: 'list_calendar_subscriptions',
      title: '查看订阅的日历',
      description: '列出用户订阅的 .ics 日历（只有名称和是否启用）。订阅地址带私密访问码，你看不到也不能改；要添加或删除订阅，用 open_settings 带用户去 calendar 设置页。',
      effect: 'read',
      highRisk: () => false,
      execute: async () => {
        const subs = readSubs()
        return subs.length ? subs.map((sub) => `${sub.name}｜${sub.enabled ? '启用' : '已停用'}`).join('\n') : '还没有订阅任何日历。'
      },
    },
  ),

  /* ───── 倒数日 ───── */
  define(
    {schema: {parse: obj}, json: {type: 'object', properties: {}}},
    {
      name: 'list_countdowns',
      title: '查看倒数日',
      description: '列出所有倒数日 / 纪念日，按最近要到的排序，含还有几天（过去的显示已经几天）。',
      effect: 'read',
      highRisk: () => false,
      execute: async () => {
        const list = sortCountdowns(readCountdowns())
        if (!list.length) return '还没有倒数日。'
        return list.map(({item}) => `${item.id}｜${item.icon ?? ''}${item.title}｜${describe(item)}${item.lunar ? '｜按农历每年' : item.repeat === 'yearly' ? '｜每年' : ''}`).join('\n')
      },
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({title: str(obj(raw).title), date: str(obj(raw).date), repeat: optStr(obj(raw).repeat), lunar: bool(obj(raw).lunar), icon: optStr(obj(raw).icon)})},
      json: {
        type: 'object',
        properties: {
          title: {type: 'string'},
          date: {type: 'string', description: `那一天的阳历日期，${DATE_HINT}（不管是不是农历，都写阳历；农历生日写出生那年农历生日对应的阳历日，或任意一年的）`},
          repeat: {type: 'string', enum: ['none', 'yearly'], description: 'yearly = 每年重复（生日、纪念日）；默认 none'},
          lunar: {type: 'boolean', description: 'true = 按农历每年重复（农历生日、春节），date 为农历那天对应的阳历日；自动视为每年'},
          icon: {type: 'string', description: '一个 emoji，可选'},
        },
        required: ['title', 'date'],
      },
    },
    {
      name: 'add_countdown',
      title: '添加倒数日',
      description: '记一个倒数日：考试、旅行、生日、纪念日。生日 / 纪念日用 repeat:"yearly"；农历生日用 lunar:true。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          const item = makeCountdown({title: args.title, date: args.date, repeat: args.repeat === 'yearly' ? 'yearly' : 'none', lunar: args.lunar, icon: args.icon})
          writeCountdowns([...readCountdowns(), item])
          return `已记下「${item.title}」：${describe(item)}，id ${item.id}。`
        }),
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({ids: strList(obj(raw).ids)})},
      json: {type: 'object', properties: {ids: {type: 'array', items: {type: 'string'}}}, required: ['ids']},
    },
    {
      name: 'remove_countdowns',
      title: '删除倒数日',
      description: '删除倒数日。',
      effect: 'write',
      highRisk: () => true,
      execute: (args) =>
        guard(() => {
          const list = readCountdowns()
          const gone = list.filter((item) => args.ids.includes(item.id))
          if (!gone.length) throw new WorkspaceError('没有找到这些倒数日，先用 list_countdowns 看 id。')
          writeCountdowns(list.filter((item) => !args.ids.includes(item.id)))
          return `已删除：${gone.map((item) => item.title).join('、')}`
        }),
    },
  ),

  /* ───── 番茄钟 ───── */
  define(
    {schema: {parse: obj}, json: {type: 'object', properties: {}}},
    {
      name: 'get_focus',
      title: '查看番茄钟',
      description: '看番茄钟现在的状态（在专注还是休息、还剩多久），以及今天、近 7 天的专注统计和最近的专注记录。用户问「我今天专注了多久」「复盘一下这周」时用。',
      effect: 'read',
      highRisk: () => false,
      execute: async () => {
        const state = getFocusState()
        const settings = readFocusSettings()
        const stats = focusStats()
        const log = readFocusLog().slice(-10).reverse()
        const status = state.status === 'idle' ? '没有在计时' : `${state.status === 'running' ? '计时中' : '已暂停'}，${PHASE_LABEL[state.phase]}，还剩 ${mmss(remaining(state))}${state.label ? `，在做「${state.label}」` : ''}`
        return [
          `现在：${status}（待开始的阶段：${PHASE_LABEL[state.phase]}）`,
          `设置：专注 ${settings.focusMin} 分钟，短休息 ${settings.shortMin}，长休息 ${settings.longMin}，每 ${settings.longEvery} 个专注后长休息`,
          `统计：今天 ${stats.todayCount} 个 / ${stats.todayMinutes} 分钟；近 7 天 ${stats.weekMinutes} 分钟；连续 ${stats.streak} 天；累计 ${stats.totalCount} 个`,
          log.length ? `最近的专注：\n${log.map((r) => `${new Date(r.at).toLocaleString('zh-CN', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false})}｜${r.minutes} 分钟${r.label ? `｜${r.label}` : ''}`).join('\n')}` : '还没有专注记录。',
        ].join('\n')
      },
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({action: str(obj(raw).action), label: optStr(obj(raw).label), minutes: num(obj(raw).minutes), phase: optStr(obj(raw).phase)})},
      json: {
        type: 'object',
        properties: {
          action: {type: 'string', enum: ['start', 'pause', 'resume', 'stop'], description: 'start 开始当前阶段；pause 暂停；resume 继续；stop 放弃这一段（不记录）'},
          label: {type: 'string', description: 'start 时可写这一轮要做什么'},
          minutes: {type: 'number', description: 'start 时临时指定时长（分钟），不填用设置里的'},
          phase: {type: 'string', enum: ['focus', 'short', 'long'], description: 'start 前可先切到专注 / 短休息 / 长休息'},
        },
        required: ['action'],
      },
    },
    {
      name: 'control_focus',
      title: '操作番茄钟',
      description: '开始、暂停、继续、放弃番茄钟。计时在页面里跑，到点会提醒用户；注意用户得保持页面开着。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          if (args.phase) {
            if (!['focus', 'short', 'long'].includes(args.phase)) throw new WorkspaceError('phase 只能是 focus / short / long。')
            focusActions.switchTo(args.phase as FocusPhase)
          }
          switch (args.action) {
            case 'start':
              focusActions.start(args.label, args.minutes)
              break
            case 'pause':
              focusActions.pause()
              break
            case 'resume':
              focusActions.resume()
              break
            case 'stop':
              focusActions.stop()
              break
            default:
              throw new WorkspaceError('action 只能是 start / pause / resume / stop。')
          }
          const state = getFocusState()
          return state.status === 'idle' ? `现在没有在计时（待开始：${PHASE_LABEL[state.phase]}）。` : `${PHASE_LABEL[state.phase]}${state.status === 'running' ? '计时中' : '已暂停'}，还剩 ${mmss(remaining(state))}。`
        }),
    },
  ),

  /* ───── 音乐 ───── */
  define(
    {schema: {parse: obj}, json: {type: 'object', properties: {}}},
    {
      name: 'get_music',
      title: '查看音乐',
      description: '看播放列表和现在的播放状态；同时列出可以一键加入的内置预设（白噪音、SomaFM 电台）。',
      effect: 'read',
      highRisk: () => false,
      execute: async () => {
        const state = getPlayerState()
        const tracks = readTracks()
        const now = currentTrack()
        const status = state.playing ? `正在播放「${now?.title ?? '?'}」` : now ? `已暂停（上次：「${now.title}」）` : '没有在播放'
        const missing = PRESETS.filter((p) => !tracks.some((t) => t.url === p.url))
        return [
          `${status}｜音量 ${Math.round(state.volume * 100)}%｜${MODE_LABEL[state.mode]}${state.error ? `｜出错：${state.error}` : ''}`,
          tracks.length ? `播放列表（${tracks.length}）：\n${tracks.map((t) => `${t.id}｜${t.title}${t.url.startsWith('noise:') ? '（噪音）' : ''}`).join('\n')}` : '播放列表是空的。',
          missing.length ? `可一键加入的预设：${missing.map((p) => p.title).join('、')}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      },
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({preset: optStr(obj(raw).preset), title: optStr(obj(raw).title), url: optStr(obj(raw).url)})},
      json: {
        type: 'object',
        properties: {
          preset: {type: 'string', description: `加入一个内置预设，填它的名称：${PRESETS.map((p) => p.title).join('、')}`},
          title: {type: 'string', description: '自定义曲目的名称'},
          url: {type: 'string', description: '自定义曲目的地址：https 音频直链或网络电台，或 noise:white / noise:pink / noise:brown'},
        },
      },
    },
    {
      name: 'add_music',
      title: '添加音乐',
      description: '往播放列表里加：一个内置预设（preset），或一个自定义地址（url，可带 title）。不会自动播放，要播再用 control_music。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(() => {
          if (args.preset) {
            const hit = PRESETS.find((p) => p.title === args.preset || p.title.includes(args.preset ?? '\0'))
            if (!hit) throw new WorkspaceError(`没有这个预设「${args.preset}」。可用：${PRESETS.map((p) => p.title).join('、')}`)
            const track = addPreset(hit.url)
            return `已加入「${track?.title}」，id ${track?.id}。`
          }
          if (!args.url) throw new WorkspaceError('要么给 preset，要么给 url。')
          const track = addTrack(args.title ?? '', args.url)
          return `已加入「${track.title}」，id ${track.id}。`
        }),
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({action: str(obj(raw).action), trackId: optStr(obj(raw).trackId), volume: num(obj(raw).volume), mode: optStr(obj(raw).mode)})},
      json: {
        type: 'object',
        properties: {
          action: {type: 'string', enum: ['play', 'pause', 'next', 'prev', 'stop', 'volume', 'mode'], description: 'play 播放（可指定 trackId）；pause 暂停；next / prev 切歌；stop 停止；volume 调音量；mode 切换循环方式'},
          trackId: {type: 'string', description: 'play 时指定曲目 id（get_music 里的 id）；不填继续当前或从头'},
          volume: {type: 'number', description: 'action 为 volume 时，0 到 1'},
          mode: {type: 'string', enum: ['list', 'one', 'shuffle'], description: 'action 为 mode 时：列表循环 / 单曲循环 / 随机'},
        },
        required: ['action'],
      },
    },
    {
      name: 'control_music',
      title: '操作播放器',
      description: '播放、暂停、切歌、调音量、换循环方式。浏览器要求用户在页面上操作过才允许出声；若提示被拦截，请用户点一下页面再试。',
      effect: 'write',
      highRisk: () => false,
      execute: (args) =>
        guard(async () => {
          switch (args.action) {
            case 'play':
              if (args.trackId && !readTracks().some((t) => t.id === args.trackId)) throw new WorkspaceError('没有这首，先用 get_music 看 id。')
              if (!readTracks().length) throw new WorkspaceError('播放列表是空的，先 add_music。')
              playerActions.play(args.trackId)
              break
            case 'pause':
              playerActions.pause()
              break
            case 'next':
              playerActions.next()
              break
            case 'prev':
              playerActions.prev()
              break
            case 'stop':
              playerActions.stop()
              break
            case 'volume':
              if (args.volume === undefined) throw new WorkspaceError('要给 volume（0 到 1）。')
              playerActions.setVolume(args.volume)
              break
            case 'mode':
              if (!['list', 'one', 'shuffle'].includes(args.mode ?? '')) throw new WorkspaceError('mode 只能是 list / one / shuffle。')
              playerActions.setMode(args.mode as PlayMode)
              break
            default:
              throw new WorkspaceError('action 不对，见参数说明。')
          }
          // 等一下，让「被浏览器拦截 / 地址失效」这类错误有机会冒出来，如实告诉模型
          await new Promise((resolve) => setTimeout(resolve, 600))
          const state = getPlayerState()
          if (state.error) return `没成功：${state.error}`
          const now = currentTrack()
          return state.playing ? `正在播放「${now?.title}」。` : `已${args.action === 'stop' ? '停止' : '暂停或未播放'}。音量 ${Math.round(state.volume * 100)}%，${MODE_LABEL[state.mode]}。`
        }),
    },
  ),
  define(
    {
      schema: {parse: (raw) => ({ids: strList(obj(raw).ids)})},
      json: {type: 'object', properties: {ids: {type: 'array', items: {type: 'string'}}}, required: ['ids']},
    },
    {
      name: 'remove_music',
      title: '移出音乐',
      description: '把曲目移出播放列表。',
      effect: 'write',
      highRisk: () => true,
      execute: (args) =>
        guard(() => {
          const tracks = readTracks().filter((t) => args.ids.includes(t.id))
          if (!tracks.length) throw new WorkspaceError('没有找到这些曲目，先用 get_music 看 id。')
          for (const track of tracks) removeTrack(track.id)
          return `已移出：${tracks.map((t) => t.title).join('、')}`
        }),
    },
  ),
]
