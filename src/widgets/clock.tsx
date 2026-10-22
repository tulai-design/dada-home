import {Flexbox, Text} from '@lobehub/ui'
import {useNow} from '../hooks'
import {clockText, greeting, monthDayCn, weekdayCn} from '../lib/date'
import {registerComponent, type ComponentProps} from '../lib/registry'

type ClockConfig = {
  showSeconds: boolean
  showGreeting: boolean
  align: 'left' | 'center'
}

function Clock({config, host}: ComponentProps<ClockConfig>) {
  const now = useNow(config.showSeconds ? 1000 : 20000)
  return (
    <Flexbox className="w-clock" data-align={config.align} gap={4}>
      <div className="home-clock">
        <span>{clockText(now, false)}</span>
        {config.showSeconds && <span className="home-clock-sec">{String(now.getSeconds()).padStart(2, '0')}</span>}
      </div>
      {config.showGreeting && (
        <Text className="home-dateline" type="secondary">
          {greeting(now)}，<em>{host.profile.name}</em> · {monthDayCn(now)} {weekdayCn(now)}
        </Text>
      )}
    </Flexbox>
  )
}

registerComponent<ClockConfig>({
  type: 'clock',
  name: '时钟',
  description: '大号数字时钟，可显示秒和问候语。适合放在首页顶部。',
  category: 'info',
  defaultConfig: {showSeconds: true, showGreeting: true, align: 'left'},
  configSchema: {
    showSeconds: {kind: 'boolean', label: '显示秒'},
    showGreeting: {kind: 'boolean', label: '显示问候语和日期'},
    align: {
      kind: 'select',
      label: '对齐',
      options: [
        {value: 'left', label: '靠左'},
        {value: 'center', label: '居中'},
      ],
    },
  },
  defaultSpan: 'full',
  component: Clock,
  multiple: true,
})
