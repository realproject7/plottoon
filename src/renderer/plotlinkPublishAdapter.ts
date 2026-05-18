import type { OutboundPublishRequest } from './cartoonPublish'
import type { CutUrl } from './publishGenerator'

export interface PlotLinkSigner {
  sign(message: string): Promise<string>
  sendTransaction(payload: TransactionPayload): Promise<TransactionResult>
}

export interface TransactionPayload {
  action: 'create-storyline' | 'chain-plot'
  storylineId?: string
  title: string
  contentCid: string
  contentHash: string
  creationFeeWei?: string
  hasDeadline?: boolean
}

export interface TransactionResult {
  txHash: string
  confirmed: boolean
  storylineId?: string
  plotIndex?: number
}

export interface ContentCommitResult {
  cid: string
  contentHash: string
}

export type ContentCommitFn = (markdown: string) => Promise<ContentCommitResult>

export type ContentHashFn = (markdown: string) => string

export interface PlotLinkStorylineIndexRequest {
  storylineTitle: string
  contentType: 'cartoon'
  isNsfw: string
  content: string
  imageCount: number
  imageUrls: CutUrl[]
  txHash: string
  message: string
  signature: string
}

export interface PlotLinkPlotIndexRequest {
  storylineId: string
  isNsfw: string
  content: string
  imageCount: number
  imageUrls: CutUrl[]
  txHash: string
  message: string
  signature: string
}

export interface PlotLinkIndexResponse {
  success: boolean
  error?: string
}

export interface PlotLinkPublishResponse {
  success: boolean
  storylineId?: string
  plotIndex?: number
  txHash?: string
  error?: string
}

export type PlotLinkFetchFn = (url: string, init: RequestInit) => Promise<Response>

export interface PlotLinkPublishAdapterConfig {
  baseUrl: string
  signer: PlotLinkSigner
  commitContent: ContentCommitFn
  contentHash: ContentHashFn
  fetch?: PlotLinkFetchFn
  mode: 'live' | 'mock'
  creationFeeWei?: string
  hasDeadline?: boolean
}

function isValidContentHash(hash: string): boolean {
  return /^0x[0-9a-f]{64}$/i.test(hash)
}

function buildSignMessage(action: 'create-storyline' | 'chain-plot'): string {
  const timestampMs = Date.now()
  const label = action === 'create-storyline' ? 'Create storyline and publish plot' : 'Publish plot'
  return `PlotLink: ${label}\nTimestamp: ${timestampMs}`
}

async function indexNewStoryline(
  outbound: OutboundPublishRequest,
  config: PlotLinkPublishAdapterConfig,
  message: string,
  signature: string,
  txHash: string
): Promise<PlotLinkIndexResponse> {
  const request: PlotLinkStorylineIndexRequest = {
    storylineTitle: outbound.storylineTitle ?? '',
    contentType: 'cartoon',
    isNsfw: String(outbound.matureFlag ?? false),
    content: outbound.markdown,
    imageCount: outbound.imageCount,
    imageUrls: outbound.imageUrls,
    txHash,
    message,
    signature
  }

  const fetchFn = config.fetch ?? globalThis.fetch
  const response = await fetchFn(`${config.baseUrl}/api/index/storyline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  })

  if (!response.ok) {
    return { success: false, error: `HTTP ${response.status}` }
  }

  return (await response.json()) as PlotLinkIndexResponse
}

async function indexPlot(
  outbound: OutboundPublishRequest,
  storylineId: string,
  config: PlotLinkPublishAdapterConfig,
  message: string,
  signature: string,
  txHash: string
): Promise<PlotLinkIndexResponse> {
  const request: PlotLinkPlotIndexRequest = {
    storylineId,
    isNsfw: String(outbound.matureFlag ?? false),
    content: outbound.markdown,
    imageCount: outbound.imageCount,
    imageUrls: outbound.imageUrls,
    txHash,
    message,
    signature
  }

  const fetchFn = config.fetch ?? globalThis.fetch
  const response = await fetchFn(`${config.baseUrl}/api/index/plot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  })

  if (!response.ok) {
    return { success: false, error: `HTTP ${response.status}` }
  }

  return (await response.json()) as PlotLinkIndexResponse
}

function mockPublishResponse(outbound: OutboundPublishRequest): PlotLinkPublishResponse {
  return {
    success: true,
    storylineId: outbound.storylineId ?? `mock-storyline-${Date.now()}`,
    plotIndex: 0,
    txHash: `mock-tx-${Date.now()}`
  }
}

export async function plotlinkPublish(
  outbound: OutboundPublishRequest,
  config: PlotLinkPublishAdapterConfig
): Promise<PlotLinkPublishResponse> {
  if (config.mode === 'mock') {
    return mockPublishResponse(outbound)
  }

  const isNew = !outbound.storylineId
  const action = isNew ? 'create-storyline' : 'chain-plot'
  const message = buildSignMessage(action)
  const signature = await config.signer.sign(message)

  const commitResult = await config.commitContent(outbound.markdown)

  const computedHash = config.contentHash(outbound.markdown)
  if (!isValidContentHash(computedHash)) {
    return { success: false, error: 'Content hash must be 0x-prefixed keccak256 bytes32' }
  }

  const txPayload: TransactionPayload = {
    action,
    storylineId: outbound.storylineId,
    title: isNew ? (outbound.storylineTitle ?? '') : outbound.plotTitle,
    contentCid: commitResult.cid,
    contentHash: computedHash,
    creationFeeWei: isNew ? config.creationFeeWei : undefined,
    hasDeadline: isNew ? (config.hasDeadline ?? false) : undefined
  }

  const txResult = await config.signer.sendTransaction(txPayload)

  if (!txResult.confirmed) {
    return { success: false, error: 'Transaction not confirmed' }
  }

  if (isNew) {
    if (!txResult.storylineId) {
      return { success: false, error: 'Transaction did not return storylineId' }
    }

    const slResult = await indexNewStoryline(outbound, config, message, signature, txResult.txHash)
    if (!slResult.success) {
      return { success: false, error: `Storyline indexing failed: ${slResult.error}` }
    }

    return {
      success: true,
      storylineId: txResult.storylineId,
      plotIndex: txResult.plotIndex ?? 0,
      txHash: txResult.txHash
    }
  }

  if (txResult.plotIndex === undefined) {
    return { success: false, error: 'Transaction did not return plotIndex' }
  }

  const plotResult = await indexPlot(
    outbound,
    outbound.storylineId!,
    config,
    message,
    signature,
    txResult.txHash
  )

  if (!plotResult.success) {
    return { success: false, error: `Plot indexing failed: ${plotResult.error}` }
  }

  return {
    success: true,
    storylineId: outbound.storylineId,
    plotIndex: txResult.plotIndex,
    txHash: txResult.txHash
  }
}

export function createPlotLinkPublishFn(config: PlotLinkPublishAdapterConfig) {
  return async (outbound: OutboundPublishRequest) => {
    const result = await plotlinkPublish(outbound, config)
    return {
      success: result.success,
      publishId: result.txHash,
      storylineId: result.storylineId,
      plotUrl: result.storylineId
        ? result.plotIndex
          ? `${config.baseUrl}/story/${result.storylineId}/${result.plotIndex}`
          : `${config.baseUrl}/story/${result.storylineId}`
        : undefined,
      error: result.error,
      timestamp: new Date().toISOString(),
      isDryRun: false
    }
  }
}
