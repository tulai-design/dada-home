import {useCallback, useEffect, useState} from 'react'
import {Button, Switch, Text, TextArea} from '@lobehub/ui'
import {ArrowsClockwise, Link, PlugsConnected} from '@phosphor-icons/react'
import type {Device} from '@tulai-design/sync-sdk'
import {
  COLLECTION_LABELS, acceptInvite, applyCollections, bindIncremental, createInvite, createSpaceKeyring, detachIncremental, incrementalConfigProblem,
  isBound, listConflicts, listDevices, preflight, readIncrementalConfig, resolveConflict, revokeDevice, runIncremental, useIncrementalConfigVersion,
  useIncrementalStatus, writeIncrementalConfig, type ConflictItem, type IncrementalConfig,
} from '../lib/incrementalClient'
import {SYNC_COLLECTIONS, type SyncCollection} from '../lib/incrementalRows'
import {TextRow, Group, Row} from './ios'

type Note = {kind: 'ok' | 'error'; text: string} | null
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error)
const preview = (value: unknown) => {const text = JSON.stringify(value) ?? '已删除'; return text.length > 160 ? text.slice(0, 160) + '…' : text}

function Notice({note}: {note: Note}) {
  if (!note) return null
  return <Row stack><span role={note.kind === 'error' ? 'alert' : 'status'} style={{overflowWrap: 'anywhere'}}><Text type={note.kind === 'error' ? 'danger' : 'success'}>{note.text}</Text></span></Row>
}

