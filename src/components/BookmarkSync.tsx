import {useState, type ReactNode} from 'react'
import {Button, Modal, toast} from '@lobehub/ui'
import {Check, Copy, DownloadSimple as Download, FileArrowUp as FileUp, SpinnerGap as Loader2, PuzzlePiece as Puzzle, UploadSimple as Upload} from '@phosphor-icons/react'
import {importFromFile} from '../lib/bookmarks'
import {EXTENSION_STORE_URL, EXTENSION_ZIP, importFromBrowser, pushToBrowser, useExtension} from '../lib/browserBookmarks'
import {Group, Row} from './ios'

/**
 * 导入与同步。
 * 装了「搭搭书签桥」扩展：直接读写浏览器里的书签。
 * 没装：给出安装步骤（网页没法替用户装扩展，只能引导），并保留「选导出文件」这条不依赖扩展的路。
 */
export function BookmarkSync({open, onClose}: {open: boolean; onClose: () => void}) {
  const status = useExtension(open)
  const [busy, setBusy] = useState<string | null>(null)

  const run = async (key: string, task: () => Promise<string | null>) => {
    if (busy) return
    setBusy(key)
    try {
      const message = await task()
      if (message) toast.info(message)
    } catch (error) {
      toast.error(error instanceof Error && error.message === 'NO_EXTENSION' ? '扩展没有响应，请确认已在此网站启用' : String(error instanceof Error ? error.message : error))
    } finally {
      setBusy(null)
    }
  }

  const spinner = (key: string, icon: ReactNode) => (busy === key ? <Loader2 size={16} className="spin" /> : icon)

  return (
    <Modal open={open} title="导入与同步书签" footer={null} width={520} onCancel={onClose}>
      <div className="bm-sync">
        <Group>
          <Row
            icon={<Puzzle size={16} />}
            label="浏览器扩展「搭搭书签桥」"
            hint={status === 'ready' ? '已连接，可以直接读写浏览器里的书签' : status === 'checking' ? '正在检测…' : '未连接'}
          >
            {status === 'ready' && <Check size={16} />}
          </Row>
        </Group>

        {status === 'ready' ? (
          <Group footer="同步到浏览器只会在书签栏新建一个「搭搭」文件夹往里添加，不会改动或删除你原有的书签。让搭搭 AI 帮你整理浏览器书签，也是通过这个扩展。">
            <Row
              icon={spinner('in', <Download size={16} />)}
              label="从浏览器读取全部书签"
              hint="并进搭搭书签，重复的网址自动跳过"
              onClick={() => run('in', importFromBrowser)}
            />
            <Row
              icon={spinner('out', <Upload size={16} />)}
              label="同步到浏览器"
              hint="写进书签栏的「搭搭」文件夹，按分组建子文件夹"
              onClick={() => run('out', pushToBrowser)}
            />
          </Group>
        ) : (
          status === 'missing' && (
            <Group
              title="安装扩展（一分钟）"
              footer="浏览器不允许网页替你安装扩展，所以需要你手动点几下。装好后回到这里，会自动检测到。"
            >
              <Row label="1. 获取扩展" hint={EXTENSION_STORE_URL ? '在应用商店里添加' : '下载后解压到任意位置'}>
                {EXTENSION_STORE_URL ? (
                  <Button size="small" type="primary" icon={<Puzzle size={14} />} onClick={() => window.open(EXTENSION_STORE_URL, '_blank', 'noopener')}>
                    去安装
                  </Button>
                ) : (
                  <Button size="small" type="primary" icon={<Download size={14} />} onClick={() => window.open(EXTENSION_ZIP, '_self')}>
                    下载
                  </Button>
                )}
              </Row>
              {!EXTENSION_STORE_URL && (
                <>
                  <Row label="2. 打开扩展管理页" hint="复制地址，粘贴到新标签页打开，并打开右上角「开发者模式」">
                    <Button
                      size="small"
                      icon={<Copy size={14} />}
                      onClick={() => {
                        void navigator.clipboard.writeText('chrome://extensions').then(() => toast.success('已复制 chrome://extensions'))
                      }}
                    >
                      复制
                    </Button>
                  </Row>
                  <Row label="3. 加载扩展" hint="点「加载已解压的扩展程序」，选刚才解压出来的文件夹" />
                </>
              )}
              <Row label={EXTENSION_STORE_URL ? '2. 在此网站启用' : '4. 在此网站启用'} hint="点浏览器工具栏里的「搭搭书签桥」图标，选「在此网站启用」，页面会自动刷新" />
            </Group>
          )
        )}

        <Group title="不装扩展也行" footer="在浏览器的书签管理器里「导出书签」得到 HTML 文件，选它导入；Chrome 的 Bookmarks 文件也可以。">
          <Row
            icon={spinner('file', <FileUp size={16} />)}
            label="选择导出文件导入"
            onClick={() => run('file', importFromFile)}
          />
        </Group>

      </div>
    </Modal>
  )
}
