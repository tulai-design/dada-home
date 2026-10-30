import {Button, Modal, Text} from '@lobehub/ui'
import {approveExtensionNetworkRequest, rejectExtensionNetworkRequest, useExtensionNetworkRequests} from '../lib/extensionNetwork'

/** 浏览器的主机权限必须由明确点击申请，模型/自动刷新不能替用户授权。 */
export function ExtensionNetworkPrompt() {
  const pending = useExtensionNetworkRequests()[0]
  return (
    <Modal open={Boolean(pending)} title="连接外部服务" footer={pending ? <>
      <Button onClick={() => rejectExtensionNetworkRequest(pending.id)}>暂不连接</Button>
      <Button type="primary" loading={pending.status === 'requesting'} onClick={() => void approveExtensionNetworkRequest(pending.id)}>允许连接</Button>
    </> : null} onCancel={() => {if (pending) rejectExtensionNetworkRequest(pending.id)}}>
      {pending && <div className="extension-network-copy">
        <Text>搭搭需要连接 <strong>{pending.origin}</strong>，用于你启用的组件或服务。</Text>
        <Text type="secondary">允许后会记住此来源。你可以在浏览器的扩展管理中撤销；扩展用它连接服务，不会因此自动读取你打开的网页。</Text>
        {pending.error && <Text type="danger" role="alert">{pending.error}</Text>}
      </div>}
    </Modal>
  )
}
