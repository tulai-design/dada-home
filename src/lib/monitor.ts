import type { MonitorConfig } from './types'
import { proxied } from './rss'

/* ---------------- 类型 ---------------- */

export type MetricPoint = { t: number; v: number }

export type BeszelSystem = {
  id: string
  name: string
  status: 'up' | 'down' | 'paused' | string
  host: string
  info: {
    cpu: number
    mp: number
    dp: number
    la?: [number, number, number]
    u?: number
    c?: number
    m?: string
    o?: string
    v?: string
    bat?: [number, string]
    sv?: [number, number]
  }
  series: {
    cpu: MetricPoint[]
    mem: MetricPoint[]
    disk: MetricPoint[]
    net: MetricPoint[]
    load: MetricPoint[]
  }
}

export type CoolifyApp = { uuid: string; name: string; status: string; fqdn?: string; type: string }
export type CoolifyServer = { uuid: string; name: string; reachable: boolean; ip?: string; isBuildServer?: boolean }
export type CoolifyDeployment = {
  uuid: string
  status: string
  applicationName: string
  serverName?: string
  commit?: string
  commitMessage?: string
  finishedAt?: string
  createdAt: string
}

export type MonitorSnapshot =
  | { kind: 'beszel'; systems: BeszelSystem[]; range: string }
  | { kind: 'coolify'; servers: CoolifyServer[]; apps: CoolifyApp[]; deployments: CoolifyDeployment[] }
  | { kind: 'http'; url: string; ms: number; status: number; history: MetricPoint[] }

export type MonitorState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; snapshot: MonitorSnapshot; sampledAt: number }
  | { status: 'error'; message: string }

/* ---------------- 工具 ---------------- */

const withSlash = (base: string) => base.replace(/\/+$/, '')

export const RANGES = [
  { id: '1h', label: '1 小时', type: '1m', points: 60 },
  { id: '12h', label: '12 小时', type: '10m', points: 72 },
  { id: '24h', label: '24 小时', type: '20m', points: 72 },
  { id: '1w', label: '一周', type: '120m', points: 84 },
] as const

export type RangeId = (typeof RANGES)[number]['id']

/** PocketBase 的 created 过滤用 UTC 字符串，精确到秒。 */
function pbTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(
    d.getUTCMinutes(),
  )}:${p(d.getUTCSeconds())}`
}

function windowStart(range: RangeId): Date {
  const now = new Date()
  const hours = range === '1h' ? 1 : range === '12h' ? 12 : range === '24h' ? 24 : 24 * 7
  return new Date(now.getTime() - hours * 3600_000)
}

/* ---------------- Beszel ---------------- */

async function beszelLogin(config: MonitorConfig): Promise<string> {
  const res = await fetch(`${withSlash(config.baseUrl)}/api/collections/users/auth-with-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identity: config.identity, password: config.password }),
  })
  if (!res.ok) throw new Error(`Beszel 登录失败（${res.status}）`)
  const json = (await res.json()) as { token: string }
  if (!json.token) throw new Error('Beszel 没有返回 token')
  return json.token
}

type RawStat = { created: string; type?: string; stats: Record<string, unknown> }
type RawSystem = {
  id: string
  name: string
  host?: string
  status?: string
  info?: Record<string, unknown>
}

async function beszelSystems(token: string, base: string): Promise<RawSystem[]> {
  const res = await fetch(`${withSlash(base)}/api/collections/systems/records?perPage=50&sort=name`, {
    headers: { authorization: token },
  })
  if (!res.ok) throw new Error(`Beszel 系统列表 ${res.status}`)
  const json = (await res.json()) as { items?: RawSystem[] }
  return json.items ?? []
}