/** 自建增量同步：连接、密钥、配对、范围、冲突和设备。所有操作都不会自动清空本地数据或改写远端。 */
export function IncrementalSyncSettings() {
  const version = useIncrementalConfigVersion()
  const config = readIncrementalConfig()
  const status = useIncrementalStatus()
  const [bound, setBound] = useState<boolean | null>(null)
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState<Note>(null)
  const [conflicts, setConflicts] = useState<ConflictItem[]>([])
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [invitePass, setInvitePass] = useState(''), [inviteDevice, setInviteDevice] = useState(''), [inviteText, setInviteText] = useState('')
  const [joinText, setJoinText] = useState(''), [joinPass, setJoinPass] = useState('')
  const problem = incrementalConfigProblem(config)

  const refresh = useCallback(async () => {
    const isBoundNow = await isBound().catch(() => false)
    setBound(isBoundNow)
    setConflicts(isBoundNow && !incrementalConfigProblem(readIncrementalConfig()) ? await listConflicts().catch(() => []) : [])
  }, [])
  useEffect(() => {void refresh()}, [refresh, version, status.at])

  const set = (patch: Partial<IncrementalConfig>) => {writeIncrementalConfig({...config, ...patch}); setNote(null)}
  const act = async (name: string, work: () => Promise<string | void>) => {
    setBusy(name); setNote(null)
    try {const text = await work(); if (text) setNote({kind: 'ok', text})} catch (error) {setNote({kind: 'error', text: messageOf(error)})} finally {setBusy(''); void refresh()}
  }
  const toggle = (name: SyncCollection, on: boolean) => act('scope', async () => {
    const next = SYNC_COLLECTIONS.filter(item => item === name ? on : config.collections.includes(item))
    if (!next.length) throw new Error('至少保留一类同步内容；要整体停用请解除绑定。')
    await applyCollections(next)
    return on ? `已开启「${COLLECTION_LABELS[name]}」，下次同步会补齐关闭期间的远端记录。` : `已关闭「${COLLECTION_LABELS[name]}」。本机与远端已有的数据都保留，只是不再发送或应用。`
  })
  const syncing = status.phase === 'syncing' || busy === 'sync'

  return (
    <>
      <Group title="服务" footer="服务地址与令牌只保存在本机。测试连接只读取服务能力，不上传也不应用数据。">
        <TextRow label="服务地址" stack value={config.endpoint} placeholder="https://sync.example.com" onChange={endpoint => set({endpoint})} />
        <TextRow label="访问令牌" secret value={config.token} placeholder="管理员令牌或设备令牌" onChange={token => set({token})} />
        <TextRow label="应用标识" value={config.appId} onChange={appId => set({appId})} />
        <TextRow label="空间标识" value={config.spaceId} onChange={spaceId => set({spaceId})} />
        <TextRow label="本机设备标识" value={config.deviceId} onChange={deviceId => set({deviceId})} />
        <Row label="连接测试">
          <Button size="small" icon={<PlugsConnected size={16} />} loading={busy === 'test'} disabled={Boolean(busy)} onClick={() => void act('test', () => preflight(config))}>测试连接</Button>
        </Row>
        <Notice note={note} />
      </Group>

      <Group title="空间密钥" footer="同步内容在本机加密后才上传，服务只看到密文。密钥丢失后无法恢复，请保留另一台已配对的设备或自行备份邀请。">
        <Row label={config.keyring ? '已保存空间密钥' : '还没有空间密钥'} hint={config.keyring ? `密钥版本 ${config.keyring.keys.length} 把；换设备请用下面的邀请。` : '第一台设备新建；其他设备请用配对邀请加入。'}>
          {!config.keyring && <Button size="small" disabled={Boolean(busy)} onClick={() => set({keyring: createSpaceKeyring(config)})}>新建密钥</Button>}
        </Row>
      </Group>

      <Group title="添加另一台设备" footer="邀请包含一次性配对码和用口令加密的空间密钥。口令请通过另一条渠道告诉对方，邀请到期后失效。">
        <TextRow label="新设备标识" value={inviteDevice} placeholder="例如 phone-1" onChange={setInviteDevice} />
        <TextRow label="邀请口令" secret value={invitePass} placeholder="至少 8 个字符" onChange={setInvitePass} />
        <Row label="生成邀请" hint="有效期 24 小时">
          <Button size="small" icon={<Link size={16} />} loading={busy === 'invite'} disabled={Boolean(busy) || Boolean(problem)} onClick={() => void act('invite', async () => {
            setInviteText(await createInvite(invitePass, inviteDevice.trim(), 24)); setInvitePass('')
            return '邀请已生成，复制下面的内容到新设备。'
          })}>生成</Button>
        </Row>
        {inviteText && <Row stack><TextArea aria-label="配对邀请" readOnly value={inviteText} autoSize={{minRows: 3, maxRows: 6}} onFocus={event => event.currentTarget.select()} /></Row>}
      </Group>

      <Group title="用邀请加入" footer="在新设备上粘贴邀请并输入口令。口令正确才会兑换配对码，随后本机生成自己的访问令牌。">
        <Row stack><TextArea aria-label="粘贴配对邀请" value={joinText} placeholder="粘贴邀请内容" autoSize={{minRows: 3, maxRows: 6}} onChange={event => setJoinText(event.target.value)} /></Row>
        <TextRow label="邀请口令" secret value={joinPass} onChange={setJoinPass} />
        <Row label="加入空间">
          <Button size="small" loading={busy === 'join'} disabled={Boolean(busy) || !joinText.trim()} onClick={() => void act('join', async () => {
            await acceptInvite(joinText.trim(), joinPass); setJoinText(''); setJoinPass('')
            return '已加入。下一步点「绑定本机」，再手动同步一次拉取远端数据。'
          })}>加入</Button>
        </Row>
      </Group>

      <Group title="同步内容" footer="关闭某一类只是不再发送或应用，本机和远端已有数据都保留；重新开启后下次同步会补齐。">
        {SYNC_COLLECTIONS.map(name => (
          <Row key={name} label={COLLECTION_LABELS[name]}>
            <Switch aria-label={COLLECTION_LABELS[name]} checked={config.collections.includes(name)} disabled={Boolean(busy)} onChange={on => void toggle(name, on)} />
          </Row>
        ))}
      </Group>

      <Group title="同步" footer="自动同步在启动、恢复联网和定时检查时只上传本机变更；拉取远端数据请手动同步，拉取后需要重新加载才能继续编辑。与快照同步同时开启时，自动快照同步会暂停。">
        {problem ? <Row label="尚未就绪" hint={problem} /> : bound === false
          ? <Row label="绑定本机" hint="绑定后才开始记录本机修改；已有数据会作为待同步草稿。">
            <Button size="small" loading={busy === 'bind'} disabled={Boolean(busy)} onClick={() => void act('bind', async () => {await bindIncremental(); return '已绑定。可以立即同步。'})}>绑定</Button>
          </Row>
          : <>
            <Row label="自动同步（只上传）"><Switch aria-label="自动同步" checked={config.auto} onChange={auto => set({auto})} /></Row>
            <Row label={syncing ? '同步中…' : status.phase === 'ok' && status.at ? `${new Date(status.at).toLocaleTimeString()} 同步完成` : '手动同步'}
              hint={status.pushed !== undefined ? `上传 ${status.pushed} 项 · 拉取 ${status.pulled ?? 0} 项` : undefined}>
              <Button size="small" icon={<ArrowsClockwise size={16} />} loading={syncing} disabled={Boolean(busy) || status.needsReload} onClick={() => void act('sync', async () => {await runIncremental({pull: true})})}>立即同步</Button>
            </Row>
          </>}
        <div aria-live="polite">
          {status.message && <Row stack><span role={status.phase === 'error' ? 'alert' : 'status'} style={{overflowWrap: 'anywhere'}}><Text type={status.phase === 'error' ? 'danger' : undefined}>{status.message}</Text></span></Row>}
          {status.needsReload && <Row label="新数据已保存" hint="重新加载后显示拉取的数据。"><Button size="small" onClick={() => location.reload()}>重新加载</Button></Row>}
        </div>
      </Group>

      {conflicts.length > 0 && (
        <Group title="冲突" footer="选择本机版本会在下次同步时覆盖远端；选择远端版本会替换本机内容。选定前两边都不会丢失。">
          {conflicts.map(item => (
            <Row key={`${item.ref.collection}:${item.ref.key}`} stack label={`${COLLECTION_LABELS[item.ref.collection]} · ${item.ref.key.slice(0, 24)}`}
              hint={item.remoteReady ? `远端版本：${preview(item.remoteValue)}` : '远端版本还未下载，请先手动同步。'}>
              <span style={{display: 'flex', gap: 8}}>
                <Button size="small" disabled={Boolean(busy)} onClick={() => void act('resolve', async () => {await resolveConflict(item, 'local'); return '已选择本机版本。'})}>保留本机</Button>
                <Button size="small" disabled={Boolean(busy) || !item.remoteReady} onClick={() => void act('resolve', async () => {await resolveConflict(item, 'remote'); return '已选择远端版本，重新加载后生效。'})}>采用远端</Button>
              </span>
            </Row>
          ))}
        </Group>
      )}

      <Group title="已配对设备" footer="撤销只让该设备无法再访问服务，不能让它忘记已下载的数据和密钥；需要时请另建空间密钥。">
        <Row label="设备列表">
          <Button size="small" loading={busy === 'devices'} disabled={Boolean(busy) || !config.token || !config.endpoint} onClick={() => void act('devices', async () => {setDevices(await listDevices())})}>刷新</Button>
        </Row>
        {devices?.map(device => (
          <Row key={device.id} label={device.id + (device.id === config.deviceId ? '（本机）' : '')}
            hint={device.revokedAt ? '已撤销' : device.kind === 'administrator' ? '管理员' : device.expiresAt ? `到期 ${new Date(device.expiresAt).toLocaleString()}` : '长期有效'}>
            {!device.revokedAt && device.kind !== 'administrator' && device.id !== config.deviceId && (
              <Button size="small" danger disabled={Boolean(busy)} onClick={() => void act('revoke', async () => {await revokeDevice(device.id); setDevices(await listDevices()); return `已撤销 ${device.id}。`})}>撤销</Button>
            )}
          </Row>
        ))}
      </Group>

      {bound && (
        <Group title="解除绑定" footer="只清除本机的同步队列和游标，不删除本机数据，也不改动远端。之后重新绑定会把本机数据当作待同步草稿。">
          <Row label="解除本机绑定" danger>
            <Button size="small" danger loading={busy === 'detach'} disabled={Boolean(busy)} onClick={() => void act('detach', async () => {await detachIncremental(); return '已解除绑定。'})}>解除</Button>
          </Row>
        </Group>
      )}
    </>
  )
}
