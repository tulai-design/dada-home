import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import {ActionIcon, Button, Flexbox, Input, Text} from '@lobehub/ui'
import {ArrowUp, Check, ChevronDown, ChevronRight, CircleAlert, LoaderCircle, Search} from 'lucide-react'
import {useStored} from '../lib/store'
import {SEARCH_ENGINES} from '../lib/defaults'
import {useChat} from '../lib/chat'
import {registerComponent, type ComponentProps} from '../lib/registry'

type SearchMode = 'ai' | (typeof SEARCH_ENGINES)[number]['id']

type SearchConfig = {
  showEngines: boolean
}

type Entry = {id: SearchMode; label: string; tag: string; logo: ReactNode}

/** 引擎徽标：用品牌自己的图标（public/engines/*.svg）。AI 用搭搭的 logo。 */
function Logo({entry}: {entry: {id: string}}) {
  const base = import.meta.env.BASE_URL
  const src = entry.id === 'ai' ? `${base}brand/dada-logo.png` : `${base}engines/${entry.id}.svg`
  return (
    <span className="engine-logo" data-ai={entry.id === 'ai' ? 'true' : undefined}>
      <img src={src} alt="" draggable={false} />
    </span>
  )
}

const ENTRIES: Entry[] = [
  {id: 'ai', label: '搭搭 AI', tag: 'ai', logo: <Logo entry={{id: 'ai'}} />},
  ...SEARCH_ENGINES.map((e) => ({id: e.id as SearchMode, label: e.label, tag: e.tag as string, logo: <Logo entry={e} />})),
]

function looksLikeUrl(q: string) {
  return /^(https?:\/\/|[a-z0-9-]+\.[a-z]{2,})(\/\S*)?$/i.test(q.trim())
}

/** 触屏设备：一进页面就聚焦会弹出键盘，挡住半个屏幕。 */
const isTouch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

