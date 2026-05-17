import { describe, it, expect, vi } from 'vitest'
import {
  buildCartoonPayload,
  buildOutboundRequest,
  validatePayload,
  publishCartoon,
  includesContentType,
  type CartoonPublishPayload,
  type CartoonPublishConfig,
  type StorylineTarget
} from '../cartoonPublish'
import type { Cut } from '../CutList'
import type { CutUrl } from '../publishGenerator'

function makeCut(id: string): Cut {
  return {
    id,
    dialogue: `Dialogue for ${id}`,
    direction: `Direction for ${id}`,
    imageState: { status: 'done', path: `${id}.webp`, prompt: null, seed: null },
    overlays: []
  }
}

function makeUrls(cutIds: string[]): CutUrl[] {
  return cutIds.map((id) => ({ cutId: id, url: `https://cdn.example/${id}.webp` }))
}

function newStoryline(title = 'My Cartoon'): StorylineTarget {
  return { type: 'new', title }
}

function existingStoryline(id = 'storyline-123'): StorylineTarget {
  return { type: 'existing', storylineId: id, title: 'Existing' }
}

describe('buildCartoonPayload', () => {
  it('builds payload with correct image sequence and contentType', () => {
    const cuts = [makeCut('cut-001'), makeCut('cut-002'), makeCut('cut-003')]
    const urls = makeUrls(['cut-001', 'cut-002', 'cut-003'])
    const payload = buildCartoonPayload(cuts, urls, newStoryline(), {
      plotTitle: 'Episode 1'
    })

    expect(payload.contentType).toBe('cartoon')
    expect(payload.plotTitle).toBe('Episode 1')
    expect(payload.imageCount).toBe(3)
    expect(payload.imageUrls).toHaveLength(3)
    expect(payload.isDryRun).toBe(false)
    expect(payload.storyline.type).toBe('new')
  })

  it('preserves image order in markdown', () => {
    const cuts = [makeCut('cut-001'), makeCut('cut-002')]
    const urls = makeUrls(['cut-001', 'cut-002'])
    const payload = buildCartoonPayload(cuts, urls, newStoryline(), {
      plotTitle: 'Ep'
    })

    const lines = payload.markdown.split('\n')
    const imageLines = lines.filter((l) => l.startsWith('!['))
    expect(imageLines[0]).toContain('https://cdn.example/cut-001.webp')
    expect(imageLines[1]).toContain('https://cdn.example/cut-002.webp')
  })

  it('sets isDryRun flag', () => {
    const cuts = [makeCut('cut-001')]
    const urls = makeUrls(['cut-001'])
    const payload = buildCartoonPayload(cuts, urls, newStoryline(), {
      plotTitle: 'Ep',
      isDryRun: true
    })

    expect(payload.isDryRun).toBe(true)
  })

  it('generates markdown with title heading', () => {
    const cuts = [makeCut('cut-001')]
    const urls = makeUrls(['cut-001'])
    const payload = buildCartoonPayload(cuts, urls, newStoryline(), {
      plotTitle: 'My Title'
    })

    expect(payload.markdown).toContain('# My Title')
  })
})

