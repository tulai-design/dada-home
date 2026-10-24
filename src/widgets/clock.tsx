import {Flexbox, Text} from '@lobehub/ui'
import {CloudSun} from 'lucide-react'
import {useNow} from '../hooks'
import {clockText, greeting, monthDayCn, weekdayCn} from '../lib/date'
import {registerComponent, type ComponentProps} from '../lib/registry'
import {useResource} from '../lib/resource'
import type {Weather as WeatherShape} from '../lib/types'
import {fetchWeather} from '../lib/weather'

type ClockConfig = {
  showSeconds: boolean
  showGreeting: boolean
  /** 在日期右侧附一行简短天气 */
  showWeather: boolean
  align: 'left' | 'center'
}

/** 一行天气：状态、气温、城市。需要时才请求，没开就不发请求。 */
function WeatherLine({host}: Pick<ComponentProps<ClockConfig>, 'host'>) {
  const {lat, lon, city} = host.profile
  const resource = useResource<WeatherShape>(`weather|${lat}|${lon}|${city}`, () => fetchWeather(lat, lon, city), {every: 600_000})
  const weather = resource.data
  if (!weather) return null
  return (
    <span className="home-weather" title={`${weather.min}° / ${weather.max}° · 湿度 ${weather.humidity}%`}>
      <CloudSun size={14} />
      {weather.label} {weather.temp}°C · {weather.place}
    </span>
  )
}

function Clock({config, host}: ComponentProps<ClockConfig>) {
  const now = useNow(config.showSeconds ? 1000 : 20000)
  return (
    <Flexbox className="w-clock" data-align={config.align} gap={4}>
      <div className="home-clock">
        <span>{clockText(now, false)}</span>
        {config.showSeconds && <span className="home-clock-sec">{String(now.getSeconds()).padStart(2, '0')}</span>}
      </div>
      {(config.showGreeting || config.showWeather) && (
        <Text className="home-dateline" type="secondary">
          {config.showGreeting && (
            <span>
              {greeting(now)}，<em>{host.profile.name}</em> · {monthDayCn(now)} {weekdayCn(now)}
            </span>
          )}
          {config.showWeather && <WeatherLine host={host} />}
        </Text>
      )}
    </Flexbox>
  )
}

/** 状态条形态：只有时间，自己每秒（或每 15 秒）走一次。 */
function ClockStatus({config}: ComponentProps<ClockConfig>) {
  const now = useNow(config.showSeconds ? 1000 : 15000)
  return <span className="status-time">{clockText(now, config.showSeconds)}</span>
}

registerComponent<ClockConfig>({
  type: 'clock',
  name: '时钟',
  description: '大号数字时钟，可显示秒、问候语与日期，以及日期右侧的一行天气。适合放在首页顶部。',
  category: 'info',
  defaultConfig: {showSeconds: false, showGreeting: true, showWeather: true, align: 'center'},
  configSchema: {
    showSeconds: {kind: 'boolean', label: '显示秒'},
    showGreeting: {kind: 'boolean', label: '显示问候语和日期'},
    showWeather: {kind: 'boolean', label: '日期右侧显示一行天气'},
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
  status: ClockStatus,
  multiple: true,
})
