import type { ExportMeta } from './exportMetadata'
import type { PublishStatusFile, CutPublishEntry, PlotState } from '../main/services/publishStatus'

export type UploadAction = 'skip' | 'upload' | 'retry'

export interface CutUploadPlan {
  cutId: string
  action: UploadAction
  reason: string
}

export interface UploadPlan {
  cuts: CutUploadPlan[]
  readyToPublish: boolean
  blockReason: string | null
}

export function isStale(entry: CutPublishEntry, currentHash: string): boolean {
  if (entry.state !== 'uploaded') return false
  return entry.fileHash !== currentHash
}

function planCut(entry: CutPublishEntry, exportHash: string | null): CutUploadPlan {
  if (!exportHash) {
    return { cutId: entry.cutId, action: 'upload', reason: 'No export hash available' }
  }

  if (entry.state === 'uploaded' && entry.fileHash === exportHash) {
    const hasFullMeta =
      entry.cid !== null &&
      entry.url !== null &&
      entry.mimeType !== null &&
      entry.sizeBytes !== null
    if (hasFullMeta) {
      return { cutId: entry.cutId, action: 'skip', reason: 'Already uploaded and hash matches' }
    }
    return { cutId: entry.cutId, action: 'retry', reason: 'Incomplete upload metadata' }
  }

  if (entry.state === 'uploaded' && entry.fileHash !== exportHash) {
    return { cutId: entry.cutId, action: 'retry', reason: 'Stale: export hash changed' }
  }

  if (entry.state === 'failed') {
    return {
      cutId: entry.cutId,
      action: 'retry',
      reason: `Previous failure: ${entry.error ?? 'unknown'}`
    }
  }

  return { cutId: entry.cutId, action: 'upload', reason: 'Pending upload' }
}

export function buildUploadPlan(status: PublishStatusFile, exportMetas: ExportMeta[]): UploadPlan {
  const hashMap = new Map(exportMetas.map((m) => [m.cutId, m.hash]))

  const cuts = status.cuts.map((entry) => planCut(entry, hashMap.get(entry.cutId) ?? null))

  const needsWork = cuts.filter((c) => c.action !== 'skip')
  const readyToPublish = needsWork.length === 0
  const blockReason = readyToPublish
    ? null
    : `${needsWork.length} cut(s) need upload/retry: ${needsWork.map((c) => c.cutId).join(', ')}`

  return { cuts, readyToPublish, blockReason }
}

export function getCutsToUpload(plan: UploadPlan): string[] {
  return plan.cuts.filter((c) => c.action === 'upload' || c.action === 'retry').map((c) => c.cutId)
}

export function canTransitionToPublishing(status: PublishStatusFile): boolean {
  if (status.plotState === 'published') return false
  const allUploaded = status.cuts.every((c) => c.state === 'uploaded')
  const allHaveMetadata = status.cuts.every(
    (c) =>
      c.cid !== null &&
      c.url !== null &&
      c.fileHash !== null &&
      c.mimeType !== null &&
      c.sizeBytes !== null
  )
  return allUploaded && allHaveMetadata
}

export function canPublish(
  status: PublishStatusFile,
  exportMetas: ExportMeta[]
): { allowed: boolean; reason: string | null } {
  if (!canTransitionToPublishing(status)) {
    const pending = status.cuts.filter((c) => c.state !== 'uploaded')
    if (pending.length > 0) {
      return {
        allowed: false,
        reason: `${pending.length} cut(s) not uploaded: ${pending.map((c) => c.cutId).join(', ')}`
      }
    }
    const missingMeta = status.cuts.filter(
      (c) => c.cid === null || c.url === null || c.fileHash === null
    )
    if (missingMeta.length > 0) {
      return {
        allowed: false,
        reason: `${missingMeta.length} cut(s) missing required metadata`
      }
    }
    return { allowed: false, reason: 'Already published' }
  }

  const hashMap = new Map(exportMetas.map((m) => [m.cutId, m.hash]))
  const stale = status.cuts.filter(
    (c) => c.fileHash !== null && hashMap.get(c.cutId) !== c.fileHash
  )
  if (stale.length > 0) {
    return {
      allowed: false,
      reason: `${stale.length} cut(s) have stale uploads: ${stale.map((c) => c.cutId).join(', ')}`
    }
  }

  return { allowed: true, reason: null }
}

const VALID_PLOT_TRANSITIONS: Record<string, PlotState[]> = {
  draft: ['ready'],
  ready: ['publishing', 'draft'],
  publishing: ['published', 'failed'],
  failed: ['ready'],
  published: []
}

export function canPlotTransition(from: PlotState, to: PlotState): boolean {
  return VALID_PLOT_TRANSITIONS[from]?.includes(to) ?? false
}

export function nextPlotState(
  status: PublishStatusFile,
  exportMetas: ExportMeta[]
): PlotState | null {
  const plan = buildUploadPlan(status, exportMetas)

  if (status.plotState === 'draft' && plan.readyToPublish) {
    return 'ready'
  }
  if (status.plotState === 'ready' && !plan.readyToPublish) {
    return 'draft'
  }
  return null
}
