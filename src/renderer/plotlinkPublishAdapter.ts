import type { OutboundPublishRequest } from './cartoonPublish'
import type { CutUrl } from './publishGenerator'

export interface PlotLinkSigner {
  sign(message: string): Promise<string>
}

export interface PlotLinkNewStorylineRequest {
  storylineTitle: string
  contentType: 'cartoon'
  isNsfw: boolean
  content: string
  imageCount: number
  imageUrls: CutUrl[]
  message: string
  signature: string
}

export interface PlotLinkExistingStorylineRequest {
  storylineId: string
  isNsfw: boolean
  content: string
  imageCount: number
  imageUrls: CutUrl[]
  message: string
  signature: string
}

export type PlotLinkPublishRequest = PlotLinkNewStorylineRequest | PlotLinkExistingStorylineRequest

export interface PlotLinkPublishResponse {
  success: boolean
  storylineId?: string
  plotId?: string
  plotUrl?: string
  error?: string
}

export type PlotLinkFetchFn = (
  url: string,
  init: RequestInit
) => Promise<Response>

export interface PlotLinkPublishAdapterConfig {
  indexEndpoint: string
  signer: PlotLinkSigner
  fetch?: PlotLinkFetchFn
  mode: 'live' | 'mock'
}

function buildSignMessage(storylineId: string | undefined): string {
  const timestampMs = Date.now()
  const action = storylineId ? 'Publish plot' : 'Create storyline and publish plot'
  return `PlotLink: ${action}\nTimestamp: ${timestampMs}`
}

function mapToPlotLinkRequest(
  outbound: OutboundPublishRequest,
  message: string,
  signature: string
): PlotLinkPublishRequest {
  const isNsfw = outbound.matureFlag ?? false

  if (outbound.storylineId) {
    return {
      storylineId: outbound.storylineId,
      isNsfw,
      content: outbound.markdown,
      imageCount: outbound.imageCount,
      imageUrls: outbound.imageUrls,
      message,
      signature
    }
  }

  return {
    storylineTitle: outbound.storylineTitle ?? '',
    contentType: 'cartoon',
    isNsfw,
    content: outbound.markdown,
    imageCount: outbound.imageCount,
    imageUrls: outbound.imageUrls,
    message,
    signature
  }
}

function mockPublishResponse(outbound: OutboundPublishRequest): PlotLinkPublishResponse {
  return {
    success: true,
    storylineId: outbound.storylineId ?? `mock-storyline-${Date.now()}`,
    plotId: `mock-plot-${Date.now()}`,
    plotUrl: `https://plotlink.example/plots/mock-${Date.now()}`
  }
}

export function isNewStorylineRequest(
  req: PlotLinkPublishRequest
): req is PlotLinkNewStorylineRequest {
  return 'storylineTitle' in req
}

export async function plotlinkPublish(
  outbound: OutboundPublishRequest,
  config: PlotLinkPublishAdapterConfig
): Promise<PlotLinkPublishResponse> {
  if (config.mode === 'mock') {
    return mockPublishResponse(outbound)
  }

  const message = buildSignMessage(outbound.storylineId)
  const signature = await config.signer.sign(message)
  const request = mapToPlotLinkRequest(outbound, message, signature)

  const fetchFn = config.fetch ?? globalThis.fetch
  const response = await fetchFn(config.indexEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  })

  if (!response.ok) {
    return {
      success: false,
      error: `PlotLink publish failed: HTTP ${response.status}`
    }
  }

  const body = (await response.json()) as PlotLinkPublishResponse
  return body
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
