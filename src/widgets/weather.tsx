import {Empty, Flexbox, Text} from '@lobehub/ui'
import {registerComponent, type ComponentProps} from '../lib/registry'
import {useResource} from '../lib/resource'
import type {Weather as WeatherShape} from '../lib/types'
import {fetchWeather} from '../lib/weather'

type WeatherConfig = {
  /** 留空则用全局设置里的城市 */
  city: string
  showDetail: boolean
}

function Weather({config, host}: ComponentProps<WeatherConfig>) {
  // 坐标来自全局设置（设置里换城市会同时更新坐标）；city 只用来改显示名。
  const place = config.city.trim() || host.profile.city
  const resource = useResource<WeatherShape>(
    `weather|${host.profile.lat}|${host.profile.lon}|${place}`,
    () => fetchWeather(host.profile.lat, host.profile.lon, place),
    {every: 600_000},
  )
  const weather = resource.data

  if (!weather) {
    return <Empty title={resource.error ? resource.error : '正在读取天气'} />
  }

  return (
    <Flexbox direction="horizontal" align="center" gap={16} className="weather-card page-pane" width="100%">
      <Text className="weather-temp">
        {weather.temp}
        <Text as="sup" type="secondary">
          °C
        </Text>
      </Text>
      <Flexbox direction="vertical" gap={4}>
        <Text>{weather.label}</Text>
        <Text type="secondary">{weather.place}</Text>
        {config.showDetail && (
          <Text type="secondary">
            {weather.min}° / {weather.max}° · 湿度 {weather.humidity}% · 风 {weather.wind} km/h
          </Text>
        )}
      </Flexbox>
    </Flexbox>
  )
}

registerComponent<WeatherConfig>({
  type: 'weather',
  name: '天气',
  description: '当前天气，含温度、天气状况和地点。默认用设置里的城市，也可以指定别的城市名。',
  category: 'info',
  defaultConfig: {city: '', showDetail: true},
  configSchema: {
    city: {kind: 'string', label: '城市', placeholder: '留空则用设置里的城市'},
    showDetail: {kind: 'boolean', label: '显示温区、湿度和风'},
  },
  defaultSpan: 'third',
  component: Weather,
  multiple: false,
})
