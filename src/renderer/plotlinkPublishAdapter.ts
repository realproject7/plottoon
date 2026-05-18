import type { OutboundPublishRequest } from './cartoonPublish'
import type { CutUrl } from './publishGenerator'

export interface PlotLinkSigner {
  sign(message: string): Promise<string>
  sendTransaction(payload: TransactionPayload): Promise<TransactionResult>
}

export interface TransactionPayload {
  action: 'create-storyline' | 'publish-plot'
  storylineId?: string
  contentHash: string
}

export interface TransactionResult {
  txHash: string
  confirmed: boolean
}

export interface PlotLinkStorylineIndexRequest {
  storylineTitle: string
  contentType: 'cartoon'
  isNsfw: boolean
  txHash: string
  message: string
  signature: string
}

export interface PlotLinkPlotIndexRequest {
  storylineId: string
  isNsfw: boolean
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
  fetch?: PlotLinkFetchFn
  mode: 'live' | 'mock'
}

function buildSignMessage(action: 'create-storyline' | 'publish-plot'): string {
  const timestampMs = Date.now()
  const label = action === 'create-storyline' ? 'Create storyline and publish plot' : 'Publish plot'
  return `PlotLink: ${label}\nTimestamp: ${timestampMs}`
}

function computeContentHash(markdown: string): string {
  let hash = 0
  for (let i = 0; i < markdown.length; i++) {
    hash = ((hash << 5) - hash + markdown.charCodeAt(i)) | 0
  }
  return `content-${Math.abs(hash).toString(16).padStart(8, '0')}`
}

async function createStoryline(
  outbound: OutboundPublishRequest,
  config: PlotLinkPublishAdapterConfig,
  message: string,
  signature: string,
  txHash: string
): Promise<PlotLinkStorylineIndexResponse> {
  const request: PlotLinkStorylineIndexRequest = {
    storylineTitle: outbound.storylineTitle ?? '',
    contentType: 'cartoon',
    isNsfw: outbound.matureFlag ?? false,
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
    isNsfw: outbound.matureFlag ?? false,
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
  const action = isNew ? 'create-storyline' : 'publish-plot'
  const message = buildSignMessage(action)
  const signature = await config.signer.sign(message)

  const contentHash = computeContentHash(outbound.markdown)
  const txResult = await config.signer.sendTransaction({
    action,
    storylineId: outbound.storylineId,
    contentHash
  })

  if (!txResult.confirmed) {
    return { success: false, error: 'Transaction not confirmed' }
  }

  let storylineId = outbound.storylineId

  if (isNew) {
    const slResult = await createStoryline(outbound, config, message, signature, txResult.txHash)
    if (!slResult.success) {
      return { success: false, error: `Storyline creation failed: ${slResult.error}` }
    }
    storylineId = slResult.storylineId
  }

  const plotResult = await indexPlot(
    outbound,
    storylineId!,
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
    storylineId,
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
