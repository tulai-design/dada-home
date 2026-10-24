import {useState} from 'react'
import {Button, Empty, Flexbox, Text} from '@lobehub/ui'
import {CloudSun, MapPin} from 'lucide-react'
import {registerApp, useAppSettings} from '../lib/apps'
import {Group, Row, TextRow} from '../components/ios'
import {registerComponent, type ComponentProps} from '../lib/registry'
import {useResource} from '../lib/resource'
import type {Weather as WeatherShape} from '../lib/types'
import {fetchWeather, geocode, type GeoPlace} from '../lib/weather'

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
    <Flexbox direction="vertical" gap={8} className="weather-card page-pane" width="100%">
      <Text as="h2">天气</Text>
      <Flexbox direction="horizontal" align="center" gap={18} width="100%">
        <Text className="weather-temp">
          {weather.temp}
          <Text as="sup" type="secondary">
            °C
          </Text>
        </Text>
        <Flexbox direction="vertical" gap={4}>
          <Text className="weather-label">{weather.label}</Text>
          <Text type="secondary">{weather.place}</Text>
          {config.showDetail && (
            <Text type="secondary" fontSize={12}>
              {weather.min}° / {weather.max}° · 湿度 {weather.humidity}% · 风 {weather.wind} km/h
            </Text>
          )}
        </Flexbox>
      </Flexbox>
    </Flexbox>
  )
}

/** 状态条形态：一行 图标 + 温度 + 状态。点它去看完整天气。 */
function WeatherStatus({config, host}: ComponentProps<WeatherConfig>) {
  const place = config.city.trim() || host.profile.city
  const resource = useResource<WeatherShape>(
    `weather|${host.profile.lat}|${host.profile.lon}|${place}`,
    () => fetchWeather(host.profile.lat, host.profile.lon, place),
    {every: 600_000},
  )
  const weather = resource.data
  return (
    <span className="status-chip" title={weather ? `${weather.place} ${weather.min}°~${weather.max}° · 湿度 ${weather.humidity}%` : '天气'}>
      <CloudSun size={13} />
      {weather ? `${weather.temp}° ${weather.label}` : '…'}
    </span>
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
  status: WeatherStatus,
  multiple: false,
})


/* ---------- 应用设置：天气 ---------- */

function WeatherSettings() {
  const {settings, patch} = useAppSettings()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeoPlace[]>([])
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const lookup = async () => {
    if (!query.trim()) return
    setBusy(true)
    setFailed(false)
    try {
      const found = await geocode(query.trim())
      setResults(found)
      setFailed(found.length === 0)
    } catch {
      setResults([])
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Group
        title="当前位置"
        footer={`坐标 ${settings.lat.toFixed(3)}, ${settings.lon.toFixed(3)}。天气由 Open-Meteo 提供，首页时钟和天气组件都用这里的位置。`}
      >
        <Row label="城市">{settings.city}</Row>
      </Group>
      <Group title="重新定位" footer={failed ? <Text type="danger">没有找到这个地名。</Text> : '输入地名，回车查询。'}>
        <TextRow label="地名" value={query} placeholder="例如 杭州" onChange={setQuery} onEnter={() => void lookup()} />
        <Row>
          <Button loading={busy} icon={<MapPin size={14} />} onClick={() => void lookup()}>
            查询
          </Button>
        </Row>
        {results.map((place) => (
          <Row
            key={`${place.lat}${place.lon}`}
            label={place.name}
            hint={place.admin}
            chevron
            onClick={() => {
              patch({city: place.name, lat: place.lat, lon: place.lon})
              setResults([])
              setQuery('')
            }}
          />
        ))}
      </Group>
    </>
  )
}

registerApp({
  id: 'weather',
  name: '天气',
  icon: CloudSun,
  color: '#32ade6',
  description: '天气使用的城市和坐标。',
  summary: (ctx) => ctx.settings.city,
  Panel: WeatherSettings,
})
