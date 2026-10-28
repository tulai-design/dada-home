import type {CommitBatch, CommitReceipt, UploadCheckpoint} from '@tulai-design/sync-sdk'
import type {ApplicationData} from './applicationDataSchema'

export type ApplicationSyncBindingIdentity = {endpoint: string; appId: string; spaceId: string; deviceId: string; keyFingerprint: string}
export type ApplicationSyncBinding = ApplicationSyncBindingIdentity & {epoch: string; cursor?: string}
export type ApplicationSyncPrepared = {request: CommitBatch; ciphertext?: Blob}
export type ApplicationSyncIntent = {
  applicationKey: string; value: ApplicationData | null; generation: number; operationId: string; baseRevision: number | null
  prepared?: ApplicationSyncPrepared; checkpoint?: UploadCheckpoint
}
export type ApplicationSyncIncoming = {applicationKey: string; entityId: string; revision: number; value: ApplicationData | null; deviceId: string; operationId: string}
export type ApplicationSyncConflictVersion = {localGeneration: number; remoteRevision: number}
export type ApplicationSyncConflict = {
  localGeneration: number; localValue: ApplicationData | null; remoteRevision: number | null
  remoteReady: boolean; remoteValue?: ApplicationData | null; operationId?: string; receipt?: CommitReceipt
}
export type ApplicationSyncRecordState = {
  k: string; type: 'record'; epoch: string; applicationKey: string; generation: number; remoteRevision: number | null
  draft?: {generation: number; value: ApplicationData | null}; inFlight?: ApplicationSyncIntent; conflict?: ApplicationSyncConflict
}