describe('validatePayload', () => {
  function validPayload(): CartoonPublishPayload {
    const cuts = [makeCut('cut-001')]
    const urls = makeUrls(['cut-001'])
    return buildCartoonPayload(cuts, urls, newStoryline(), { plotTitle: 'Ep' })
  }

  it('returns empty for valid payload', () => {
    expect(validatePayload(validPayload())).toEqual([])
  })

  it('requires plotTitle', () => {
    const payload = { ...validPayload(), plotTitle: '' }
    expect(validatePayload(payload)).toContain('plotTitle is required')
  })

  it('requires at least one image', () => {
    const payload = { ...validPayload(), imageCount: 0 }
    expect(validatePayload(payload)).toContain('At least one image is required')
  })

  it('requires storylineId for existing storyline', () => {
    const payload = {
      ...validPayload(),
      storyline: { type: 'existing' as const, title: 'X' }
    }
    expect(validatePayload(payload)).toContain('Existing storyline requires a storylineId')
  })

  it('requires title for new storyline', () => {
    const payload = {
      ...validPayload(),
      storyline: { type: 'new' as const, title: '' }
    }
    expect(validatePayload(payload)).toContain('New storyline requires a title')
  })

  it('allows missing URLs in dry-run mode', () => {
    const payload = {
      ...validPayload(),
      isDryRun: true,
      imageUrls: [{ cutId: 'cut-001', url: '' }]
    }
    expect(validatePayload(payload)).toEqual([])
  })

  it('rejects missing URLs in real mode', () => {
    const payload = {
      ...validPayload(),
      isDryRun: false,
      imageUrls: [{ cutId: 'cut-001', url: '' }]
    }
    const errors = validatePayload(payload)
    expect(errors.some((e) => e.includes('Missing URLs'))).toBe(true)
  })
})

describe('publishCartoon', () => {
  it('returns mock success in mock mode', async () => {
    const cuts = [makeCut('cut-001')]
    const urls = makeUrls(['cut-001'])
    const payload = buildCartoonPayload(cuts, urls, newStoryline(), { plotTitle: 'Ep' })
    const config: CartoonPublishConfig = { mode: 'mock' }

    const result = await publishCartoon(payload, config)

    expect(result.success).toBe(true)
    expect(result.publishId).toContain('mock-pub')
    expect(result.storylineId).toBeTruthy()
    expect(result.plotUrl).toBeTruthy()
    expect(result.isDryRun).toBe(false)
  })

  it('returns mock success in dry-run mode even with live config', async () => {
    const cuts = [makeCut('cut-001')]
    const urls: CutUrl[] = [{ cutId: 'cut-001', url: '' }]
    const payload = buildCartoonPayload(cuts, urls, newStoryline(), {
      plotTitle: 'Ep',
      isDryRun: true
    })
    const config: CartoonPublishConfig = { mode: 'live' }

    const result = await publishCartoon(payload, config)

    expect(result.success).toBe(true)
    expect(result.isDryRun).toBe(true)
  })

  it('calls publish function with outbound request in live mode', async () => {
    const cuts = [makeCut('cut-001')]
    const urls = makeUrls(['cut-001'])
    const payload = buildCartoonPayload(cuts, urls, newStoryline(), { plotTitle: 'Ep' })
    const publishFn = vi.fn().mockResolvedValue({
      success: true,
      publishId: 'real-pub-1',
      storylineId: 'sl-1',
      plotUrl: 'https://plotlink.example/plots/1',
      timestamp: '2026-01-01T00:00:00.000Z',
      isDryRun: false
    })
    const config: CartoonPublishConfig = { mode: 'live', publish: publishFn }

    const result = await publishCartoon(payload, config)

    expect(publishFn).toHaveBeenCalledTimes(1)
    const outbound = publishFn.mock.calls[0][0]
    expect(outbound.plotTitle).toBe('Ep')
    expect(outbound.contentType).toBe('cartoon')
    expect(outbound.storylineTitle).toBe('My Cartoon')
    expect(result.success).toBe(true)
    expect(result.publishId).toBe('real-pub-1')
  })

  it('returns error when live mode has no publish function', async () => {
    const cuts = [makeCut('cut-001')]
    const urls = makeUrls(['cut-001'])
    const payload = buildCartoonPayload(cuts, urls, newStoryline(), { plotTitle: 'Ep' })
    const config: CartoonPublishConfig = { mode: 'live' }

    const result = await publishCartoon(payload, config)

    expect(result.success).toBe(false)
    expect(result.error).toContain('requires a publish function')
  })

  it('returns validation errors without calling publish', async () => {
    const payload: CartoonPublishPayload = {
      storyline: newStoryline(''),
      contentType: 'cartoon',
      plotTitle: '',
      markdown: '',
      imageCount: 0,
      imageUrls: [],
      isDryRun: false
    }
    const publishFn = vi.fn()
    const config: CartoonPublishConfig = { mode: 'live', publish: publishFn }

    const result = await publishCartoon(payload, config)

    expect(result.success).toBe(false)
    expect(publishFn).not.toHaveBeenCalled()
  })
})

