import {useState} from 'react'
import {A, Switch, Text} from '@lobehub/ui'
import {ArrowsClockwise, PlugsConnected} from '@phosphor-icons/react'
import {
  readSyncConfig,
  syncConfigProblem,
  syncNow,
  testConnection,
  useSyncConfigVersion,
  useSyncStatus,
  writeSyncConfig,
  type Backend,
  type SyncConfig,
} from '../lib/sync'
import {Group, Row, TextRow} from './ios'

const BACKENDS: {id: Backend; name: string; note: string}[] = [
  {id: 'webdav', name: 'WebDAV', note: '坚果云、Nextcloud、群晖、Alist 等。服务器要开放跨域（CORS），或在下面填一个代理。'},
  {id: 'gist', name: 'GitHub Gist', note: '最省事：只要一个带 gist 权限的令牌，数据放在你账号下的私密 Gist 里，浏览器可直连。'},
  {id: 'http', name: '自建 HTTP', note: '你自己的接口：GET 读取、PUT 写入整份 JSON，可选 Bearer 令牌。'},
]

const ago = (at?: number) => {
  if (!at) return ''
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return new Date(at).toLocaleDateString()
}

/** 跨设备同步的设置：选后端、填连接信息、测试、立即同步。 */
export function SyncSettings() {
  useSyncConfigVersion()
  const config = readSyncConfig()
  const status = useSyncStatus()
  const [test, setTest] = useState<{kind: 'idle' | 'loading' | 'ok' | 'error'; text?: string}>({kind: 'idle'})
  const problem = syncConfigProblem(config)

  const set = (patch: Partial<SyncConfig>) => {
    writeSyncConfig({...config, ...patch})
    setTest({kind: 'idle'})
  }

  const runTest = async () => {
    setTest({kind: 'loading'})
    try {
      setTest({kind: 'ok', text: await testConnection(config)})
    } catch (error) {
      setTest({kind: 'error', text: error instanceof Error ? error.message : String(error)})
    }
  }

  const sync = async () => {
    try {
      await syncNow()
    } catch {
      /* 错误已经记在状态里 */
    }
  }

  const statusText =
    status.phase === 'syncing'
      ? '同步中…'
      : status.phase === 'ok'
        ? `${ago(status.at)} · ${status.message ?? ''}`
        : status.phase === 'error'
          ? undefined
          : '还没同步过'

  return (
    <>
      <Group
        title="存到哪里"
        footer="数据整份存在你自己的服务里，没有搭搭的服务器。每台设备各自拉取、按记录合并：同一条待办、日程、对话两边都改了，以最后修改的为准；只在一边有的，两边都会有。"
      >
        {BACKENDS.map((b) => (
          <Row key={b.id} label={b.name} hint={b.note} checked={config.backend === b.id} onClick={() => set({backend: b.id})} />
        ))}
      </Group>

      <Group title="连接信息">
        {config.backend === 'webdav' && (
          <>
            <TextRow label="目录或文件地址" stack value={config.webdav.url} placeholder="https://dav.example.com/dada/" onChange={(v) => set({webdav: {...config.webdav, url: v}})} />
            <TextRow label="用户名" value={config.webdav.user} onChange={(v) => set({webdav: {...config.webdav, user: v}})} />
            <TextRow label="密码" secret value={config.webdav.pass} placeholder="应用专用密码更安全" onChange={(v) => set({webdav: {...config.webdav, pass: v}})} />
            <TextRow label="代理模板" stack hint="可选；用 {url} 代表目标地址" value={config.webdav.proxy} placeholder="https://proxy.example.com/?url={url}" onChange={(v) => set({webdav: {...config.webdav, proxy: v}})} />
          </>
        )}
        {config.backend === 'gist' && (
          <>
            <TextRow label="访问令牌" secret value={config.gist.token} placeholder="ghp_… / github_pat_…" onChange={(v) => set({gist: {...config.gist, token: v}})} />
            <TextRow label="Gist ID" stack hint="留空会在首次同步时自动新建；换设备时填同一个" value={config.gist.id} placeholder="自动创建" onChange={(v) => set({gist: {...config.gist, id: v}})} />
          </>
        )}
        {config.backend === 'http' && (
          <>
            <TextRow label="地址" stack value={config.http.url} placeholder="https://example.com/dada-sync.json" onChange={(v) => set({http: {...config.http, url: v}})} />
            <TextRow label="令牌" secret value={config.http.token} placeholder="可选，作为 Bearer 发送" onChange={(v) => set({http: {...config.http, token: v}})} />
            <TextRow label="代理模板" stack hint="可选；用 {url} 代表目标地址" value={config.http.proxy} placeholder="https://proxy.example.com/?url={url}" onChange={(v) => set({http: {...config.http, proxy: v}})} />
          </>
        )}
        {config.backend === 'gist' && (
          <Row>
            <A href="https://github.com/settings/tokens/new?scopes=gist&description=dada-sync" target="_blank" rel="noreferrer noopener">
              去生成一个只有 gist 权限的令牌
            </A>
          </Row>
        )}
        <Row label="测试连接" icon={<PlugsConnected size={16} />} chevron onClick={problem || test.kind === 'loading' ? undefined : () => void runTest()}>
          {test.kind === 'loading' ? '测试中…' : problem || undefined}
        </Row>
        {test.kind === 'ok' && (
          <Row>
            <Text type="success">{test.text}</Text>
          </Row>
        )}
        {test.kind === 'error' && (
          <Row>
            <Text type="danger">{test.text}</Text>
          </Row>
        )}
      </Group>

      <Group
        title="安全"
        footer="设了口令后，数据在离开浏览器前就加密，存储方看到的是一团乱码；所有设备要用同一个口令，忘了就找不回。API Key、监控 Token 和密码、.ics 订阅地址默认不同步，只同步其余内容；打开「同步密钥」后才一起传，并且必须设口令。"
      >
        <TextRow label="加密口令" secret value={config.passphrase} placeholder="留空则不加密" onChange={(v) => set({passphrase: v, secrets: v ? config.secrets : false})} />
        <Row label="同步密钥" hint={config.passphrase ? '连同 API Key 等一起加密同步' : '先设置加密口令'}>
          <Switch checked={config.secrets && Boolean(config.passphrase)} disabled={!config.passphrase} onChange={(on) => set({secrets: on})} />
        </Row>
      </Group>

      <Group title="同步" footer="自动同步：启动时、切到后台时完整同步一次，页面开着时每几分钟把本机改动传上去。别的设备的新内容在下次启动或切回后台时拉下来，并自动刷新页面。第一次在一台已有数据的新设备上开启时，云端的内容会优先。">
        <Row label="自动同步">
          <Switch checked={config.auto} onChange={(on) => set({auto: on})} />
        </Row>
        <Row label="立即同步" icon={<ArrowsClockwise size={16} />} chevron onClick={problem || status.phase === 'syncing' ? undefined : () => void sync()}>
          {statusText}
        </Row>
        {status.phase === 'error' && (
          <Row>
            <Text type="danger">{status.message}</Text>
          </Row>
        )}
      </Group>
    </>
  )
}
