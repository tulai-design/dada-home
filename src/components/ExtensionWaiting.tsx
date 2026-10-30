import {useState} from 'react'
import {Button, Text} from '@lobehub/ui'
import {extensionApi} from '../lib/platform'

export function ExtensionWaiting() {
  const [error, setError] = useState('')
  const [opening, setOpening] = useState(false)
  return (
    <main className="extension-waiting" aria-label="搭搭已在另一个标签页打开">
      <img src={`${import.meta.env.BASE_URL}brand/dada-ip.webp`} width={112} height={112} alt="搭搭" />
      <h1>搭搭已经在等你了</h1>
      <p>回到已打开的搭搭，继续使用你的主页和小工具。</p>
      <Button type="primary" loading={opening} onClick={async () => {
        setOpening(true)
        setError('')
        try {
          const reply = await extensionApi()?.runtime.sendMessage({op: 'focus-workspace'}) as {ok?: boolean; error?: string} | undefined
          if (!reply?.ok) throw new Error(reply?.error || '请从浏览器标签栏切回已打开的搭搭。')
        } catch (cause) {setError(cause instanceof Error ? cause.message : String(cause))}
        finally {setOpening(false)}
      }}>回到搭搭</Button>
      <Text type="secondary">关闭原来的搭搭后，这个标签页会自动接续，读取已保存的数据。</Text>
      {error && <Text type="danger" role="alert">{error}</Text>}
    </main>
  )
}
