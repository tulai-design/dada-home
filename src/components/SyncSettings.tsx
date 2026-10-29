import {useEffect, useRef, useState, type ReactNode} from 'react'
import {A, Button, Input, InputPassword, Switch, Text} from '@lobehub/ui'
import {ArrowsClockwise, PlugsConnected} from '@phosphor-icons/react'
import {COLLECTION_LABELS} from '../lib/incrementalClient'
import {serviceConflicts, type ServiceConflict} from '../lib/syncService'
import {
  readSyncConfig,
  resolveServiceConflict,
  syncConfigProblem,
  syncNow,
  testConnection,
  useSyncConfigVersion,
  useSyncStatus,
  writeSyncConfig,
  type Backend,
  type SyncConfig,
} from '../lib/sync'
import {Group, Row} from './ios'

const BACKENDS: {id: Backend; name: string; note: string}[] = [
  {id: 'webdav', name: 'WebDAV', note: '同步配置、业务数据和已结束的聊天。服务需开放跨域访问。'},
  {id: 'gist', name: 'GitHub Gist', note: '只同步配置；需要有 gist 权限的令牌。'},
  {id: 'http', name: '自建 HTTP', note: '同步配置、业务数据和已结束的聊天；接口提供 GET / PUT。'},
  {id: 'sync', name: '自建同步服务', note: '只填一把同步密钥。密钥在同步服务的管理页生成，同一服务的各端填同一把。'},
]
const preview = (value: unknown) => {
  const text = JSON.stringify(value, (key, item) => ['apiKey', 'token', 'password', 'secret', 'keys'].includes(key) ? '••••' : item) ?? '已删除'
  return text.length > 120 ? `${text.slice(0, 120)}…` : text
}

