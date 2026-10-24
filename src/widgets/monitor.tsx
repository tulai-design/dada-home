import {Empty, Flexbox, Text} from '@lobehub/ui'
import {registerComponent, type ComponentProps} from '../lib/registry'

type MonitorConfig = {
  heading: string
}

const TONE_LABEL = {ok: '在线', err: '异常', loading: '读取中', '': '未知'} as const

/** 监控概览：每个接入一行，状态一眼可见。完整曲线在侧栏的「监控」页。 */
function MonitorWidget({config, host}: ComponentProps<MonitorConfig>) {
  const {items} = host.monitor
  return (
    <Flexbox className="page-pane" direction="vertical" gap={8}>
      <Text as="h2">{config.heading}</Text>
      {items.length ? (
        <div className="monitor-mini page-list">
          {items.map((item) => (
            <div key={item.id} className="monitor-mini-row" data-tone={item.tone || 'idle'} onClick={host.openMonitor}>
              <i />
              <span className="monitor-mini-name">{item.name}</span>
              <span className="monitor-mini-text">{item.text || TONE_LABEL[item.tone]}</span>
            </div>
          ))}
        </div>
      ) : (
        <Empty title="还没有接入监控" description="到 设置 › 监控 里接入。" />
      )}
    </Flexbox>
  )
}

/** 状态条形态：一个状态点 + 在线数。 */
function MonitorStatus({host}: ComponentProps<MonitorConfig>) {
  const {online, total, tone} = host.monitor
  return (
    <span className="status-chip" data-tone={tone || 'idle'} title="服务监控" onClick={host.openMonitor} role="button">
      <i className="status-dot" />
      {total ? `${online}/${total}` : '未接入'}
    </span>
  )
}

registerComponent<MonitorConfig>({
  type: 'monitor',
  name: '服务监控',
  description: '已接入的服务器和服务的在线概况，每个接入一行。也可以放进状态条，实时显示在线数。',
  category: 'system',
  defaultConfig: {heading: '服务监控'},
  configSchema: {heading: {kind: 'string', label: '标题'}},
  defaultSpan: 'third',
  component: MonitorWidget,
  status: MonitorStatus,
  multiple: false,
})