describe('includesContentType', () => {
  it('returns true for new storyline with cartoon type', () => {
    const cuts = [makeCut('cut-001')]
    const urls = makeUrls(['cut-001'])
    const payload = buildCartoonPayload(cuts, urls, newStoryline(), { plotTitle: 'Ep' })

    expect(includesContentType(payload)).toBe(true)
  })

  it('returns false for existing storyline', () => {
    const cuts = [makeCut('cut-001')]
    const urls = makeUrls(['cut-001'])
    const payload = buildCartoonPayload(cuts, urls, existingStoryline(), { plotTitle: 'Ep' })

    expect(includesContentType(payload)).toBe(false)
  })
})

describe('buildOutboundRequest', () => {
  it('includes contentType for new storyline', () => {
    const cuts = [makeCut('cut-001')]
    const urls = makeUrls(['cut-001'])
    const payload = buildCartoonPayload(cuts, urls, newStoryline('New Story'), { plotTitle: 'Ep' })
    const outbound = buildOutboundRequest(payload)

    expect(outbound.contentType).toBe('cartoon')
    expect(outbound.storylineTitle).toBe('New Story')
    expect(outbound.storylineId).toBeUndefined()
  })

  it('omits contentType for existing storyline', () => {
    const cuts = [makeCut('cut-001')]
    const urls = makeUrls(['cut-001'])
    const payload = buildCartoonPayload(cuts, urls, existingStoryline('sl-99'), { plotTitle: 'Ep' })
    const outbound = buildOutboundRequest(payload)

    expect(outbound.contentType).toBeUndefined()
    expect(outbound.storylineId).toBe('sl-99')
    expect(outbound.storylineTitle).toBeUndefined()
  })
})

describe('persistence', () => {
  it('calls persist with result on successful mock publish', async () => {
    const cuts = [makeCut('cut-001')]
    const urls = makeUrls(['cut-001'])
    const payload = buildCartoonPayload(cuts, urls, newStoryline(), { plotTitle: 'Ep' })
    const persist = vi.fn().mockResolvedValue(undefined)
    const config: CartoonPublishConfig = { mode: 'mock', persist }

    const result = await publishCartoon(payload, config)

    expect(persist).toHaveBeenCalledWith(result)
    expect(result.success).toBe(true)
  })

  it('calls persist with error result on validation failure', async () => {
    const payload: CartoonPublishPayload = {
      storyline: newStoryline(''),
      contentType: 'cartoon',
      plotTitle: '',
      markdown: '',
      imageCount: 0,
      imageUrls: [],
      isDryRun: false
    }
    const persist = vi.fn().mockResolvedValue(undefined)
    const config: CartoonPublishConfig = { mode: 'live', persist }

    const result = await publishCartoon(payload, config)

    expect(persist).toHaveBeenCalledWith(result)
    expect(result.success).toBe(false)
  })

  it('calls persist with result from live publish function', async () => {
    const cuts = [makeCut('cut-001')]
    const urls = makeUrls(['cut-001'])
    const payload = buildCartoonPayload(cuts, urls, newStoryline(), { plotTitle: 'Ep' })
    const liveResult = {
      success: true,
      publishId: 'pub-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      isDryRun: false
    }
    const publishFn = vi.fn().mockResolvedValue(liveResult)
    const persist = vi.fn().mockResolvedValue(undefined)
    const config: CartoonPublishConfig = { mode: 'live', publish: publishFn, persist }

    await publishCartoon(payload, config)

    expect(persist).toHaveBeenCalledWith(liveResult)
  })
})
