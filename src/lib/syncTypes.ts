/** 快照同步的连接与传输合同；不包含旧协议迁移分支。 */
export type Backend = 'webdav' | 'gist' | 'http'
export type SyncScope = 'configuration' | 'full'

export type SyncConfig = {
  backend: Backend
  webdav: {url: string; user: string; pass: string; proxy: string}
  gist: {token: string; id: string}
  http: {url: string; token: string; proxy: string}
  secrets: boolean
  passphrase: string
  auto: boolean
  device: string
}

export type RemoteVersion =
  | {kind: 'missing'}
  | {kind: 'etag'; etag: string}
  | {kind: 'unprotected'}

export type RemoteRead = {text: string | null; version: RemoteVersion; bytes: number}
export type RemoteWrite = {createdGistId?: string; bytes: number}
export type SyncRemote = {
  read(): Promise<RemoteRead>
  write(text: string, expected: RemoteVersion): Promise<RemoteWrite>
}

export const FILE = 'dada-sync-v2.json'
/** 实际传输文本的 UTF-8 处理预算，不是供应商存储配额。 */
export const MAX_SYNC_BYTES = 64 * 1024 * 1024
export const MAX_GIST_BYTES = 8 * 1024 * 1024
