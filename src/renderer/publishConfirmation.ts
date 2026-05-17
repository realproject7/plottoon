import type { ExportMeta } from './exportMetadata'

export interface ImageIdentity {
  cutId: string
  hash: string
  mimeType: string
  byteSize: number
}

export interface PublishPreview {
  title: string
  contentType: 'cartoon'
  imageCount: number
  totalUploadedBytes: number
  hasTranscript: boolean
  hasAltText: boolean
  matureFlag: boolean
  markdown: string
  imageOrder: string[]
  imageIdentities: ImageIdentity[]
  payloadHash: string
}

export interface ConfirmationState {
  confirmed: boolean
  confirmedAt: string | null
  payloadHash: string | null
  isDryRun: boolean
}

export function createConfirmationState(isDryRun: boolean): ConfirmationState {
  return {
    confirmed: false,
    confirmedAt: null,
    payloadHash: null,
    isDryRun
  }
}

export function computePayloadHash(preview: Omit<PublishPreview, 'payloadHash'>): string {
  const payload = JSON.stringify({
    title: preview.title,
    contentType: preview.contentType,
    imageCount: preview.imageCount,
    totalUploadedBytes: preview.totalUploadedBytes,
    hasTranscript: preview.hasTranscript,
    hasAltText: preview.hasAltText,
    matureFlag: preview.matureFlag,
    markdown: preview.markdown,
    imageOrder: preview.imageOrder,
    imageIdentities: preview.imageIdentities
  })
  let hash = 0
  for (let i = 0; i < payload.length; i++) {
    const ch = payload.charCodeAt(i)
    hash = ((hash << 5) - hash + ch) | 0
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function buildPublishPreview(
  title: string,
  markdown: string,
  exportMetas: ExportMeta[],
  opts: {
    hasTranscript: boolean
    hasAltText: boolean
    matureFlag?: boolean
  }
): PublishPreview {
  const imageOrder = exportMetas.map((m) => m.cutId)
  const totalUploadedBytes = exportMetas.reduce((sum, m) => sum + m.byteSize, 0)
  const imageIdentities: ImageIdentity[] = exportMetas.map((m) => ({
    cutId: m.cutId,
    hash: m.hash,
    mimeType: m.mimeType,
    byteSize: m.byteSize
  }))

  const partial = {
    title,
    contentType: 'cartoon' as const,
    imageCount: exportMetas.length,
    totalUploadedBytes,
    hasTranscript: opts.hasTranscript,
    hasAltText: opts.hasAltText,
    matureFlag: opts.matureFlag ?? false,
    markdown,
    imageOrder,
    imageIdentities
  }

  return { ...partial, payloadHash: computePayloadHash(partial) }
}

export function confirmPublish(
  state: ConfirmationState,
  preview: PublishPreview
): ConfirmationState {
  return {
    confirmed: true,
    confirmedAt: new Date().toISOString(),
    payloadHash: preview.payloadHash,
    isDryRun: state.isDryRun
  }
}

export function isConfirmationValid(
  state: ConfirmationState,
  currentPreview: PublishPreview
): boolean {
  if (!state.confirmed) return false
  if (state.payloadHash !== currentPreview.payloadHash) return false
  return true
}

export function canPublishWithConfirmation(
  state: ConfirmationState,
  currentPreview: PublishPreview
): { allowed: boolean; reason: string | null } {
  if (state.isDryRun) {
    return { allowed: true, reason: null }
  }
  if (!state.confirmed) {
    return { allowed: false, reason: 'Publish requires explicit user confirmation' }
  }
  if (state.payloadHash !== currentPreview.payloadHash) {
    return {
      allowed: false,
      reason: 'Payload changed since confirmation — please re-confirm'
    }
  }
  return { allowed: true, reason: null }
}

export function invalidateOnChange(
  state: ConfirmationState,
  newPreview: PublishPreview
): ConfirmationState {
  if (!state.confirmed) return state
  if (state.payloadHash === newPreview.payloadHash) return state
  return {
    confirmed: false,
    confirmedAt: null,
    payloadHash: null,
    isDryRun: state.isDryRun
  }
}
