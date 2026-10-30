import type { Weather } from './types'

const WMO: Record<number, string> = {
  0: '晴',
  1: '晴间少云',
  2: '多云',
  3: '阴',
  45: '有雾',
  48: '雾凇',
  51: '毛毛雨',
  53: '小雨',
  55: '雨',
  56: '冻雨',
  57: '冻雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '冻雨',
  67: '冻雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '米雪',
  80: '阵雨',
  81: '阵雨',
  82: '暴雨',
  85: '阵雪',
  86: '阵雪',
  95: '雷雨',
  96: '雷雨冰雹',
  99: '雷雨冰雹',
}

export const weatherLabel = (code: number) => WMO[code] ?? '未知'

export type GeoPlace = { name: string; lat: number; lon: number; admin?: string }

export async function geocode(query: string, signal?: AbortSignal): Promise<GeoPlace[]> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=zh&format=json`
  const res = await fetch(url, {signal})
  if (!res.ok) throw new Error('地名查询失败')
  const json = (await res.json()) as {
    results?: { name: string; latitude: number; longitude: number; admin1?: string; country?: string }[]
  }
  return (json.results ?? []).map((r) => ({
    name: r.name,
    lat: r.latitude,
    lon: r.longitude,
    admin: [r.admin1, r.country].filter(Boolean).join(' · '),
  }))
}

export async function fetchWeather(lat: number, lon: number, place: string): Promise<Weather> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m' +
    '&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1'
  const res = await fetch(url)
  if (!res.ok) throw new Error('天气获取失败')
  const json = (await res.json()) as {
    current?: { temperature_2m: number; relative_humidity_2m: number; weather_code: number; wind_speed_10m: number }
    daily?: { temperature_2m_max: number[]; temperature_2m_min: number[] }
  }
  if (!json.current) throw new Error('天气数据为空')
  return {
    temp: Math.round(json.current.temperature_2m),
    max: Math.round(json.daily?.temperature_2m_max?.[0] ?? json.current.temperature_2m),
    min: Math.round(json.daily?.temperature_2m_min?.[0] ?? json.current.temperature_2m),
    code: json.current.weather_code,
    label: weatherLabel(json.current.weather_code),
    wind: Math.round(json.current.wind_speed_10m),
    humidity: Math.round(json.current.relative_humidity_2m),
    place,
  }
}
