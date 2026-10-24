import {ActionIcon, Flexbox, Text} from '@lobehub/ui'
import {RefreshCw} from 'lucide-react'
import {QUOTES} from '../lib/defaults'
import {useLocalHour} from '../hooks'
import {registerComponent, type ComponentProps} from '../lib/registry'
import {useResource} from '../lib/resource'

type QuoteConfig = {
  /** 内容来源：自带 / 一言 / 今日诗词 */
  source: 'builtin' | 'hitokoto' | 'poem'
  /** 自定义句子，每行一句；留空则用内置文案（仅「自带」时有效） */
  text: string
  /** 按小时换一句 */
  rotate: boolean
  /** 一言的类型 */
  hitokotoKind: 'all' | 'literature' | 'poem' | 'philosophy' | 'anime'
}

type Line = {text: string; from?: string}

/** 一言的分类：https://developer.hitokoto.cn/sentence/#句子类型-参数 */
const KIND: Record<QuoteConfig['hitokotoKind'], string> = {
  all: '',
  literature: 'd&c=h',
  poem: 'i',
  philosophy: 'k',
  anime: 'a',
}

async function fetchHitokoto(kind: QuoteConfig['hitokotoKind']): Promise<Line> {
  const query = KIND[kind]
  const res = await fetch(`https://v1.hitokoto.cn/?encode=json${query ? `&c=${query}` : ''}`)
  if (!res.ok) throw new Error(`一言返回 ${res.status}`)
  const data = (await res.json()) as {hitokoto?: string; from?: string; from_who?: string | null}
  if (!data.hitokoto) throw new Error('一言没有返回内容')
  const from = [data.from_who, data.from && `《${data.from}》`].filter(Boolean).join(' ')
  return {text: data.hitokoto, from: from || undefined}
}

async function fetchPoem(): Promise<Line> {
  const res = await fetch('https://v2.jinrishici.com/one.json')
  if (!res.ok) throw new Error(`今日诗词返回 ${res.status}`)
  const data = (await res.json()) as {data?: {content?: string; origin?: {title?: string; dynasty?: string; author?: string}}}
  const content = data.data?.content
  if (!content) throw new Error('今日诗词没有返回内容')
  const origin = data.data?.origin
  const from = origin ? [origin.dynasty, origin.author, origin.title && `《${origin.title}》`].filter(Boolean).join(' · ') : undefined
  return {text: content, from}
}

function Quote({config}: ComponentProps<QuoteConfig>) {
  const hour = useLocalHour()
  const online = config.source !== 'builtin'
  // 取数的 key 里带上小时：到下一个小时自然换一句；关了「每小时换」就只在首次和手动刷新时取
  const slot = config.rotate ? hour : 0
  const remote = useResource<Line>(`quote|${config.source}|${config.hitokotoKind}|${slot}`, () => (config.source === 'poem' ? fetchPoem() : fetchHitokoto(config.hitokotoKind)), {enabled: online})

  const lines = config.text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const pool = lines.length ? lines : QUOTES
  const own = pool[config.rotate ? hour % pool.length : 0]

  // 联网来源取不到时退回自带的，不留空白
  const line: Line = online && remote.data ? remote.data : {text: own}

  return (
    <Flexbox className="page-pane" gap={4}>
      <Flexbox horizontal align="flex-start" justify="space-between" gap={8}>
        <Text className="quote-line">{line.text}</Text>
        {online && <ActionIcon icon={RefreshCw} size="small" title="换一句" loading={remote.loading} onClick={() => void remote.refresh()} />}
      </Flexbox>
      {line.from && (
        <Text className="quote-from" type="secondary" fontSize={12}>
          —— {line.from}
        </Text>
      )}
    </Flexbox>
  )
}

registerComponent<QuoteConfig>({
  type: 'quote',
  name: '每日一句',
  description: '显示一句短句或格言。来源可以是自带 / 自定义句子、一言（Hitokoto，可选文学、诗词、哲学、动漫类）、今日诗词（古诗词名句，带作者出处）。联网取不到时自动退回自带内容。',
  category: 'info',
  defaultConfig: {source: 'builtin', text: '', rotate: true, hitokotoKind: 'all'},
  configSchema: {
    source: {
      kind: 'select',
      label: '内容来源',
      options: [
        {value: 'builtin', label: '自带 / 自定义'},
        {value: 'hitokoto', label: '一言'},
        {value: 'poem', label: '今日诗词'},
      ],
    },
    hitokotoKind: {
      kind: 'select',
      label: '一言的类型',
      description: '只在来源是「一言」时有效',
      options: [
        {value: 'all', label: '全部'},
        {value: 'literature', label: '文学、影视'},
        {value: 'poem', label: '诗词'},
        {value: 'philosophy', label: '哲学'},
        {value: 'anime', label: '动画'},
      ],
    },
    text: {kind: 'string', label: '自定义句子', description: '每行一句；留空使用内置文案。只在来源是「自带」时有效'},
    rotate: {kind: 'boolean', label: '每小时换一句'},
  },
  defaultSpan: 'third',
  component: Quote,
  multiple: true,
})
