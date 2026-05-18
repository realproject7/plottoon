import { describe, it, expect, vi } from 'vitest'
import {
  plotlinkPublish,
  createPlotLinkPublishFn,
  isNewStorylineRequest,
  type PlotLinkPublishAdapterConfig,
  type PlotLinkSigner,
  type PlotLinkNewStorylineRequest,
  type PlotLinkExistingStorylineRequest
} from '../plotlinkPublishAdapter'
import type { OutboundPublishRequest } from '../cartoonPublish'

function mockSigner(): PlotLinkSigner {
  return { sign: vi.fn().mockResolvedValue('test-signature') }
}

function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body)
  })
}

function newStorylineOutbound(): OutboundPublishRequest {
  return {
    storylineTitle: 'My Cartoon',
    contentType: 'cartoon',
    matureFlag: true,
    plotTitle: 'Episode 1',
    markdown: '# Episode 1\n\n![cut-001](https://cdn.example/cut-001.webp)',
    imageCount: 1,
    imageUrls: [{ cutId: 'cut-001', url: 'https://cdn.example/cut-001.webp' }]
  }
}

function existingStorylineOutbound(): OutboundPublishRequest {
  return {
    storylineId: 'storyline-abc',
    plotTitle: 'Episode 2',
    markdown: '# Episode 2\n\n![cut-002](https://cdn.example/cut-002.webp)',
    imageCount: 1,
    imageUrls: [{ cutId: 'cut-002', url: 'https://cdn.example/cut-002.webp' }]
  }
}

