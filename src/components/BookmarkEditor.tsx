import {useEffect, useState} from 'react'
import {Button, Flexbox, Input, Modal, Text, toast} from '@lobehub/ui'
import {Trash2} from 'lucide-react'
import {DEFAULT_GROUP, addBookmarks, getBookmarks, removeBookmarks, removeGroup, renameGroup, setBookmarks, updateBookmark} from '../lib/bookmarks'
import type {Bookmark, BookmarkGroup} from '../lib/types'

/**
 * 书签的两个小弹窗。书签组件和设置页共用，改动直接写进共享数据。
 * 一个书签只有三个字段：地址（必填）、名称（可空，默认用域名）、分组。
 */

type Editing = {bookmark: Bookmark; group: string} | 'new' | null

export function BookmarkEditor({editing, groups, defaultGroup, onClose}: {editing: Editing; groups: BookmarkGroup[]; defaultGroup?: string; onClose: () => void}) {
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [group, setGroup] = useState('')

  useEffect(() => {
    if (!editing) return
    if (editing === 'new') {
      setUrl('')
      setName('')
      setGroup(defaultGroup ?? groups[0]?.name ?? DEFAULT_GROUP)
    } else {
      setUrl(editing.bookmark.url)
      setName(editing.bookmark.name)
      setGroup(editing.group)
    }
    // 只在打开时初始化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  const isNew = editing === 'new'

  const save = () => {
    if (!editing) return
    if (editing === 'new') {
      const result = addBookmarks(getBookmarks(), [{url, name, group}])
      if (!result.added) return void toast.error(result.skipped[0] ?? '没有添加')
      setBookmarks(result.groups)
    } else {
      const result = updateBookmark(getBookmarks(), editing.bookmark.id, {url, name, group})
      if (result.error) return void toast.error(result.error)
      setBookmarks(result.groups)
    }
    onClose()
  }

  const remove = () => {
    if (editing && editing !== 'new') setBookmarks(removeBookmarks(getBookmarks(), {ids: [editing.bookmark.id]}).groups)
    onClose()
  }

  return (
    <Modal open={Boolean(editing)} title={isNew ? '添加书签' : '编辑书签'} okText="保存" cancelText="取消" onCancel={onClose} onOk={save} width={420}>
      <Flexbox gap={12} className="bm-form">
        <label className="bm-field">
          <Text type="secondary" fontSize={12}>
            地址
          </Text>
          <Input autoFocus value={url} placeholder="粘贴网址，例如 github.com" onValueChange={setUrl} onPressEnter={save} />
        </label>
        <label className="bm-field">
          <Text type="secondary" fontSize={12}>
            名称（可不填，默认用域名）
          </Text>
          <Input value={name} onValueChange={setName} onPressEnter={save} />
        </label>
        <div className="bm-field">
          <Text type="secondary" fontSize={12}>
            分组（点一个，或直接输入新名字）
          </Text>
          <Input value={group} onValueChange={setGroup} onPressEnter={save} />
          {groups.length > 0 && (
            <Flexbox horizontal wrap="wrap" gap={4} className="bm-chips">
              {groups.map((g) => (
                <Button key={g.id} size="small" type={g.name === group ? 'primary' : 'default'} onClick={() => setGroup(g.name)}>
                  {g.name}
                </Button>
              ))}
            </Flexbox>
          )}
        </div>
        {!isNew && (
          <Button danger icon={<Trash2 size={14} />} onClick={remove}>
            删除这个书签
          </Button>
        )}
      </Flexbox>
    </Modal>
  )
}

export function GroupEditor({group, onClose}: {group: BookmarkGroup | null; onClose: () => void}) {
  const [name, setName] = useState('')
  useEffect(() => setName(group?.name ?? ''), [group])

  const save = () => {
    if (!group) return
    const result = renameGroup(getBookmarks(), group.id, name)
    if (result.error) return void toast.error(result.error)
    setBookmarks(result.groups)
    onClose()
  }

  return (
    <Modal open={Boolean(group)} title="编辑分组" okText="保存" cancelText="取消" onCancel={onClose} onOk={save} width={380}>
      <Flexbox gap={12}>
        <Input autoFocus value={name} onValueChange={setName} onPressEnter={save} />
        <Button
          danger
          icon={<Trash2 size={14} />}
          onClick={() => {
            if (group) setBookmarks(removeGroup(getBookmarks(), group.id))
            onClose()
          }}
        >
          删除分组{group?.items.length ? `（含 ${group.items.length} 个书签）` : ''}
        </Button>
      </Flexbox>
    </Modal>
  )
}
