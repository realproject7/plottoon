import type { Cut } from './CutList'
import type { CutUrl, GenerateOptions } from './publishGenerator'
import { generatePublishMarkdown } from './publishGenerator'
import type { ProjectPublishMeta } from './publishMetadata'
import { shouldIncludeContentType, getContentTypeForNewStoryline } from './publishMetadata'

export interface StorylineTarget {
  type: 'new' | 'existing'
  storylineId?: string
  title: string
}

export interface CartoonPublishPayload {
  storyline: StorylineTarget
  contentType: 'cartoon'
  plotTitle: string
  markdown: string
  imageCount: number
  imageUrls: CutUrl[]
  isDryRun: boolean
}

export interface PublishRequestResult {
  success: boolean
  publishId?: string
  storylineId?: string
  plotUrl?: string
  error?: string
  timestamp: string
  isDryRun: boolean
}

export interface OutboundPublishRequest {
  storylineId?: string
  storylineTitle?: string
  contentType?: 'cartoon'
  plotTitle: string
  markdown: string
  imageCount: number
  imageUrls: CutUrl[]
}

export type PublishFn = (request: OutboundPublishRequest) => Promise<PublishRequestResult>
export type PersistFn = (result: PublishRequestResult) => Promise<void>

export interface CartoonPublishConfig {
  publish?: PublishFn
  persist?: PersistFn
  publishMeta?: ProjectPublishMeta
  mode: 'live' | 'mock'
}

function mockPublish(payload: CartoonPublishPayload): PublishRequestResult {
  return {
    success: true,
    publishId: `mock-pub-${Date.now()}`,
    storylineId: payload.storyline.storylineId ?? `mock-storyline-${Date.now()}`,
    plotUrl: `https://plotlink.example/plots/mock-${Date.now()}`,
    timestamp: new Date().toISOString(),
    isDryRun: payload.isDryRun
  }
}

export function buildCartoonPayload(
  cuts: Cut[],
  urls: CutUrl[],
  storyline: StorylineTarget,
  opts: { plotTitle: string; isDryRun?: boolean; includeTranscript?: boolean }
): CartoonPublishPayload {
  const generateOpts: GenerateOptions = {
    cuts,
    urls,
    plotTitle: opts.plotTitle,
    dryRun: opts.isDryRun ?? false,
    includeTranscript: opts.includeTranscript ?? false
  }

  const markdown = generatePublishMarkdown(generateOpts)

  return {
    storyline,
    contentType: 'cartoon',
    plotTitle: opts.plotTitle,
    markdown,
    imageCount: cuts.length,
    imageUrls: urls,
    isDryRun: opts.isDryRun ?? false
  }
}

export function validatePayload(payload: CartoonPublishPayload): string[] {
  const errors: string[] = []

  if (!payload.plotTitle) {
    errors.push('plotTitle is required')
  }
  if (payload.imageCount === 0) {
    errors.push('At least one image is required')
  }
  if (!payload.markdown) {
    errors.push('Markdown content is required')
  }
  if (payload.storyline.type === 'new' && !payload.storyline.title) {
    errors.push('New storyline requires a title')
  }
  if (payload.storyline.type === 'existing' && !payload.storyline.storylineId) {
    errors.push('Existing storyline requires a storylineId')
  }
  if (payload.contentType !== 'cartoon') {
    errors.push('contentType must be "cartoon"')
  }

  if (!payload.isDryRun) {
    const missingUrls = payload.imageUrls.filter((u) => !u.url || u.url.trim().length === 0)
    if (missingUrls.length > 0) {
      errors.push(`Missing URLs for: ${missingUrls.map((u) => u.cutId).join(', ')}`)
    }
  }

  return errors
}

export function buildOutboundRequest(
  payload: CartoonPublishPayload,
  publishMeta?: ProjectPublishMeta
): OutboundPublishRequest {
  const request: OutboundPublishRequest = {
    plotTitle: payload.plotTitle,
    markdown: payload.markdown,
    imageCount: payload.imageCount,
    imageUrls: payload.imageUrls
  }

  if (payload.storyline.type === 'new') {
    request.storylineTitle = payload.storyline.title
    if (publishMeta) {
      if (shouldIncludeContentType(publishMeta, 'new')) {
        const ct = getContentTypeForNewStoryline(publishMeta)
        if (ct) request.contentType = ct
      }
    } else {
      request.contentType = 'cartoon'
    }
  } else {
    request.storylineId = payload.storyline.storylineId
  }

  return request
}

export async function publishCartoon(
  payload: CartoonPublishPayload,
  config: CartoonPublishConfig
): Promise<PublishRequestResult> {
  const errors = validatePayload(payload)
  if (errors.length > 0) {
    const result: PublishRequestResult = {
      success: false,
      error: errors.join('; '),
      timestamp: new Date().toISOString(),
      isDryRun: payload.isDryRun
    }
    if (config.persist) await config.persist(result)
    return result
  }

  if (config.mode === 'mock' || payload.isDryRun) {
    const result = mockPublish(payload)
    if (config.persist) await config.persist(result)
    return result
  }

  if (!config.publish) {
    const result: PublishRequestResult = {
      success: false,
      error: 'Live mode requires a publish function',
      timestamp: new Date().toISOString(),
      isDryRun: false
    }
    if (config.persist) await config.persist(result)
    return result
  }

  const outbound = buildOutboundRequest(payload, config.publishMeta)
  const result = await config.publish(outbound)
  if (config.persist) await config.persist(result)
  return result
}

export function includesContentType(payload: CartoonPublishPayload): boolean {
  return payload.storyline.type === 'new' && payload.contentType === 'cartoon'
}
