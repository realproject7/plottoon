import type { Cut } from './CutList'
import type { CutUrl, GenerateOptions } from './publishGenerator'
import { generatePublishMarkdown } from './publishGenerator'

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

export type PublishFn = (payload: CartoonPublishPayload) => Promise<PublishRequestResult>

export interface CartoonPublishConfig {
  publish?: PublishFn
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

  const urlMap = new Map(payload.imageUrls.map((u) => [u.cutId, u.url]))
  if (!payload.isDryRun) {
    const missingUrls = payload.imageUrls.filter((u) => !u.url || u.url.trim().length === 0)
    if (missingUrls.length > 0) {
      errors.push(`Missing URLs for: ${missingUrls.map((u) => u.cutId).join(', ')}`)
    }
  }

  return errors
}

export async function publishCartoon(
  payload: CartoonPublishPayload,
  config: CartoonPublishConfig
): Promise<PublishRequestResult> {
  const errors = validatePayload(payload)
  if (errors.length > 0) {
    return {
      success: false,
      error: errors.join('; '),
      timestamp: new Date().toISOString(),
      isDryRun: payload.isDryRun
    }
  }

  if (config.mode === 'mock' || payload.isDryRun) {
    return mockPublish(payload)
  }

  if (!config.publish) {
    return {
      success: false,
      error: 'Live mode requires a publish function',
      timestamp: new Date().toISOString(),
      isDryRun: false
    }
  }

  return config.publish(payload)
}

export function includesContentType(payload: CartoonPublishPayload): boolean {
  return payload.storyline.type === 'new' && payload.contentType === 'cartoon'
}