type ConnectionTest = {kind: 'idle' | 'loading' | 'ok' | 'error'; text?: string; retryAt?: number}
const ago = (at?: number) => {
  if (!at) return ''
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return new Date(at).toLocaleDateString()
}
const bytes = (value: number) => value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KiB` : `${(value / (1024 * 1024)).toFixed(1)} MiB`

/** 只为本页补输入名称，仍使用宿主设置行和 Lobe 输入控件。 */
function Field({label, value, onChange, placeholder, secret, stack, hint}: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string; secret?: boolean; stack?: boolean; hint?: ReactNode
}) {
  const Control = secret ? InputPassword : Input
  return <Row label={label} hint={hint} stack={stack}>
    <Control aria-label={label} className="ios-input" variant="borderless" value={value} placeholder={placeholder} onValueChange={onChange} />
  </Row>
}

/** 当前后端决定范围；测试只读取，轮换原口令只存在本次表单内存。 */
export function SyncSettings() {
  const configVersion = useSyncConfigVersion()
  const config = readSyncConfig()
  const status = useSyncStatus()
  const [test, setTest] = useState<ConnectionTest>({kind: 'idle'})
  const [showOriginalPassphrase, setShowOriginalPassphrase] = useState(false)
  const [originalPassphrase, setOriginalPassphrase] = useState('')
  const [configError, setConfigError] = useState('')
  const [now, setNow] = useState(Date.now)
  const [conflicts, setConflicts] = useState<ServiceConflict[]>([])
  const currentConfigVersion = useRef(configVersion)
  currentConfigVersion.current = configVersion
  const problem = syncConfigProblem(config)
  const destination = config.backend === 'sync' ? `sync:${config.sync.key}` : `${config.backend}:${config.backend === 'gist' ? config.gist.id : config.backend === 'webdav' ? config.webdav.url : config.http.url}`
  const configurationOnly = config.backend === 'gist'
  const retryAt = Math.max(status.retryAt ?? 0, test.retryAt ?? 0)
  const coolingDown = retryAt > now
  const syncing = status.phase === 'syncing'
  const blocked = Boolean(problem) || coolingDown || syncing || test.kind === 'loading'

  useEffect(() => {
    setTest({kind: 'idle'})
    setOriginalPassphrase('')
    setShowOriginalPassphrase(false)
  }, [destination])
  useEffect(() => {
    if (config.backend !== 'sync' || problem) {setConflicts([]); return}
    let current = true
    void serviceConflicts(config.sync.key).then(items => {if (current) setConflicts(items)}, () => {if (current) setConflicts([])})
    return () => {current = false}
  }, [config.backend, config.sync.key, problem, status.at])
  useEffect(() => {
    if (retryAt <= Date.now()) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [retryAt])

  const set = (patch: Partial<SyncConfig>) => {
    try {
      writeSyncConfig({...config, ...patch})
      setTest({kind: 'idle'})
      setConfigError('')
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : String(error))
    }
  }
  const options = originalPassphrase ? {decryptPassphrase: originalPassphrase} : undefined
  const runTest = async () => {
    const version = configVersion
    setTest({kind: 'loading'})
    try {
      const text = await testConnection(config, options)
      if (currentConfigVersion.current === version) setTest({kind: 'ok', text})
    } catch (error) {
      if (currentConfigVersion.current !== version) return
      const nextRetryAt = error && typeof error === 'object' && 'retryAt' in error && typeof error.retryAt === 'number' ? error.retryAt : undefined
      setTest({kind: 'error', text: error instanceof Error ? error.message : String(error), retryAt: nextRetryAt})
      setNow(Date.now())
    }
  }
  const sync = async () => {
    try {
      await syncNow(options)
      setOriginalPassphrase('')
      setShowOriginalPassphrase(false)
    } catch {
      // 同步错误由持久的同步状态展示，保留本次原口令供修正后重试。
    } finally {setNow(Date.now())}
  }
  const protection = configurationOnly || status.protection === 'unprotected'
    ? '无并发写入保护；避免多台设备同时同步。'
    : status.protection === 'conditional'
      ? '支持条件写入；远端版本改变时会重新检查。'
      : '读取后按服务返回的 ETag 判断并发写入保护。'

  return (
    <>
      <Group title="存到哪里" footer={config.backend === 'sync' ? '打开同步服务的管理页，用管理员令牌登录。每个已授权的应用是一个服务，生成一把密钥；一台服务器可以同时给多个应用使用。' : '每次读取和写入整份快照，按记录合并。组件的一份数据容器是一个记录，容器里的待办或日程不会逐项合并。'}>
        {BACKENDS.map((backend) => <Row key={backend.id} label={backend.name} hint={backend.note} checked={config.backend === backend.id} onClick={() => set({backend: backend.id})} />)}
      </Group>

      <Group title="同步范围" footer={config.backend === 'sync' ? '上传前已经加密。自动同步只上传本机变更；手动同步会拉取，拉取后重新加载即可看到新数据。' : protection}>
        <Row label={configurationOnly ? '仅配置' : '完整业务数据'} hint={configurationOnly
          ? '页面与主题、应用源码和设置、宿主偏好、当前 AI 性格。聊天、画像、累积记忆和业务状态留在本机。'
          : '页面与主题、应用配置、组件与应用业务状态、画像和记忆、已结束的聊天。网络授权和运行状态留在本机。'} />
      </Group>

      <Group title="连接信息" footer="连接信息只保存在本机。测试连接只读取远端，不上传或应用数据。">
        {config.backend === 'webdav' && <>
          <Field label="目录或文件地址" stack value={config.webdav.url} placeholder="https://dav.example.com/dada/" onChange={value => set({webdav: {...config.webdav, url: value}})} />
          <Field label="用户名" value={config.webdav.user} onChange={value => set({webdav: {...config.webdav, user: value}})} />
          <Field label="密码" secret value={config.webdav.pass} placeholder="应用专用密码" onChange={value => set({webdav: {...config.webdav, pass: value}})} />
          <Field label="代理模板" stack hint="可选；用 {url} 代表目标地址" value={config.webdav.proxy} placeholder="https://proxy.example.com/?url={url}" onChange={value => set({webdav: {...config.webdav, proxy: value}})} />
        </>}
        {config.backend === 'gist' && <>
          <Field label="访问令牌" secret value={config.gist.token} placeholder="ghp_… / github_pat_…" onChange={value => set({gist: {...config.gist, token: value}})} />
          <Field label="Gist ID" stack hint="留空首次同步时新建；其他设备填写同一个 ID" value={config.gist.id} placeholder="自动创建" onChange={value => set({gist: {...config.gist, id: value}})} />
          <Row stack><A href="https://github.com/settings/tokens/new?scopes=gist&description=dada-sync" target="_blank" rel="noreferrer noopener">生成有 gist 权限的令牌</A></Row>
        </>}
        {config.backend === 'http' && <>
          <Field label="地址" stack value={config.http.url} placeholder="https://example.com/dada-sync-v2.json" onChange={value => set({http: {...config.http, url: value}})} />
          <Field label="令牌" secret value={config.http.token} placeholder="可选，作为 Bearer 发送" onChange={value => set({http: {...config.http, token: value}})} />
          <Field label="代理模板" stack hint="可选；用 {url} 代表目标地址" value={config.http.proxy} placeholder="https://proxy.example.com/?url={url}" onChange={value => set({http: {...config.http, proxy: value}})} />
        </>}
        {config.backend === 'sync' && <Field label="同步密钥" secret stack value={config.sync.key} placeholder="tulai1.…" hint="从管理页复制，或由管理页直接打开本页导入。同一服务的各端填同一把。" onChange={value => set({sync: {key: value.trim()}})} />}
        <Row label="连接测试">
          <Button size="small" icon={<PlugsConnected size={16} />} loading={test.kind === 'loading'} disabled={blocked} onClick={() => void runTest()}>测试连接</Button>
        </Row>
        {test.kind !== 'idle' && test.kind !== 'loading' && <Row stack><span role={test.kind === 'error' ? 'alert' : 'status'} style={{overflowWrap: 'anywhere'}}><Text type={test.kind === 'error' ? 'danger' : 'success'}>{test.text}</Text></span></Row>}
      </Group>

      {config.backend !== 'sync' && <Group title="安全" footer="已知密钥字段默认排除；应用源码和自由文本里的手写密钥需要自行检查。关闭同步密钥只清理最新快照，不能擦除存储方的历史版本。">
        <Field label="加密口令" secret stack value={config.passphrase} placeholder="留空不加密" hint="所有设备使用相同口令；此口令保存在本机" onChange={value => set({passphrase: value, secrets: value ? config.secrets : false})} />
        <Row label="同步密钥" hint={config.passphrase ? '连同已知 API Key 等加密同步' : '设置加密口令后可开启'}>
          <Switch aria-label="同步密钥" checked={config.secrets && Boolean(config.passphrase)} disabled={!config.passphrase} onChange={enabled => set({secrets: enabled})} />
        </Row>
        <Row label="更换或移除口令" hint="先填写新的加密口令，再提供原云端口令；移除时将新口令留空。">
          <Switch aria-label="更换或移除口令" checked={showOriginalPassphrase} onChange={enabled => {setShowOriginalPassphrase(enabled); if (!enabled) setOriginalPassphrase('')}} />
        </Row>
        {showOriginalPassphrase && <Field label="原云端口令" secret stack value={originalPassphrase} hint="只用于本次读取，不保存；同步成功后清空" onChange={setOriginalPassphrase} />}
      </Group>}

      <Group title="同步" footer={config.backend === 'sync' ? '自动同步会在启动、恢复联网和定时检查时上传本机变更。手动同步会同时拉取；拉取后暂停保存，重新加载即可继续编辑。' : '自动同步会在启动、恢复联网和定时检查时上传本机变更。手动同步会同时拉取；拉取后暂停保存，重新加载即可继续编辑。首次连接时同名记录以远端为基线，本机独有记录仍会上传。同步为快照合并，不是实时协作。'}>
        <Row label="自动同步"><Switch aria-label="自动同步" checked={config.auto} onChange={enabled => set({auto: enabled})} /></Row>
        <Row label={syncing ? '同步中…' : status.phase === 'ok' ? `${ago(status.at)}同步完成` : '手动同步'} hint={problem || undefined}>
          <Button size="small" icon={<ArrowsClockwise size={16} />} loading={syncing} disabled={blocked || status.needsReload} onClick={() => void sync()}>立即同步</Button>
        </Row>
        <div aria-live="polite">
          {configError && <Row stack><Text type="danger">{configError}</Text></Row>}
          {status.message && <Row stack><span role={status.phase === 'error' ? 'alert' : 'status'} style={{overflowWrap: 'anywhere'}}><Text type={status.phase === 'error' ? 'danger' : undefined}>{status.message}</Text></span></Row>}
          {(status.downloadedBytes !== undefined || status.uploadedBytes !== undefined) && <Row label="本次正文收发" hint={`下载 ${bytes(status.downloadedBytes ?? 0)} · 上传 ${bytes(status.uploadedBytes ?? 0)}`} />}
          {coolingDown && <Row label="等待限流解除" hint={`${Math.ceil((retryAt - now) / 1000)} 秒后可重试（${new Date(retryAt).toLocaleTimeString()}）`} />}
          {status.needsReload && <Row label="新数据已保存" hint="重新加载后显示拉取的数据。"><Button size="small" onClick={() => location.reload()}>重新加载</Button></Row>}
        </div>
      </Group>

      {config.backend === 'sync' && conflicts.length > 0 && (
        <Group title="需要选择" footer="两端都改过同一条。选定之前两边都还在。">
          {conflicts.map(item => (
            <Row key={`${item.ref.collection}:${item.ref.key}`} stack label={COLLECTION_LABELS[item.ref.collection]} hint={item.remoteReady ? preview(item.remoteValue) : '另一端的内容还要再同步一次才能看到。'}>
              <span className="ios-actions">
                <Button size="small" disabled={blocked} onClick={() => void resolveServiceConflict(item.ref, item.version, 'local').then(() => setConfigError(''), error => setConfigError(error instanceof Error ? error.message : String(error))).finally(() => setNow(Date.now()))}>保留本机</Button>
                <Button size="small" disabled={blocked || !item.remoteReady} onClick={() => void resolveServiceConflict(item.ref, item.version, 'remote').then(() => setConfigError(''), error => setConfigError(error instanceof Error ? error.message : String(error))).finally(() => setNow(Date.now()))}>采用另一端</Button>
              </span>
            </Row>
          ))}
        </Group>
      )}
    </>
  )
}