describe('plotlinkPublish', () => {
  describe('new storyline', () => {
    it('maps contentType, isNsfw, and storylineTitle for new storylines', async () => {
      const fetchFn = mockFetch({
        success: true,
        storylineId: 'sl-new',
        plotId: 'plot-1',
        plotUrl: 'https://plotlink.example/plots/1'
      })
      const config: PlotLinkPublishAdapterConfig = {
        indexEndpoint: 'https://plotlink.example/api/publish',
        signer: mockSigner(),
        fetch: fetchFn,
        mode: 'live'
      }

      const result = await plotlinkPublish(newStorylineOutbound(), config)

      expect(result.success).toBe(true)
      expect(result.storylineId).toBe('sl-new')

      const [, init] = fetchFn.mock.calls[0]
      const body = JSON.parse(init.body) as PlotLinkNewStorylineRequest
      expect(body.storylineTitle).toBe('My Cartoon')
      expect(body.contentType).toBe('cartoon')
      expect(body.isNsfw).toBe(true)
      expect(body.content).toContain('# Episode 1')
      expect(body.message).toMatch(/^PlotLink: Create storyline and publish plot\nTimestamp: \d+$/)
      expect(body.signature).toBe('test-signature')
    })

    it('sets isNsfw false when matureFlag is false', async () => {
      const fetchFn = mockFetch({ success: true })
      const config: PlotLinkPublishAdapterConfig = {
        indexEndpoint: 'https://plotlink.example/api/publish',
        signer: mockSigner(),
        fetch: fetchFn,
        mode: 'live'
      }
      const outbound = { ...newStorylineOutbound(), matureFlag: false }

      await plotlinkPublish(outbound, config)

      const body = JSON.parse(fetchFn.mock.calls[0][1].body) as PlotLinkNewStorylineRequest
      expect(body.isNsfw).toBe(false)
    })

    it('defaults isNsfw to false when matureFlag is undefined', async () => {
      const fetchFn = mockFetch({ success: true })
      const config: PlotLinkPublishAdapterConfig = {
        indexEndpoint: 'https://plotlink.example/api/publish',
        signer: mockSigner(),
        fetch: fetchFn,
        mode: 'live'
      }
      const outbound = { ...newStorylineOutbound(), matureFlag: undefined }

      await plotlinkPublish(outbound, config)

      const body = JSON.parse(fetchFn.mock.calls[0][1].body) as PlotLinkNewStorylineRequest
      expect(body.isNsfw).toBe(false)
    })
  })

  describe('existing storyline', () => {
    it('sends storylineId and omits contentType for existing storylines', async () => {
      const fetchFn = mockFetch({
        success: true,
        storylineId: 'storyline-abc',
        plotId: 'plot-2',
        plotUrl: 'https://plotlink.example/plots/2'
      })
      const config: PlotLinkPublishAdapterConfig = {
        indexEndpoint: 'https://plotlink.example/api/publish',
        signer: mockSigner(),
        fetch: fetchFn,
        mode: 'live'
      }

      const result = await plotlinkPublish(existingStorylineOutbound(), config)

      expect(result.success).toBe(true)

      const body = JSON.parse(fetchFn.mock.calls[0][1].body) as PlotLinkExistingStorylineRequest
      expect(body.storylineId).toBe('storyline-abc')
      expect(body.isNsfw).toBe(false)
      expect(body.content).toContain('# Episode 2')
      expect(body.message).toMatch(/^PlotLink: Publish plot\nTimestamp: \d+$/)
      expect(body.signature).toBe('test-signature')
      expect('contentType' in body).toBe(false)
    })
  })

  describe('mock mode', () => {
    it('returns mock response without calling fetch or signer', async () => {
      const signer = mockSigner()
      const fetchFn = mockFetch({})
      const config: PlotLinkPublishAdapterConfig = {
        indexEndpoint: 'https://plotlink.example/api/publish',
        signer,
        fetch: fetchFn,
        mode: 'mock'
      }

      const result = await plotlinkPublish(newStorylineOutbound(), config)

      expect(result.success).toBe(true)
      expect(result.storylineId).toBeTruthy()
      expect(result.plotId).toBeTruthy()
      expect(result.plotUrl).toBeTruthy()
      expect(fetchFn).not.toHaveBeenCalled()
      expect(signer.sign).not.toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('returns error on non-ok HTTP response', async () => {
      const fetchFn = mockFetch({}, 500)
      const config: PlotLinkPublishAdapterConfig = {
        indexEndpoint: 'https://plotlink.example/api/publish',
        signer: mockSigner(),
        fetch: fetchFn,
        mode: 'live'
      }

      const result = await plotlinkPublish(newStorylineOutbound(), config)

      expect(result.success).toBe(false)
      expect(result.error).toContain('HTTP 500')
    })
  })

  describe('signer integration', () => {
    it('passes the signature message through PlotLinkSigner.sign', async () => {
      const signer = mockSigner()
      const fetchFn = mockFetch({ success: true })
      const config: PlotLinkPublishAdapterConfig = {
        indexEndpoint: 'https://plotlink.example/api/publish',
        signer,
        fetch: fetchFn,
        mode: 'live'
      }

      await plotlinkPublish(newStorylineOutbound(), config)

      const signFn = signer.sign as ReturnType<typeof vi.fn>
      expect(signFn).toHaveBeenCalledTimes(1)
      const msg = signFn.mock.calls[0][0] as string
      expect(msg).toMatch(/^PlotLink: Create storyline and publish plot\nTimestamp: \d+$/)
    })
  })
})

describe('createPlotLinkPublishFn', () => {
  it('returns a PublishFn-compatible function mapping to PublishRequestResult', async () => {
    const fetchFn = mockFetch({
      success: true,
      storylineId: 'sl-1',
      plotId: 'plot-1',
      plotUrl: 'https://plotlink.example/plots/1'
    })
    const config: PlotLinkPublishAdapterConfig = {
      indexEndpoint: 'https://plotlink.example/api/publish',
      signer: mockSigner(),
      fetch: fetchFn,
      mode: 'live'
    }

    const publishFn = createPlotLinkPublishFn(config)
    const result = await publishFn(newStorylineOutbound())

    expect(result.success).toBe(true)
    expect(result.publishId).toBe('plot-1')
    expect(result.storylineId).toBe('sl-1')
    expect(result.plotUrl).toBe('https://plotlink.example/plots/1')
    expect(result.isDryRun).toBe(false)
    expect(result.timestamp).toBeTruthy()
  })
})

describe('isNewStorylineRequest', () => {
  it('returns true for new storyline requests', () => {
    const req: PlotLinkNewStorylineRequest = {
      storylineTitle: 'Test',
      contentType: 'cartoon',
      isNsfw: false,
      content: '',
      imageCount: 1,
      imageUrls: [],
      message: '',
      signature: ''
    }
    expect(isNewStorylineRequest(req)).toBe(true)
  })

  it('returns false for existing storyline requests', () => {
    const req: PlotLinkExistingStorylineRequest = {
      storylineId: 'sl-1',
      isNsfw: false,
      content: '',
      imageCount: 1,
      imageUrls: [],
      message: '',
      signature: ''
    }
    expect(isNewStorylineRequest(req)).toBe(false)
  })
})
