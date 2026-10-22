import { useMemo, useState } from 'react'
import {
  RANGES,
  summarize,
  type BeszelSystem,
  type CoolifyApp,
  type MetricPoint,
  type MonitorSnapshot,
  type MonitorState,
  type RangeId,
} from '../lib/monitor'
import type { MonitorConfig } from '../lib/types'
import { relativeTime } from '../lib/date'
import { ActionIcon, Button, Drawer, Empty, Flexbox, Segmented } from '@lobehub/ui'
import { ExternalLink, RefreshCw } from 'lucide-react'

/* ---------------- 迷你折线图 ---------------- */

/**
 * 面积折线：用 SVG 手绘，坐标按数据范围自适应。
 * 只画路径和一条基线，保持 anyway.fm 那种轻薄的观感。
 */
export function Spark({
  points,
  color,
  height = 46,
  max,
  fill = true,
  label,
}: {
  points: MetricPoint[]
  color: string
  height?: number
  max?: number
  fill?: boolean
  label?: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const id = useMemo(() => `sp${Math.random().toString(36).slice(2, 8)}`, [])

  const geometry = useMemo(() => {
    if (!points.length) return null
    const w = 100
    const h = height
    const top = Math.max(max ?? 0, ...points.map((p) => p.v), 1)
    const t0 = points[0].t
    const t1 = points[points.length - 1].t
    const span = Math.max(1, t1 - t0)
    const coords = points.map((p) => {
      const x = ((p.t - t0) / span) * w
      const y = h - (p.v / top) * (h - 3) - 1
      return { x, y, ...p }
    })
    const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(' ')
    const area = `${line} L${w},${h} L0,${h} Z`
    return { coords, line, area, top, w, h }
  }, [points, height, max])

  if (!geometry) {
    return <div style={{ height, display: 'grid', placeItems: 'center', color: 'var(--text4)', fontSize: 11 }}>暂无数据</div>
  }

  const hovered = hover !== null ? geometry.coords[hover] : null

  return (
    <div style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${geometry.w} ${geometry.h}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height, display: 'block', overflow: 'visible' }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0.01" />
          </linearGradient>
        </defs>
        <line x1="0" y1={geometry.h - 0.5} x2={geometry.w} y2={geometry.h - 0.5} stroke="var(--border)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
        {fill && <path d={geometry.area} fill={`url(#${id})`} />}
        <path
          d={geometry.line}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {hovered && (
          <>
            <line
              x1={hovered.x}
              y1="0"
              x2={hovered.x}
              y2={geometry.h}
              stroke={color}
              strokeWidth="0.75"
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
              opacity="0.5"
            />
            <circle cx={hovered.x} cy={hovered.y} r="2.2" fill={color} vectorEffect="non-scaling-stroke" />
          </>
        )}
        {geometry.coords.map((c, i) => (
          <rect
            key={i}
            x={(c.x - geometry.w / geometry.coords.length / 2).toFixed(2)}
            y="0"
            width={(geometry.w / geometry.coords.length).toFixed(2)}
            height={geometry.h}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>
      {hovered && (
        <div
          style={{
            position: 'absolute',
            left: `${(hovered.x / geometry.w) * 100}%`,
            top: -2,
            transform: 'translate(-50%, -100%)',
            background: 'var(--text)',
            color: 'var(--bg)',
            fontSize: 10,
            fontFamily: 'var(--font-mono)',
            padding: '2px 6px',
            borderRadius: 3,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        >
          {label ? `${hovered.v.toFixed(1)}${label}` : hovered.v.toFixed(1)}
          <span style={{ opacity: 0.6, marginLeft: 5 }}>
            {new Date(hovered.t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      )}
    </div>
  )
}

/** 横条：用于磁盘、内存这类瞬时占比。 */
export function Meter({ value, color, max = 100 }: { value: number; color: string; max?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div style={{ height: 5, borderRadius: 99, background: 'var(--bg3)', overflow: 'hidden' }}>
      <div
        style={{
          width: `${pct}%`,
          height: '100%',
          borderRadius: 99,
          background: color,
          transition: 'width .5s var(--curve)',
        }}
      />
    </div>
  )
}

/* ---------------- 单个 Beszel 节点 ---------------- */

const COLORS = {
  cpu: 'var(--c-blue)',
  mem: 'var(--c-violet)',
  disk: 'var(--c-amber)',
  net: 'var(--c-green)',
  load: 'var(--c-orange)',
}

function bytesRate(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '—'
  if (v < 1024) return `${v.toFixed(0)} B/s`
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB/s`
  if (v < 1024 * 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB/s`
  return `${(v / 1024 / 1024 / 1024).toFixed(2)} GB/s`
}

export function BeszelNode({ sys }: { sys: BeszelSystem }) {
  const [tab, setTab] = useState<'cpu' | 'mem' | 'net' | 'load'>('cpu')
  const series = sys.series[tab]
  const latest = series.length ? series[series.length - 1].v : 0
  const peak = series.length ? Math.max(...series.map((p) => p.v)) : 0
  const uptimeDays = sys.info.u ? Math.floor(sys.info.u / 86400) : 0
  const up = sys.status === 'up'

  const tabs = [
    { id: 'cpu' as const, label: 'CPU', value: `${sys.info.cpu.toFixed(0)}%` },
    { id: 'mem' as const, label: '内存', value: `${sys.info.mp.toFixed(0)}%` },
    { id: 'net' as const, label: '流量', value: bytesRate(latest) },
    { id: 'load' as const, label: '负载', value: sys.info.la?.[0]?.toFixed(2) ?? latest.toFixed(2) },
  ]

  return (
    <div className="node">
      <div className="node-head">
        <span className={`dot ${up ? 'ok' : 'err'}`} />
        <span className="node-name">{sys.name}</span>
        <span className="node-host">{sys.host || sys.info.o || ''}</span>
        {sys.info.bat && (
          <span className="node-chip" title="电池">
            电池 {sys.info.bat[0].toFixed(0)}%
          </span>
        )}
        {sys.info.sv && (
          <span className="node-chip" title="systemd 服务">
            服务 {sys.info.sv[0] - sys.info.sv[1]}/{sys.info.sv[0]}
          </span>
        )}
        <span className="node-chip">运行 {uptimeDays} 天</span>
      </div>

      <Segmented
        block
        value={tab}
        onChange={(v) => setTab(v as typeof tab)}
        options={tabs.map((t) => ({ value: t.id, label: `${t.label} ${t.value}` }))}
      />

      <div className="node-chart">
        <Spark
          points={series}
          color={COLORS[tab]}
          height={72}
          max={tab === 'cpu' || tab === 'mem' ? 100 : undefined}
          label={tab === 'net' ? '' : '%'}
        />
        <div className="node-chart-foot">
          <span>峰值 {tab === 'net' ? bytesRate(peak) : `${peak.toFixed(1)}${tab === 'load' ? '' : '%'}`}</span>
          <span>{series.length} 个采样点</span>
        </div>
      </div>

      <div className="node-bars">
        <div>
          <span className="bar-label">
            磁盘 <b>{sys.info.dp.toFixed(0)}%</b>
          </span>
          <Meter value={sys.info.dp} color={sys.info.dp > 88 ? 'var(--main)' : COLORS.disk} />
        </div>
        <div>
          <span className="bar-label">
            内存 <b>{sys.info.mp.toFixed(0)}%</b>
          </span>
          <Meter value={sys.info.mp} color={COLORS.mem} />
        </div>
      </div>
    </div>
  )
}

/* ---------------- Coolify 面板 ---------------- */

const DEPLOY_TONE: Record<string, string> = {
  finished: 'var(--c-green)',
  running: 'var(--c-blue)',
  'in_progress': 'var(--c-blue)',
  queued: 'var(--c-amber)',
  failed: 'var(--main)',
  cancelled: 'var(--text3)',
}

const DEPLOY_LABEL: Record<string, string> = {
  finished: '成功',
  running: '进行中',
  in_progress: '进行中',
  queued: '排队中',
  failed: '失败',
  cancelled: '已取消',
}

export function CoolifyPanel({ snapshot }: { snapshot: Extract<MonitorSnapshot, { kind: 'coolify' }> }) {
  const running = snapshot.apps.filter((a) => a.status.startsWith('running'))
  const stopped = snapshot.apps.filter((a) => !a.status.startsWith('running'))
  const reachable = snapshot.servers.filter((s) => s.reachable).length

  return (
    <>
      <div className="stat-row">
        <div className="stat" style={{ ['--tone' as string]: 'var(--c-green)' }}>
          <span className="k">服务器在线</span>
          <span className="v">
            {reachable}
            <small>/{snapshot.servers.length}</small>
          </span>
        </div>
        <div className="stat" style={{ ['--tone' as string]: 'var(--c-blue)' }}>
          <span className="k">应用运行中</span>
          <span className="v">
            {running.length}
            <small>/{snapshot.apps.length}</small>
          </span>
        </div>
        <div className="stat" style={{ ['--tone' as string]: 'var(--c-amber)' }}>
          <span className="k">已停止</span>
          <span className="v">{stopped.length}</span>
        </div>
        <div className="stat" style={{ ['--tone' as string]: 'var(--c-violet)' }}>
          <span className="k">最近部署</span>
          <span className="v" style={{ fontSize: 15 }}>
            {snapshot.deployments[0] ? DEPLOY_LABEL[snapshot.deployments[0].status] ?? snapshot.deployments[0].status : '—'}
          </span>
        </div>
      </div>

      <h4 className="panel-title">
        服务器 <span>{snapshot.servers.length}</span>
      </h4>
      <div className="pill-grid">
        {snapshot.servers.map((s) => (
          <div key={s.uuid} className="pill-item">
            <span className={`dot ${s.reachable ? 'ok' : 'err'}`} />
            <span className="nm">{s.name}</span>
            <span className="sub">{s.ip ?? ''}</span>
            {s.isBuildServer && <span className="node-chip">构建机</span>}
          </div>
        ))}
        {!snapshot.servers.length && <p className="empty">没有可访问的服务器，检查 Token 权限。</p>}
      </div>

      <h4 className="panel-title">
        应用 <span>{snapshot.apps.length}</span>
      </h4>
      <div className="app-list">
        {snapshot.apps.map((a) => (
          <AppRow key={a.uuid} app={a} />
        ))}
        {!snapshot.apps.length && <p className="empty">没有应用，或 Token 没有读权限。</p>}
      </div>

      <h4 className="panel-title">
        部署记录 <span>{snapshot.deployments.length}</span>
      </h4>
      <ul className="deploy-list">
        {snapshot.deployments.map((d) => (
          <li key={d.uuid}>
            <span className="deploy-dot" style={{ background: DEPLOY_TONE[d.status] ?? 'var(--text3)' }} />
            <span className="deploy-name">{d.applicationName || '未命名'}</span>
            <span className="deploy-msg">{d.commitMessage || d.commit?.slice(0, 7) || ''}</span>
            <span className="deploy-status" style={{ color: DEPLOY_TONE[d.status] ?? 'var(--text3)' }}>
              {DEPLOY_LABEL[d.status] ?? d.status}
            </span>
            <span className="deploy-time">{d.createdAt ? relativeTime(d.createdAt) : ''}</span>
          </li>
        ))}
        {!snapshot.deployments.length && <p className="empty">暂无部署记录。</p>}
      </ul>
    </>
  )
}

function AppRow({ app }: { app: CoolifyApp }) {
  const running = app.status.startsWith('running')
  return (
    <div className="app-row">
      <span className={`dot ${running ? 'ok' : 'err'}`} />
      <span className="nm">{app.name}</span>
      <span className="tag">{app.type}</span>
      {app.fqdn && (
        <a className="fqdn" href={`https://${app.fqdn.split(',')[0].replace(/^https?:\/\//, '')}`} target="_blank" rel="noreferrer noopener">
          {app.fqdn.split(',')[0].replace(/^https?:\/\//, '')}
          <ExternalLink size={12} />
        </a>
      )}
      <span className="status-text" style={{ color: running ? 'var(--c-green)' : 'var(--text3)' }}>
        {running ? '运行中' : app.status}
      </span>
    </div>
  )
}

/* ---------------- 监控抽屉 ---------------- */

export function MonitorDrawer({
  configs,
  states,
  range,
  onRange,
  onClose,
  onRefresh,
  onSettings,
}: {
  configs: MonitorConfig[]
  states: Record<string, MonitorState>
  range: RangeId
  onRange: (r: RangeId) => void
  onClose: () => void
  onRefresh: () => void
  onSettings: () => void
}) {
  const [tab, setTab] = useState<string>('__all')
  const shown = configs.filter((c) => tab === '__all' || c.id === tab)

  return (
    <Drawer
      open
      width={940}
      title="服务监控"
      onClose={onClose}
      extra={
        <Flexbox direction="horizontal" align="center" gap={8}>
          <Segmented size="small" value={range} options={RANGES.map((r) => ({ value: r.id, label: r.label }))} onChange={(v) => onRange(v as RangeId)} />
          <Button size="small" onClick={onSettings}>
            管理
          </Button>
          <ActionIcon icon={RefreshCw} title="刷新" onClick={onRefresh} />
        </Flexbox>
      }
    >
      <Flexbox direction="vertical" gap={12}>
        {configs.length > 1 && (
          <Segmented
            size="small"
            value={tab}
            onChange={setTab}
            options={[{ value: '__all', label: '全部' }, ...configs.map((c) => ({ value: c.id, label: c.name }))]}
          />
        )}
        {!configs.length && (
          <Empty
            title="还没有接入监控"
            description="支持 Beszel 的历史曲线，以及 Coolify 的服务器、应用和部署记录。"
            action={
              <Button type="primary" onClick={onSettings}>
                去接入
              </Button>
            }
          />
        )}

          {shown.map((config) => {
            const state = states[config.id] ?? { status: 'idle' as const }
            if (state.status === 'ok' && state.snapshot.kind === 'beszel') {
              return (
                <section key={config.id} className="monitor-section">
                  <div className="section-bar">
                    <h3>{config.name}</h3>
                    <span className="src-tag" style={{ ['--tag' as string]: 'var(--c-teal)' }}>
                      BESZEL
                    </span>
                    <span className="section-meta">
                      {summarize(state).primary} · {relativeTime(state.sampledAt)}更新
                    </span>
                  </div>
                  {state.snapshot.systems.map((sys) => (
                    <BeszelNode key={sys.id} sys={sys} />
                  ))}
                  {!state.snapshot.systems.length && <p className="empty">Beszel 里还没有主机。</p>}
                </section>
              )
            }
            if (state.status === 'ok' && state.snapshot.kind === 'coolify') {
              return (
                <section key={config.id} className="monitor-section">
                  <div className="section-bar">
                    <h3>{config.name}</h3>
                    <span className="src-tag" style={{ ['--tag' as string]: 'var(--c-blue)' }}>
                      COOLIFY
                    </span>
                    <span className="section-meta">{relativeTime(state.sampledAt)}更新</span>
                  </div>
                  <CoolifyPanel snapshot={state.snapshot} />
                </section>
              )
            }
            if (state.status === 'ok' && state.snapshot.kind === 'http') {
              return (
                <section key={config.id} className="monitor-section">
                  <div className="section-bar">
                    <h3>{config.name}</h3>
                    <span className="src-tag" style={{ ['--tag' as string]: 'var(--c-amber)' }}>
                      HTTP
                    </span>
                    <span className="section-meta">{state.snapshot.url}</span>
                  </div>
                  <div className="stat-row">
                    <div className="stat" style={{ ['--tone' as string]: 'var(--c-green)' }}>
                      <span className="k">响应时间</span>
                      <span className="v">
                        {state.snapshot.ms}
                        <small>ms</small>
                      </span>
                    </div>
                    <div className="stat" style={{ ['--tone' as string]: 'var(--c-blue)' }}>
                      <span className="k">状态码</span>
                      <span className="v">{state.snapshot.status}</span>
                    </div>
                  </div>
                  <Spark points={state.snapshot.history} color="var(--c-amber)" height={90} label=" ms" />
                </section>
              )
            }
            if (state.status === 'error') {
              return (
                <section key={config.id} className="monitor-section">
                  <div className="section-bar">
                    <h3>{config.name}</h3>
                    <span className="src-tag" style={{ ['--tag' as string]: 'var(--main)' }}>
                      失败
                    </span>
                  </div>
                  <p className="empty err">{state.message}</p>
                </section>
              )
            }
            return (
              <section key={config.id} className="monitor-section">
                <div className="section-bar">
                  <h3>{config.name}</h3>
                  <span className="section-meta">读取中…</span>
                </div>
              </section>
            )
          })}
      </Flexbox>
    </Drawer>
  )
}
