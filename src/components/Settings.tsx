import { useEffect, useState } from 'react'
import {
  ActionIcon,
  Button,
  Drawer,
  Flexbox,
  Input,
  InputPassword,
  Modal,
  Segmented,
  Select,
  Slider,
  Switch,
  Tag,
  Text,
} from '@lobehub/ui'
import { Plus, Trash2 } from 'lucide-react'
import type { BookmarkGroup, Feed, MonitorConfig, Settings as SettingsShape } from '../lib/types'
import { PROXY_PRESETS } from '../lib/rss'
import { geocode, type GeoPlace } from '../lib/weather'
import { HOT_COLUMNS, fetchSources, type HotSource } from '../lib/hot'
import { uid } from '../lib/store'
import type { ReactNode } from 'react'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

type Props = {
  open: boolean
  settings: SettingsShape
  feeds: Feed[]
  groups: BookmarkGroup[]
  onSettings: (next: SettingsShape) => void
  onFeeds: (next: Feed[]) => void
  onGroups: (next: BookmarkGroup[]) => void
  onClose: () => void
  onReset: () => void
}

export function Settings({
  open,
  settings,
  feeds,
  groups,
  onSettings,
  onFeeds,
  onGroups,
  onClose,
  onReset,
}: Props) {
  const [geoQuery, setGeoQuery] = useState('')
  const [geoResults, setGeoResults] = useState<GeoPlace[]>([])
  const [geoBusy, setGeoBusy] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [hotSources, setHotSources] = useState<HotSource[]>([])
  const [hotSourceError, setHotSourceError] = useState('')

  useEffect(() => {
    if (!open) setResetOpen(false)
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetchSources(settings.hotSource, settings.proxy)
      .then((list) => {
        if (!cancelled) {
          setHotSources(list)
          setHotSourceError('')
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setHotSourceError(err instanceof Error ? err.message : '源列表读取失败')
      })
    return () => {
      cancelled = true
    }
  }, [open, settings.hotSource, settings.proxy])

  const patch = (part: Partial<SettingsShape>) => onSettings({ ...settings, ...part })

  const lookup = async () => {
    if (!geoQuery.trim()) return
    setGeoBusy(true)
    try {
      setGeoResults(await geocode(geoQuery.trim()))
    } catch {
      setGeoResults([])
    } finally {
      setGeoBusy(false)
    }
  }

  const addMonitor = () => {
    const next: MonitorConfig = {
      id: uid(),
      name: '新的监测',
      kind: 'coolify',
      baseUrl: 'https://coolify.example.com',
      token: '',
    }
    patch({ monitor: [...settings.monitor, next] })
  }

  const patchMonitor = (id: string, part: Partial<MonitorConfig>) => {
    patch({ monitor: settings.monitor.map((m) => (m.id === id ? { ...m, ...part } : m)) })
  }

  return (
    <>
      <Drawer open={open} onClose={onClose} title="设置" width={560}>
        <Flexbox direction="vertical" gap={28}>
          <section className="settings-block">
            <Text as="h3">外观</Text>
            <Flexbox direction="vertical" gap={12}>
              <label className="field">
                <span>怎么称呼你</span>
                <Input value={settings.name} placeholder="朋友" onValueChange={(v) => patch({ name: v })} />
              </label>
              <label className="field">
                <span>配色</span>
                <Segmented
                  value={settings.theme}
                  options={[
                    { value: 'light', label: '浅色' },
                    { value: 'dark', label: '深色' },
                  ]}
                  onChange={(v) => patch({ theme: v as 'light' | 'dark' })}
                />
              </label>
              <label className="field">
                <span>显示秒针</span>
                <Switch checked={settings.showSeconds} onChange={(v) => patch({ showSeconds: v })} />
              </label>
              <label className="field">
                <span>书签图标</span>
                <Switch checked={settings.showFavicons} onChange={(v) => patch({ showFavicons: v })} />
              </label>
              <label className="field">
                <span>壁纸</span>
                <Segmented
                  value={settings.wallpaper}
                  options={[
                    { value: 'unsplash', label: 'Unsplash' },
                    { value: 'custom', label: '自定义' },
                    { value: 'off', label: '关闭' },
                  ]}
                  onChange={(v) => patch({ wallpaper: v as SettingsShape['wallpaper'] })}
                />
              </label>
              {settings.wallpaper === 'unsplash' && (
                <Button size="small" onClick={() => patch({ wallpaperIndex: settings.wallpaperIndex + 1 })}>
                  换一张
                </Button>
              )}
              {settings.wallpaper === 'custom' && (
                <Field label="图片地址">
                  <Input
                    value={settings.wallpaperUrl}
                    placeholder="https://images.unsplash.com/..."
                    onValueChange={(v) => patch({ wallpaperUrl: v })}
                  />
                </Field>
              )}
            </Flexbox>
          </section>

          <section className="settings-block">
            <Text as="h3">天气</Text>
            <Flexbox direction="vertical" gap={12}>
              <label className="field">
                <span>城市</span>
                <Input value={settings.city} onValueChange={(v) => patch({ city: v })} />
              </label>
              <Flexbox direction="horizontal" align="center" gap={8}>
                <Input
                  value={geoQuery}
                  placeholder="输入地名重新定位，例如 杭州"
                  onValueChange={setGeoQuery}
                  onPressEnter={() => void lookup()}
                />
                <Button loading={geoBusy} onClick={() => void lookup()}>
                  查询坐标
                </Button>
              </Flexbox>
              {geoResults.map((g) => (
                <Flexbox key={`${g.lat}${g.lon}`} direction="horizontal" align="center" justify="space-between" width="100%">
                  <Text>
                    {g.name} <Text type="secondary">{g.admin}</Text>
                  </Text>
                  <Button
                    size="small"
                    onClick={() => {
                      patch({ city: g.name, lat: g.lat, lon: g.lon })
                      setGeoResults([])
                      setGeoQuery('')
                    }}
                  >
                    用这个
                  </Button>
                </Flexbox>
              ))}
              <Text type="secondary">
                当前坐标 {settings.lat.toFixed(3)}, {settings.lon.toFixed(3)}。天气由 Open-Meteo 提供。
              </Text>
            </Flexbox>
          </section>

          <section className="settings-block">
            <Text as="h3">订阅与取数</Text>
            <Flexbox direction="vertical" gap={12}>
              <Field label="取数代理">
                <Input value={settings.proxy} placeholder="/__proxy?url={url}" onValueChange={(v) => patch({ proxy: v })} />
              </Field>
              <Flexbox direction="horizontal" align="center" gap={8} wrap="wrap">
                {PROXY_PRESETS.map((p) => (
                  <Button key={p.id} size="small" type={settings.proxy === p.template ? 'primary' : 'default'} onClick={() => patch({ proxy: p.template })}>
                    {p.label}
                  </Button>
                ))}
              </Flexbox>
              <Flexbox direction="horizontal" align="center" justify="space-between" width="100%">
                <Text>订阅源 {feeds.length} 个</Text>
                <Button icon={<Plus size={14} />} size="small" onClick={() => onFeeds([...feeds, { id: uid(), title: '新的订阅', url: '', enabled: true }])}>
                  添加
                </Button>
              </Flexbox>
              {feeds.map((f) => (
                <div className="settings-card" key={f.id}>
                  <Field label="名称">
                    <Input value={f.title} onValueChange={(v) => onFeeds(feeds.map((x) => (x.id === f.id ? { ...x, title: v } : x)))} />
                  </Field>
                  <Field label="地址">
                    <Input value={f.url} placeholder="https://example.com/feed.xml" onValueChange={(v) => onFeeds(feeds.map((x) => (x.id === f.id ? { ...x, url: v } : x)))} />
                  </Field>
                  <Field label="启用">
                    <Switch checked={f.enabled !== false} onChange={(v) => onFeeds(feeds.map((x) => (x.id === f.id ? { ...x, enabled: v } : x)))} />
                  </Field>
                  <ActionIcon icon={Trash2} title="删除" onClick={() => onFeeds(feeds.filter((x) => x.id !== f.id))} />
                </div>
              ))}
            </Flexbox>
          </section>

          <section className="settings-block">
            <Flexbox direction="horizontal" align="center" justify="space-between" width="100%">
              <Text as="h3">书签</Text>
              <Button size="small" icon={<Plus size={14} />} onClick={() => onGroups([...groups, { id: uid(), name: '新分组', items: [] }])}>
                分组
              </Button>
            </Flexbox>
            {groups.map((group) => (
              <Flexbox key={group.id} direction="vertical" gap={8} style={{ marginTop: 12 }}>
                <Flexbox direction="horizontal" align="center" gap={8}>
                  <Input value={group.name} onValueChange={(v) => onGroups(groups.map((g) => (g.id === group.id ? { ...g, name: v } : g)))} />
                  <Button
                    size="small"
                    onClick={() =>
                      onGroups(groups.map((g) => (g.id === group.id ? { ...g, items: [...g.items, { id: uid(), name: '新书签', url: 'https://' }] } : g)))
                    }
                  >
                    书签
                  </Button>
                  <ActionIcon icon={Trash2} title="删除分组" onClick={() => onGroups(groups.filter((g) => g.id !== group.id))} />
                </Flexbox>
                {group.items.map((item) => (
                  <Flexbox key={item.id} direction="horizontal" align="center" gap={8}>
                    <Input value={item.name} onValueChange={(v) => onGroups(groups.map((g) => (g.id === group.id ? { ...g, items: g.items.map((i) => (i.id === item.id ? { ...i, name: v } : i)) } : g)))} />
                    <Input value={item.url} onValueChange={(v) => onGroups(groups.map((g) => (g.id === group.id ? { ...g, items: g.items.map((i) => (i.id === item.id ? { ...i, url: v } : i)) } : g)))} />
                    <ActionIcon icon={Trash2} title="删除书签" onClick={() => onGroups(groups.map((g) => (g.id === group.id ? { ...g, items: g.items.filter((i) => i.id !== item.id) } : g)))} />
                  </Flexbox>
                ))}
              </Flexbox>
            ))}
          </section>

          <section className="settings-block">
            <Text as="h3">AI · BYOK</Text>
            <Flexbox direction="vertical" gap={12}>
              <Field label="接口">
                <Input value={settings.ai.baseUrl} placeholder="https://api.openai.com/v1" onValueChange={(v) => patch({ ai: { ...settings.ai, baseUrl: v } })} />
              </Field>
              <Field label="密钥">
                <InputPassword value={settings.ai.apiKey} placeholder="sk-…" onValueChange={(v) => patch({ ai: { ...settings.ai, apiKey: v } })} />
              </Field>
              <Field label="模型">
                <Input value={settings.ai.model} placeholder="gpt-4o-mini" onValueChange={(v) => patch({ ai: { ...settings.ai, model: v } })} />
              </Field>
              <Flexbox direction="vertical" gap={6}>
                <Text type="secondary">温度 {settings.ai.temperature.toFixed(1)}</Text>
                <Slider min={0} max={1.5} step={0.1} value={settings.ai.temperature} onChange={(v) => patch({ ai: { ...settings.ai, temperature: v } })} />
              </Flexbox>
              <Text type="secondary">兼容 OpenAI 的 chat/completions。密钥只存在这台浏览器。</Text>
            </Flexbox>
          </section>

          <section className="settings-block">
            <Flexbox direction="horizontal" align="center" justify="space-between" width="100%">
              <Text as="h3">监控</Text>
              <Button size="small" icon={<Plus size={14} />} onClick={addMonitor}>
                接入
              </Button>
            </Flexbox>
            {settings.monitor.map((m) => (
              <Flexbox key={m.id} direction="vertical" gap={8} style={{ marginTop: 12 }}>
                <Flexbox direction="horizontal" align="center" gap={8}>
                  <Input value={m.name} onValueChange={(v) => patchMonitor(m.id, { name: v })} />
                  <Select
                    value={m.kind}
                    options={[
                      { value: 'coolify', label: 'Coolify' },
                      { value: 'beszel', label: 'Beszel' },
                      { value: 'http', label: '网址探测' },
                    ]}
                    onChange={(v) => patchMonitor(m.id, { kind: v as MonitorConfig['kind'] })}
                  />
                  <ActionIcon icon={Trash2} title="删除" onClick={() => patch({ monitor: settings.monitor.filter((x) => x.id !== m.id) })} />
                </Flexbox>
                {m.kind === 'http' ? (
                  <Input value={m.url ?? ''} placeholder="https://example.com/health" onValueChange={(v) => patchMonitor(m.id, { url: v })} />
                ) : (
                  <>
                    <Input value={m.baseUrl} placeholder="https://monitor.example.com" onValueChange={(v) => patchMonitor(m.id, { baseUrl: v })} />
                    {m.kind === 'coolify' ? (
                      <InputPassword value={m.token ?? ''} placeholder="API Token" onValueChange={(v) => patchMonitor(m.id, { token: v })} />
                    ) : (
                      <>
                        <Input value={m.identity ?? ''} placeholder="邮箱" onValueChange={(v) => patchMonitor(m.id, { identity: v })} />
                        <InputPassword value={m.password ?? ''} placeholder="密码" onValueChange={(v) => patchMonitor(m.id, { password: v })} />
                      </>
                    )}
                  </>
                )}
              </Flexbox>
            ))}
          </section>

          <section className="settings-block">
            <Text as="h3">热榜</Text>
            <Flexbox direction="vertical" gap={12}>
              <Field label="源站">
                <Input value={settings.hotSource} placeholder="https://newshub.shenzjd.com" onValueChange={(v) => patch({ hotSource: v })} />
              </Field>
              <Text type="secondary">勾选要放进热榜页的榜。首页底部只显示第一榜的前四条。数据来自 NewsHub。</Text>
              {hotSourceError && <Text type="danger">{hotSourceError}</Text>}
              {HOT_COLUMNS.map((column) => {
                const group = hotSources.filter((source) => source.column === column.id)
                if (!group.length) return null
                return (
                  <Flexbox key={column.id} direction="vertical" gap={8}>
                    <Text type="secondary">{column.label}</Text>
                    <Flexbox direction="horizontal" align="center" gap={8} wrap="wrap">
                      {group.map((source) => {
                        const on = settings.hotBoards.includes(source.id)
                        return (
                          <Tag
                            key={source.id}
                            color={on ? 'red' : 'gray'}
                            variant={on ? 'filled' : 'outlined'}
                            style={{ cursor: 'pointer' }}
                            onClick={() =>
                              patch({
                                hotBoards: on ? settings.hotBoards.filter((id) => id !== source.id) : [...settings.hotBoards, source.id],
                              })
                            }
                          >
                            {source.name}
                          </Tag>
                        )
                      })}
                    </Flexbox>
                  </Flexbox>
                )
              })}
              {hotSources.some((source) => !source.column) && (
                <Flexbox direction="horizontal" align="center" gap={8} wrap="wrap">
                  {hotSources
                    .filter((source) => !source.column)
                    .map((source) => {
                      const on = settings.hotBoards.includes(source.id)
                      return (
                        <Tag
                          key={source.id}
                          color={on ? 'red' : 'gray'}
                          variant={on ? 'filled' : 'outlined'}
                          style={{ cursor: 'pointer' }}
                          onClick={() =>
                            patch({
                              hotBoards: on ? settings.hotBoards.filter((id) => id !== source.id) : [...settings.hotBoards, source.id],
                            })
                          }
                        >
                          {source.name}
                        </Tag>
                      )
                    })}
                </Flexbox>
              )}
            </Flexbox>
          </section>

          <section className="settings-block">
            <Text as="h3">数据</Text>
            <Flexbox direction="horizontal" align="center" gap={8}>
              <Button danger onClick={() => setResetOpen(true)}>
                恢复默认
              </Button>
              <Button
                onClick={() => {
                  const dump: Record<string, unknown> = {}
                  for (let i = 0; i < localStorage.length; i += 1) {
                    const key = localStorage.key(i)
                    if (key?.startsWith('fp.')) dump[key] = localStorage.getItem(key)
                  }
                  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' })
                  const a = document.createElement('a')
                  a.href = URL.createObjectURL(blob)
                  a.download = `first-page-${new Date().toISOString().slice(0, 10)}.json`
                  a.click()
                  URL.revokeObjectURL(a.href)
                }}
              >
                导出备份
              </Button>
            </Flexbox>
          </section>
        </Flexbox>
      </Drawer>
      <Modal
        open={resetOpen}
        title="恢复默认"
        onCancel={() => setResetOpen(false)}
        onOk={() => {
          setResetOpen(false)
          onReset()
        }}
      >
        会清掉订阅、书签、待办和密钥，确定吗？
      </Modal>
    </>
  )
}
