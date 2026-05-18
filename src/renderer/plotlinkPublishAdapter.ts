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
}

export interface TransactionResult {
  txHash: string
  confirmed: boolean
}

export interface ContentCommitResult {
  cid: string
  contentHash: string
}

export type ContentCommitFn = (markdown: string) => Promise<ContentCommitResult>

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

export interface PlotLinkStorylineIndexResponse {
  success: boolean
  storylineId?: string
  plotId?: string
  plotUrl?: string
  error?: string
}

export interface PlotLinkPlotIndexResponse {
  success: boolean
  plotId?: string
  plotUrl?: string
  error?: string
}

export interface PlotLinkPublishResponse {
  success: boolean
  storylineId?: string
  plotId?: string
  plotUrl?: string
  error?: string
}

export type PlotLinkFetchFn = (url: string, init: RequestInit) => Promise<Response>

export interface PlotLinkPublishAdapterConfig {
  baseUrl: string
  signer: PlotLinkSigner
  commitContent: ContentCommitFn
  fetch?: PlotLinkFetchFn
  mode: 'live' | 'mock'
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
): Promise<PlotLinkStorylineIndexResponse> {
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

  return (await response.json()) as PlotLinkStorylineIndexResponse
}

async function indexPlot(
  outbound: OutboundPublishRequest,
  storylineId: string,
  config: PlotLinkPublishAdapterConfig,
  message: string,
  signature: string,
  txHash: string
): Promise<PlotLinkPlotIndexResponse> {
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

  return (await response.json()) as PlotLinkPlotIndexResponse
}

function mockPublishResponse(outbound: OutboundPublishRequest): PlotLinkPublishResponse {
  return {
    success: true,
    storylineId: outbound.storylineId ?? `mock-storyline-${Date.now()}`,
    plotId: `mock-plot-${Date.now()}`,
    plotUrl: `https://plotlink.example/plots/mock-${Date.now()}`
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

  const txResult = await config.signer.sendTransaction({
    action,
    storylineId: outbound.storylineId,
    title: isNew ? (outbound.storylineTitle ?? '') : outbound.plotTitle,
    contentCid: commitResult.cid,
    contentHash: commitResult.contentHash
  })

  if (!txResult.confirmed) {
    return { success: false, error: 'Transaction not confirmed' }
  }

  if (isNew) {
    const slResult = await indexNewStoryline(outbound, config, message, signature, txResult.txHash)
    if (!slResult.success) {
      return { success: false, error: `Storyline creation failed: ${slResult.error}` }
    }
    return {
      success: true,
      storylineId: slResult.storylineId,
      plotId: slResult.plotId,
      plotUrl: slResult.plotUrl
    }
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
    plotId: plotResult.plotId,
    plotUrl: plotResult.plotUrl
  }
}

export function createPlotLinkPublishFn(config: PlotLinkPublishAdapterConfig) {
  return async (outbound: OutboundPublishRequest) => {
    const result = await plotlinkPublish(outbound, config)
    return {
      success: result.success,
      publishId: result.plotId,
      storylineId: result.storylineId,
      plotUrl: result.plotUrl,
      error: result.error,
      timestamp: new Date().toISOString(),
      isDryRun: false
    }
  }
}