function SearchBox({config, host}: ComponentProps<SearchConfig>) {
  const [value, setValue] = useState('')
  const [mode, setMode] = useStored<SearchMode>('searchMode', 'ai')
  const {turns} = useChat()
  const [menu, setMenu] = useState(false)
  const [hi, setHi] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  // 关掉“引擎切换”后，输入框固定为 AI，不再响应 #
  const switchable = config.showEngines
  const active: SearchMode = !switchable ? 'ai' : ENTRIES.some((e) => e.id === mode) ? mode : 'ai'
  const current = ENTRIES.find((e) => e.id === active) ?? ENTRIES[0]
  const engine = SEARCH_ENGINES.find((e) => e.id === active)
  const url = looksLikeUrl(value)

  // 输入以 # 开头且还没有空格：进入口令模式，按 tag 或名称筛选
  const hashQuery = switchable && /^#\S*$/.test(value) ? value.slice(1).toLowerCase() : null
  const entries = useMemo(
    () => (hashQuery === null ? ENTRIES : ENTRIES.filter((e) => e.tag.startsWith(hashQuery) || e.label.toLowerCase().includes(hashQuery))),
    [hashQuery],
  )
  const panelOpen = switchable && (menu || hashQuery !== null) && entries.length > 0

  useEffect(() => setHi(0), [hashQuery, menu])

  useEffect(() => {
    if (!menu) return
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenu(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menu])

  const pick = (entry: Entry) => {
    setMode(entry.id)
    setMenu(false)
    setValue((current) => (current.startsWith('#') ? '' : current))
  }

  const onChange = (next: string) => {
    // “#gg 关键词”：口令后面敲了空格，就切过去并把口令去掉
    const m = switchable ? /^#(\S+)\s(.*)$/s.exec(next) : null
    const hit = m && ENTRIES.find((e) => e.tag === m[1].toLowerCase())
    if (hit && m) {
      setMode(hit.id)
      setMenu(false)
      setValue(m[2])
      return
    }
    setValue(next)
  }

  const lastTurn = turns[turns.length - 1]
  const lastTool = lastTurn?.tools[lastTurn.tools.length - 1]
  // 首页只给一行进度提示：进行中，或刚结束不久。回答的内容一律去 AI 面板里看。
  const fresh = lastTurn ? lastTurn.endedAt === undefined || Date.now() - lastTurn.endedAt < 90_000 : false
  const peek = Boolean(lastTurn && (host.aiBusy || fresh))
  const failed = Boolean(lastTurn?.error || (lastTool && !lastTool.ok))
  const busy = active === 'ai' && host.aiBusy

  const submit = () => {
    const text = value.trim()
    if (!text) return
    if (url) {
      host.search(text, 'direct')
      setValue('')
      return
    }
    if (active === 'ai') {
      if (!host.aiConfigured) {
        host.openSettings()
        return
      }
      if (host.aiBusy) return
      host.ask(text)
      setValue('')
      return
    }
    host.search(text, active)
    setValue('')
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return
    if (panelOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setHi((i) => (i + 1) % entries.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setHi((i) => (i - 1 + entries.length) % entries.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        pick(entries[Math.min(hi, entries.length - 1)])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setMenu(false)
        if (hashQuery !== null) setValue('')
        return
      }
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      submit()
    }
  }

  const placeholder = url
    ? '回车打开这个地址'
    : active === 'ai'
      ? host.aiBusy
        ? '正在回答…'
        : host.aiConfigured
          ? '说一句话，让搭搭帮你改页面'
          : '先到设置里接上模型'
      : `在${engine?.label ?? '网页'}里搜索`

  return (
    <Flexbox className="hero-search" direction="vertical" gap={12}>
      <div className="hero-box-wrap" ref={rootRef}>
        <div className="hero-box" data-ai={active === 'ai' ? 'true' : undefined}>
          {switchable && (
            <Button
              className="hero-engine"
              type="text"
              title="切换搜索引擎（也可以输入 #）"
              aria-expanded={panelOpen}
              onClick={() => setMenu((open) => !open)}
            >
              {current.logo}
              <ChevronDown size={14} />
            </Button>
          )}
          <Input
            className="hero-input"
            variant="borderless"
            autoFocus={!isTouch}
            allowClear
            value={value}
            placeholder={placeholder}
            disabled={busy}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
          />
          {busy ? (
            <ActionIcon className="hero-send" icon={LoaderCircle} spin title="AI 正在处理，点这里查看" onClick={host.openAssistant} />
          ) : (
            <ActionIcon
              className="hero-send"
              data-ready={value.trim() ? 'true' : undefined}
              icon={active === 'ai' && !url ? ArrowUp : Search}
              title={url ? '打开地址（回车）' : active === 'ai' ? '发送（回车）' : '搜索（回车）'}
              onClick={submit}
            />
          )}
        </div>

        {panelOpen && (
          <div className="engine-panel" role="listbox">
            {entries.map((entry, index) => (
              <Button
                key={entry.id}
                block
                type="text"
                className="engine-item"
                data-hi={index === hi ? 'true' : undefined}
                data-on={entry.id === active ? 'true' : undefined}
                onMouseEnter={() => setHi(index)}
                onClick={() => pick(entry)}
              >
                {entry.logo}
                <span className="engine-name">{entry.label}</span>
                {entry.id === active && <Check size={13} />}
                <span className="engine-tag">#{entry.tag}</span>
              </Button>
            ))}
          </div>
        )}
      </div>

      {!peek && active !== 'ai' && (
        <Text className="hero-aux" type="secondary" fontSize={12}>
          回车在{engine?.label}搜索 · 输入网址直接打开 · 输入 # 换引擎
        </Text>
      )}

      {peek && lastTurn && (
        <Button
          className="hero-status hero-aux"
          type="text"
          icon={host.aiBusy ? <LoaderCircle size={14} className="spin" /> : failed ? <CircleAlert size={14} /> : <Check size={14} />}
          onClick={host.openAssistant}
        >
          <span className="hero-status-title">{lastTurn.prompt}</span>
          <em>{host.aiBusy ? '处理中' : failed ? '未完成' : '已完成'}</em>
          <ChevronRight size={14} />
        </Button>
      )}
    </Flexbox>
  )
}

registerComponent<SearchConfig>({
  type: 'search',
  name: '搜索与对话',
  description: '一个输入框：左侧是搜索引擎/AI 切换（下拉，或输入 #gg #bd #ai 等口令切换），右侧是发送图标。可直接搜索、打开网址，或对搭搭说一句话来改页面。通常是首页最显眼的那一块。',
  category: 'system',
  defaultConfig: {showEngines: true},
  configSchema: {
    showEngines: {kind: 'boolean', label: '显示引擎切换（下拉和 # 口令；关掉则固定为 AI）'},
  },
  defaultSpan: 'full',
  component: SearchBox,
  multiple: false,
})
