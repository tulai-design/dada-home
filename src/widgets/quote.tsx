import {Flexbox, Text} from '@lobehub/ui'
import {QUOTES} from '../lib/defaults'
import {useLocalHour} from '../hooks'
import {registerComponent, type ComponentProps} from '../lib/registry'

type QuoteConfig = {
  /** 自定义句子，每行一句；留空则用内置文案 */
  text: string
  /** 按小时换一句 */
  rotate: boolean
}

function Quote({config}: ComponentProps<QuoteConfig>) {
  const hour = useLocalHour()
  const lines = config.text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const pool = lines.length ? lines : QUOTES
  const index = config.rotate ? hour % pool.length : 0

  return (
    <Flexbox className="page-pane" gap={4}>
      <Text className="quote-line">{pool[index]}</Text>
    </Flexbox>
  )
}

registerComponent<QuoteConfig>({
  type: 'quote',
  name: '每日一句',
  description: '显示一句短句或格言。可以自定义内容，也可以每小时自动换。',
  category: 'info',
  defaultConfig: {text: '', rotate: true},
  configSchema: {
    text: {kind: 'string', label: '自定义句子', description: '每行一句；留空使用内置文案'},
    rotate: {kind: 'boolean', label: '每小时换一句'},
  },
  defaultSpan: 'third',
  component: Quote,
  multiple: true,
})