async function beszelSeries(token: string, base: string, systemId: string, range: RangeId): Promise<RawStat[]> {
  const meta = RANGES.find((r) => r.id === range)!
  const filter = `system="${systemId}" && created>"${pbTime(windowStart(range))}" && type="${meta.type}"`
  const url =
    `${withSlash(base)}/api/collections/system_stats/records` +
    `?perPage=500&sort=created&fields=created,type,stats&filter=${encodeURIComponent(filter)}`
  const res = await fetch(url, { headers: { authorization: token } })
  if (!res.ok) throw new Error(`Beszel 历史数据 ${res.status}`)
  const json = (await res.json()) as { items?: RawStat[] }
  return json.items ?? []
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * Beszel 把指标塞在 stats 里，字段名很紧凑：
 * cpu/mp/dp 是百分比，net 是 [sent, recv] 字节，la 是三元组。
 * 内存字段在 0.21 之后是字节数组，旧记录是 mb 单位，这里都归到百分比。
 */
function extractSeries(stats: RawStat[]) {
  const cpu: MetricPoint[] = []
  const mem: MetricPoint[] = []
  const disk: MetricPoint[] = []
  const net: MetricPoint[] = []
  const load: MetricPoint[] = []
  for (const row of stats) {
    const s = row.stats ?? {}
    const t = new Date(row.created).getTime()
    if (!Number.isFinite(t)) continue
    cpu.push({ t, v: num(s.cpu) })
    mem.push({ t, v: num(s.mp) })
    disk.push({ t, v: num(s.dp ?? s.d) })

    if (Array.isArray(s.la) && typeof s.la[0] === 'number') load.push({ t, v: s.la[0] })

    // 流量：b 是 [发送, 接收] 的当前速率（字节/秒）；旧记录用 ns/nr（MB 累计）
    let rate = 0
    if (Array.isArray(s.b) && s.b.length >= 2) {
      rate = num(s.b[0]) + num(s.b[1])
    } else if (typeof s.ns === 'number' || typeof s.nr === 'number') {
      rate = (num(s.ns) + num(s.nr)) * 1024 * 1024
    }
    net.push({ t, v: rate })
  }
  return { cpu, mem, disk, net, load }
}

/** 数据点太多会让 SVG 变重，按步长抽样并保留峰值的观感。 */
export function downsample(points: MetricPoint[], max = 120): MetricPoint[] {
  if (points.length <= max) return points
  const step = points.length / max
  const out: MetricPoint[] = []
  for (let i = 0; i < max; i += 1) {
    const start = Math.floor(i * step)
    const end = Math.max(start + 1, Math.floor((i + 1) * step))
    const slice = points.slice(start, end)
    const peak = slice.reduce((a, b) => (b.v > a.v ? b : a), slice[0])
    out.push(peak)
  }
  return out
}

async function beszelSnapshot(config: MonitorConfig, range: RangeId): Promise<MonitorSnapshot> {
  const token = await beszelLogin(config)
  const systems = await beszelSystems(token, config.baseUrl)
  const detailed = await Promise.all(
    systems.map(async (sys) => {
      let stats: RawStat[] = []
      try {
        stats = await beszelSeries(token, config.baseUrl, sys.id, range)
      } catch {
        /* 单个系统的历史数据失败不影响其他卡片 */
      }
      const info = sys.info ?? {}
      const series = extractSeries(stats)
      return {
        id: sys.id,
        name: sys.name,
        host: sys.host ?? '',
        status: sys.status ?? 'unknown',
        info: {
          cpu: num(info.cpu),
          mp: num(info.mp),
          dp: num(info.dp),
          la: Array.isArray(info.la) ? (info.la as [number, number, number]) : undefined,
          u: num(info.u),
          c: num(info.c),
          m: typeof info.m === 'string' ? info.m : undefined,
          o: typeof info.o === 'string' ? info.o : undefined,
          v: typeof info.v === 'string' ? info.v : undefined,
          bat: Array.isArray(info.bat) ? (info.bat as [number, string]) : undefined,
          sv: Array.isArray(info.sv) ? (info.sv as [number, number]) : undefined,
        },
        series: {
          cpu: downsample(series.cpu),
          mem: downsample(series.mem),
          disk: downsample(series.disk),
          net: downsample(series.net),
          load: downsample(series.load),
        },
      } satisfies BeszelSystem
    }),
  )
  return { kind: 'beszel', systems: detailed, range }
}

/* ---------------- Coolify ---------------- */

async function coolifySnapshot(config: MonitorConfig): Promise<MonitorSnapshot> {
  const base = withSlash(config.baseUrl)
  const headers = { authorization: `Bearer ${config.token ?? ''}`, accept: 'application/json' }

  const [serverRes, appRes, depRes] = await Promise.all([
    fetch(`${base}/api/v1/servers`, { headers }),
    fetch(`${base}/api/v1/applications`, { headers }),
    fetch(`${base}/api/v1/deployments`, { headers }),
  ])
  if (!serverRes.ok) throw new Error(`Coolify ${serverRes.status}：检查 Token 与地址`)

  const rawServers = (await serverRes.json()) as {
    uuid?: string
    name?: string
    ip?: string
    settings?: { is_reachable?: boolean; is_build_server?: boolean }
  }[]
  const servers: CoolifyServer[] = (Array.isArray(rawServers) ? rawServers : []).map((s) => ({
    uuid: s.uuid ?? s.name ?? '',
    name: s.name ?? '未命名',
    ip: s.ip,
    reachable: Boolean(s.settings?.is_reachable),
    isBuildServer: Boolean(s.settings?.is_build_server),
  }))

  let apps: CoolifyApp[] = []
  if (appRes.ok) {
    const raw = (await appRes.json()) as { uuid?: string; name?: string; status?: string; fqdn?: string; build_pack?: string }[]
    apps = (Array.isArray(raw) ? raw : []).map((a) => ({
      uuid: a.uuid ?? a.name ?? '',
      name: a.name ?? '未命名',
      status: a.status ?? 'unknown',
      fqdn: a.fqdn,
      type: a.build_pack ?? 'application',
    }))
  }

  let deployments: CoolifyDeployment[] = []
  if (depRes.ok) {
    const raw = (await depRes.json()) as { deployments?: Record<string, unknown>[] } | Record<string, unknown>[]
    const list = Array.isArray(raw) ? raw : (raw.deployments ?? [])
    deployments = list.slice(0, 12).map((d) => ({
      uuid: String(d.deployment_uuid ?? d.uuid ?? ''),
      status: String(d.status ?? 'unknown'),
      applicationName: String(d.application_name ?? d.applicationName ?? ''),
      serverName: d.server_name ? String(d.server_name) : undefined,
      commit: d.commit ? String(d.commit) : undefined,
      commitMessage: d.commit_message ? String(d.commit_message) : undefined,
      createdAt: String(d.created_at ?? ''),
    }))
  }

  return { kind: 'coolify', servers, apps, deployments }
}

/* ---------------- 网址探测 ---------------- */

const httpHistory = new Map<string, MetricPoint[]>()

async function httpSnapshot(config: MonitorConfig, proxy: string): Promise<MonitorSnapshot> {
  const url = config.url || config.baseUrl
  const started = performance.now()
  const res = await fetch(proxied(url, proxy))
  const ms = Math.round(performance.now() - started)
  const history = httpHistory.get(url) ?? []
  history.push({ t: Date.now(), v: ms })
  const trimmed = history.slice(-60)
  httpHistory.set(url, trimmed)
  return { kind: 'http', url, ms, status: res.status, history: trimmed }
}

/* ---------------- 对外入口 ---------------- */

export async function probe(config: MonitorConfig, proxy: string, range: RangeId = '24h'): Promise<MonitorState> {
  try {
    let snapshot: MonitorSnapshot
    if (config.kind === 'coolify') snapshot = await coolifySnapshot(config)
    else if (config.kind === 'beszel') snapshot = await beszelSnapshot(config, range)
    else snapshot = await httpSnapshot(config, proxy)
    return { status: 'ok', snapshot, sampledAt: Date.now() }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      status: 'error',
      message: message.includes('Failed to fetch') ? '请求被浏览器拦截，或地址不可达' : message,
    }
  }
}

