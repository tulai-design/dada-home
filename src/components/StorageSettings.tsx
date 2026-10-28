import {useCallback, useEffect, useState} from 'react'
import {Button, Text} from '@lobehub/ui'
import {Download} from '@phosphor-icons/react'
import {cleanupConversations, exportChatFile, measureUsage, previewCleanup, type CleanupPreview, type Usage} from '../lib/storageUsage'
import {Group, Row} from './ios'

const bytes = (value: number) => value < 1024 ? `${value} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 ** 2).toFixed(1)} MB`
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error)
const RANGES = [{days: 30, label: '30 天前'}, {days: 90, label: '90 天前'}, {days: 180, label: '半年前'}, {days: 365, label: '一年前'}]

/** 容量面板与聊天清理：先看范围、先导出，再二次确认删除。 */
export function StorageSettings() {
  const [usage, setUsage] = useState<Usage | null>(null)
  const [days, setDays] = useState(180)
  const [preview, setPreview] = useState<CleanupPreview | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(''), [note, setNote] = useState<{error: boolean; text: string} | null>(null)

  const load = useCallback(async () => {
    try {setUsage(await measureUsage())} catch (error) {setNote({error: true, text: messageOf(error)})}
  }, [])
  useEffect(() => {void load()}, [load])

  const act = async (name: string, work: () => Promise<string | void>) => {
    setBusy(name); setNote(null)
    try {const text = await work(); if (text) setNote({error: false, text})} catch (error) {setNote({error: true, text: messageOf(error)})} finally {setBusy('')}
  }
  const choose = (next: number) => {setDays(next); setPreview(null); setConfirming(false)}

  return (
    <>
      <Group title="占用情况" footer="按本机记录的文本大小估算，用来判断各类数据的相对体量，不等于浏览器实际占用的磁盘空间。">
        {usage ? <>
          {usage.items.map(item => <Row key={item.id} label={item.label} hint={`${item.count} 条`}>{bytes(item.bytes)}</Row>)}
          <Row label="合计">{bytes(usage.total)}</Row>
          {usage.quota !== undefined && <Row label="浏览器配额" hint="本站点可用空间的上限，由浏览器决定。">{bytes(usage.browserUsage ?? 0)} / {bytes(usage.quota)}</Row>}
        </> : <Row label="正在统计…" />}
        <Row label="重新统计"><Button size="small" disabled={Boolean(busy)} onClick={() => void load()}>刷新</Button></Row>
      </Group>

      <Group title="清理旧聊天" footer="清理会连同工具明细一起删除。已开启聊天同步时，删除也会同步到远端和其他设备。先导出再删除可以保留一份副本。">
        {RANGES.map(range => <Row key={range.days} label={`${range.label}最后更新`} checked={days === range.days} onClick={() => choose(range.days)} />)}
        <Row label="预览范围"><Button size="small" loading={busy === 'preview'} disabled={Boolean(busy)} onClick={() => void act('preview', async () => {setPreview(await previewCleanup(days)); setConfirming(false)})}>预览</Button></Row>
        {preview && <>
          <Row label={preview.convIds.length ? `将删除 ${preview.convIds.length} 个会话` : '没有符合条件的会话'} hint={preview.convIds.length ? `${preview.turns} 轮对话，约 ${bytes(preview.bytes)}` : undefined} />
          {preview.convIds.length > 0 && <>
            <Row label="导出全部聊天" icon={<Download size={16} />}><Button size="small" loading={busy === 'export'} disabled={Boolean(busy)} onClick={() => void act('export', async () => {await exportChatFile(); return '已导出聊天记录。'})}>导出</Button></Row>
            <Row label={confirming ? '再次确认：删除后无法恢复' : '删除这些会话'} danger>
              {confirming
                ? <Button size="small" danger loading={busy === 'cleanup'} disabled={Boolean(busy)} onClick={() => void act('cleanup', async () => {
                  const result = await cleanupConversations(preview.convIds)
                  setConfirming(false); setPreview(null); await load()
                  if (result.failed) throw new Error(`已删除 ${result.deleted} 个，${result.failed} 个失败：${result.firstError}`)
                  return `已删除 ${result.deleted} 个会话。`
                })}>确认删除</Button>
                : <Button size="small" danger disabled={Boolean(busy)} onClick={() => setConfirming(true)}>删除</Button>}
            </Row>
          </>}
        </>}
        {note && <Row stack><span role={note.error ? 'alert' : 'status'} style={{overflowWrap: 'anywhere'}}><Text type={note.error ? 'danger' : 'success'}>{note.text}</Text></span></Row>}
      </Group>
    </>
  )
}
