import {useState} from 'react'
import {Block, Button, Flexbox, Markdown, SearchBar, Segmented, Tag, Text} from '@lobehub/ui'
import {useStored} from '../lib/store'
import {SEARCH_ENGINES} from '../lib/defaults'
import {useTurns} from '../lib/chat'
import {registerComponent, type ComponentProps} from '../lib/registry'

type SearchMode = 'ai' | (typeof SEARCH_ENGINES)[number]['id']

type SearchConfig = {
  showEngines: boolean
  showPresets: boolean
}

const PRESETS = ['总结今天的订阅', '帮我加一个待办', '把天气挪到右边', '给我做一个阅读页']

function looksLikeUrl(q: string) {
  return /^(https?:\/\/|[a-z0-9-]+\.[a-z]{2,})(\/\S*)?$/i.test(q.trim())
}

function SearchBox({config, host}: ComponentProps<SearchConfig>) {
  const [value, setValue] = useState('')
  const [mode, setMode] = useStored<SearchMode>('searchMode', 'ai')
  const [turns] = useTurns()

  const active: SearchMode = mode === 'ai' || SEARCH_ENGINES.some((e) => e.id === mode) ? mode : 'ai'
  const engine = SEARCH_ENGINES.find((e) => e.id === active)
  const url = looksLikeUrl(value)

  const lastTurn = turns[turns.length - 1]
  const lastTool = lastTurn?.tools[lastTurn.tools.length - 1]
  const peek = Boolean(lastTurn && (lastTurn.answer || lastTool || host.aiBusy))

  const submit = (raw = value) => {
    const text = raw.trim()
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
      {config.showEngines && (
        <Segmented
          block
          size="large"
          value={active}
          onChange={(next) => setMode(next as SearchMode)}
          options={[{value: 'ai', label: 'AI+'}, ...SEARCH_ENGINES.map((item) => ({value: item.id, label: item.label}))]}
        />
      )}
      <SearchBar
        size="large"
        shadow
        allowClear
        value={value}
        placeholder={placeholder}
        onValueChange={(next) => setValue(next)}
        onSearch={(next) => submit(next)}
        onPressEnter={() => submit()}
        disabled={active === 'ai' && host.aiBusy}
        suffix={
          active === 'ai' && host.aiBusy ? (
            <Button size="small" onClick={host.openAssistant}>
              查看
            </Button>
          ) : (
            <Button type="primary" size="small" disabled={!value.trim()} onClick={() => submit()}>
              {url ? '打开' : active === 'ai' ? '提问' : '搜索'}
            </Button>
          )
        }
      />

      {!peek && active === 'ai' && config.showPresets && (
        <Flexbox direction="horizontal" align="center" justify="center" wrap="wrap" gap={8} width="100%">
          {PRESETS.map((item) => (
            <Tag
              key={item}
              variant="outlined"
              style={{cursor: 'pointer'}}
              onClick={() => {
                if (!host.aiConfigured) {
                  host.openSettings()
                  return
                }
                if (!host.aiBusy) host.ask(item)
              }}
            >
              {item}
            </Tag>
          ))}
          <Text type="secondary" fontSize={12}>
            {host.aiConfigured ? host.aiModel : '未配置模型'}
          </Text>
        </Flexbox>
      )}

      {!peek && active !== 'ai' && (
        <Text type="secondary" fontSize={12}>
          回车在{engine?.label}搜索 · 输入网址可直接打开
        </Text>
      )}

      {peek && (
        <Block className="hero-answer" clickable onClick={host.openAssistant}>
          {lastTurn && (
            <Text type="secondary" ellipsis>
              {lastTurn.prompt}
            </Text>
          )}
          {lastTool && (
            <Text fontSize={12} type={lastTool.ok ? 'secondary' : 'danger'}>
              {lastTool.ok ? '已执行' : '未完成'} · {lastTool.text}
            </Text>
          )}
          <div className="hero-answer-body">
            {lastTurn?.answer ? <Markdown variant="chat">{lastTurn.answer}</Markdown> : <Text type="secondary">正在整理回答</Text>}
          </div>
          <Text fontSize={12} type="secondary">
            打开完整对话
          </Text>
        </Block>
      )}
    </Flexbox>
  )
}

registerComponent<SearchConfig>({
  type: 'search',
  name: '搜索与对话',
  description: '一个输入框：可以直接搜索、打开网址，或对搭搭说一句话来改页面。通常是首页最显眼的那一块。',
  category: 'system',
  defaultConfig: {showEngines: true, showPresets: true},
  configSchema: {
    showEngines: {kind: 'boolean', label: '显示搜索引擎切换'},
    showPresets: {kind: 'boolean', label: '显示示例说法'},
  },
  defaultSpan: 'full',
  component: SearchBox,
  multiple: false,
})
