import type { PublishResultRecord, PublishStatusFile } from './publishStatus'

export interface IndexRetryEligibility {
  eligible: boolean
  reason: string | null
}

export function checkRetryEligibility(status: PublishStatusFile): IndexRetryEligibility {
  if (status.plotState !== 'published-not-indexed') {
    return { eligible: false, reason: 'Plot is not in published-not-indexed state' }
  }

  const result = status.publishResult
  if (!result) {
    return { eligible: false, reason: 'No publish result metadata available' }
  }

  if (!result.txHash) {
    return { eligible: false, reason: 'Missing txHash — cannot retry indexing without it' }
  }

  return { eligible: true, reason: null }
}

export function checkRetryContentEligibility(
  status: PublishStatusFile,
  fallbackContent: string | null | undefined
): IndexRetryEligibility {
  const base = checkRetryEligibility(status)
  if (!base.eligible) return base

  if (!fallbackContent || fallbackContent.trim().length === 0) {
    return {
      eligible: false,
      reason: 'Missing fallback content — cannot retry indexing without txHash and content'
    }
  }

  return { eligible: true, reason: null }
}

export interface IndexRetryDeps {
  plotlinkBaseUrl: string
  indexRetries: number
  indexRetryDelayMs: number
  fetch: (url: string, init: RequestInit) => Promise<Response>
}

export function selectIndexEndpoint(
  result: PublishResultRecord,
  baseUrl: string
): { url: string; isStoryline: boolean } {
  const isStoryline =
    result.storylineId === null || result.plotIndex === null || result.plotIndex === 0
  return {
    url: isStoryline ? `${baseUrl}/api/index/storyline` : `${baseUrl}/api/index/plot`,
    isStoryline
  }
}

export function buildIndexBody(
  result: PublishResultRecord,
  isStoryline: boolean,
  fallbackContent: string | null,
  meta?: { contentType?: string; isNsfw?: string; genre?: string; language?: string }
): Record<string, unknown> {
  if (isStoryline) {
    const body: Record<string, unknown> = {
      txHash: result.txHash
    }
    if (fallbackContent) body.content = fallbackContent
    if (meta?.contentType) body.contentType = meta.contentType
    if (meta?.isNsfw) body.isNsfw = meta.isNsfw
    if (meta?.genre) body.genre = meta.genre
    if (meta?.language) body.language = meta.language
    return body
  }

  const body: Record<string, unknown> = {
    txHash: result.txHash
  }
  if (result.storylineId) body.storylineId = result.storylineId
  if (fallbackContent) body.content = fallbackContent
  if (meta?.isNsfw) body.isNsfw = meta.isNsfw
  return body
}

export async function retryIndex(
  body: Record<string, unknown>,
  url: string,
  deps: IndexRetryDeps
): Promise<{ success: boolean; error?: string }> {
  for (let attempt = 0; attempt <= deps.indexRetries; attempt++) {
    try {
      const response = await deps.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (response.ok) {
        const json = (await response.json()) as { success: boolean }
        if (json.success) return { success: true }
      }
      if (attempt < deps.indexRetries) {
        await new Promise((r) => setTimeout(r, deps.indexRetryDelayMs))
      }
    } catch {
      if (attempt < deps.indexRetries) {
        await new Promise((r) => setTimeout(r, deps.indexRetryDelayMs))
      }
    }
  }
  return { success: false, error: 'Index retry failed after all attempts' }
}

export function markManualNotIndexed(status: PublishStatusFile, reason: string): PublishStatusFile {
  const publishResult = status.publishResult
    ? { ...status.publishResult, indexed: false, indexError: reason }
    : null
  return {
    ...status,
    plotState: 'published-not-indexed',
    error: reason,
    publishResult,
    updatedAt: new Date().toISOString()
  }
}