/** 状态胶囊用的一句话概要。 */
export function summarize(state: MonitorState): { primary: string; secondary: string; tone: 'ok' | 'err' | 'loading' } {
  if (state.status === 'ok') {
    const s = state.snapshot
    if (s.kind === 'beszel') {
      const up = s.systems.filter((x) => x.status === 'up').length
      const cpu = s.systems.filter((x) => x.status === 'up').map((x) => x.info.cpu)
      const avg = cpu.length ? Math.round(cpu.reduce((a, b) => a + b, 0) / cpu.length) : 0
      return { primary: `${up}/${s.systems.length} 在线`, secondary: `CPU ${avg}%`, tone: up === s.systems.length ? 'ok' : 'err' }
    }
    if (s.kind === 'coolify') {
      const up = s.servers.filter((x) => x.reachable).length
      const running = s.apps.filter((a) => a.status.startsWith('running')).length
      return {
        primary: `${up}/${s.servers.length} 在线`,
        secondary: `${running}/${s.apps.length} 应用运行`,
        tone: up === s.servers.length ? 'ok' : 'err',
      }
    }
    return { primary: `${s.ms} ms`, secondary: `HTTP ${s.status}`, tone: s.status < 400 ? 'ok' : 'err' }
  }
  if (state.status === 'error') return { primary: '离线', secondary: state.message, tone: 'err' }
  return { primary: '…', secondary: '', tone: 'loading' }
}
