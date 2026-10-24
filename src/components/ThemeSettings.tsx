import { useState } from 'react'
import { ActionIcon, Flexbox, Modal, Segmented, Text } from '@lobehub/ui'
import { Pencil, Trash2 } from 'lucide-react'
import { useAppSettings } from '../lib/apps'
import { applyTheme, removeTheme, saveTheme, swatch } from '../lib/themes'
import type { ThemeEntry } from '../lib/workspace'
import { applyDecor, currentDecor, DECORS } from '../lib/decor'
import { Group, Row, TextRow } from './ios'

/** 主题的小色块：背景色打底，一道文字色，一个主色点。 */
function Swatch({ theme, mode }: { theme: ThemeEntry; mode: 'light' | 'dark' }) {
  const colors = swatch(theme, mode)
  return (
    <span className="theme-swatch" style={{ background: colors.bg, color: colors.text }}>
      <i style={{ background: colors.text }} />
      <b style={{ background: colors.main }} />
    </span>
  )
}

/**
 * 设置 › 外观：明暗，加上主题库。
 * 主题由搭搭创建（说一句「做一个深海蓝的主题」），这里负责看、切换、改名、删除。
 */
export function AppearanceSettings({ mode, onMode }: { mode: 'light' | 'dark'; onMode: (mode: 'light' | 'dark') => void }) {
  const { workspace, edit } = useAppSettings()
  const decorId = currentDecor(workspace)
  const [editing, setEditing] = useState<ThemeEntry | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [pending, setPending] = useState<ThemeEntry | null>(null)

  const startEdit = (theme: ThemeEntry) => {
    setEditing(theme)
    setName(theme.name)
    setDescription(theme.description)
  }

  return (
    <>
      <Group>
        <Row label="配色">
          <Segmented
            size="small"
            value={mode}
            options={[
              { value: 'light', label: '浅色' },
              { value: 'dark', label: '深色' },
            ]}
            onChange={(value) => onMode(value as 'light' | 'dark')}
          />
        </Row>
      </Group>

      <Group title="首页装饰" footer="给首页铺一层动态背景，来自 React Bits。想要别的效果，或者 Spline 3D 场景，对搭搭说一声就行。">
        {DECORS.map((decor) => (
          <Row key={decor.id} label={decor.name} hint={decor.hint} checked={decor.id === decorId} onClick={() => edit((ws) => applyDecor(ws, decor.id))} />
        ))}
        {decorId === 'custom' && <Row label="自定义" hint="搭搭设置的图层，选上面任意一项会替换它" checked />}
      </Group>

      <Group
        title={`主题 · ${workspace.themes.length} 个`}
        footer="对搭搭说「做一个深海蓝的主题」，它会存成一个新主题放在这里。默认主题不会被改动，随时点回来。"
      >
        {workspace.themes.map((theme) => (
          <Row
            key={theme.id}
            icon={<Swatch theme={theme} mode={mode} />}
            label={theme.name}
            hint={theme.description || (theme.builtin ? '默认' : undefined)}
            checked={theme.id === workspace.theme.active}
            onClick={() => edit((ws) => applyTheme(ws, theme.id).workspace)}
          >
            {!theme.builtin && (
              <Flexbox direction="horizontal" gap={2} onClick={(event) => event.stopPropagation()}>
                <ActionIcon icon={Pencil} title="改名与说明" size="small" onClick={() => startEdit(theme)} />
                <ActionIcon icon={Trash2} title="删除" size="small" onClick={() => setPending(theme)} />
              </Flexbox>
            )}
          </Row>
        ))}
      </Group>

      <Modal
        open={Boolean(editing)}
        title="改名与说明"
        okText="保存"
        cancelText="取消"
        onCancel={() => setEditing(null)}
        onOk={() => {
          if (editing && name.trim()) edit((ws) => saveTheme(ws, { id: editing.id, name, description, activate: false }).workspace)
          setEditing(null)
        }}
      >
        <Group>
          <TextRow label="名称" value={name} onChange={setName} />
          <TextRow label="说明" value={description} onChange={setDescription} placeholder="这个主题是什么气质" />
        </Group>
      </Modal>

      <Modal
        open={Boolean(pending)}
        title="删除主题"
        okText="删除"
        cancelText="取消"
        onCancel={() => setPending(null)}
        onOk={() => {
          if (pending) edit((ws) => removeTheme(ws, pending.id).workspace)
          setPending(null)
        }}
      >
        <Text>删除主题「{pending?.name}」？正在使用的话会回到默认主题。可以用撤销找回。</Text>
      </Modal>
    </>
  )
}
