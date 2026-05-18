import { describe, it, expect, vi } from 'vitest'
import {
  plotlinkPublish,
  createPlotLinkPublishFn,
  type PlotLinkPublishAdapterConfig,
  type PlotLinkSigner,
  type PlotLinkStorylineIndexRequest,
  type PlotLinkPlotIndexRequest
} from '../plotlinkPublishAdapter'
import type { OutboundPublishRequest } from '../cartoonPublish'

function mockSigner(): PlotLinkSigner {
  return {
    sign: vi.fn().mockResolvedValue('test-signature'),
    sendTransaction: vi.fn().mockResolvedValue({ txHash: 'tx-abc123', confirmed: true })
  }
}

function mockFetch(responses: Array<{ body: unknown; status?: number }>) {
  const fn = vi.fn()
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: (r.status ?? 200) >= 200 && (r.status ?? 200) < 300,
      status: r.status ?? 200,
      json: () => Promise.resolve(r.body)
    })
  }
  return fn
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

function liveConfig(
  overrides: Partial<PlotLinkPublishAdapterConfig> = {}
): PlotLinkPublishAdapterConfig {
  return {
    baseUrl: 'https://plotlink.example',
    signer: mockSigner(),
    mode: 'live',
    ...overrides
  }
}

describe('plotlinkPublish — new storyline', () => {
  it('calls /api/index/storyline then /api/index/plot with correct fields', async () => {
    const fetchFn = mockFetch([
      { body: { success: true, storylineId: 'sl-new-1' } },
      { body: { success: true, plotId: 'plot-1', plotUrl: 'https://plotlink.example/plots/1' } }
    ])
    const config = liveConfig({ fetch: fetchFn })

    const result = await plotlinkPublish(newStorylineOutbound(), config)

    expect(result.success).toBe(true)
    expect(result.storylineId).toBe('sl-new-1')
    expect(result.plotId).toBe('plot-1')

    expect(fetchFn).toHaveBeenCalledTimes(2)

    const [slUrl, slInit] = fetchFn.mock.calls[0]
    expect(slUrl).toBe('https://plotlink.example/api/index/storyline')
    const slBody = JSON.parse(slInit.body) as PlotLinkStorylineIndexRequest
    expect(slBody.storylineTitle).toBe('My Cartoon')
    expect(slBody.contentType).toBe('cartoon')
    expect(slBody.isNsfw).toBe(true)
    expect(slBody.txHash).toBe('tx-abc123')
    expect(slBody.message).toMatch(/^PlotLink: Create storyline and publish plot\nTimestamp: \d+$/)
    expect(slBody.signature).toBe('test-signature')

    const [plotUrl, plotInit] = fetchFn.mock.calls[1]
    expect(plotUrl).toBe('https://plotlink.example/api/index/plot')
    const plotBody = JSON.parse(plotInit.body) as PlotLinkPlotIndexRequest
    expect(plotBody.storylineId).toBe('sl-new-1')
    expect(plotBody.content).toContain('# Episode 1')
    expect(plotBody.txHash).toBe('tx-abc123')
  })

  it('sends create-storyline transaction with content hash', async () => {
    const signer = mockSigner()
    const fetchFn = mockFetch([
      { body: { success: true, storylineId: 'sl-1' } },
      { body: { success: true, plotId: 'p-1' } }
    ])
    const config = liveConfig({ signer, fetch: fetchFn })

    await plotlinkPublish(newStorylineOutbound(), config)

    const sendTx = signer.sendTransaction as ReturnType<typeof vi.fn>
    expect(sendTx).toHaveBeenCalledTimes(1)
    expect(sendTx.mock.calls[0][0].action).toBe('create-storyline')
    expect(sendTx.mock.calls[0][0].contentHash).toMatch(/^content-/)
  })

  it('sets isNsfw false when matureFlag is undefined', async () => {
    const fetchFn = mockFetch([
      { body: { success: true, storylineId: 'sl-1' } },
      { body: { success: true, plotId: 'p-1' } }
    ])
    const outbound = { ...newStorylineOutbound(), matureFlag: undefined }
    const config = liveConfig({ fetch: fetchFn })

    await plotlinkPublish(outbound, config)

    const slBody = JSON.parse(fetchFn.mock.calls[0][1].body) as PlotLinkStorylineIndexRequest
    expect(slBody.isNsfw).toBe(false)
  })

  it('returns error if storyline creation fails', async () => {
    const fetchFn = mockFetch([{ body: {}, status: 500 }])
    const config = liveConfig({ fetch: fetchFn })

    const result = await plotlinkPublish(newStorylineOutbound(), config)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Storyline creation failed')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})

describe('plotlinkPublish — existing storyline', () => {
  it('skips /api/index/storyline and calls /api/index/plot directly', async () => {
    const fetchFn = mockFetch([
      { body: { success: true, plotId: 'plot-2', plotUrl: 'https://plotlink.example/plots/2' } }
    ])
    const config = liveConfig({ fetch: fetchFn })

    const result = await plotlinkPublish(existingStorylineOutbound(), config)

    expect(result.success).toBe(true)
    expect(fetchFn).toHaveBeenCalledTimes(1)

    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('https://plotlink.example/api/index/plot')
    const body = JSON.parse(init.body) as PlotLinkPlotIndexRequest
    expect(body.storylineId).toBe('storyline-abc')
    expect(body.isNsfw).toBe(false)
    expect(body.content).toContain('# Episode 2')
    expect(body.txHash).toBe('tx-abc123')
    expect(body.message).toMatch(/^PlotLink: Publish plot\nTimestamp: \d+$/)
    expect('contentType' in body).toBe(false)
  })

  it('sends publish-plot transaction action for existing storyline', async () => {
    const signer = mockSigner()
    const fetchFn = mockFetch([{ body: { success: true, plotId: 'p-1' } }])
    const config = liveConfig({ signer, fetch: fetchFn })

    await plotlinkPublish(existingStorylineOutbound(), config)

    const sendTx = signer.sendTransaction as ReturnType<typeof vi.fn>
    expect(sendTx.mock.calls[0][0].action).toBe('publish-plot')
    expect(sendTx.mock.calls[0][0].storylineId).toBe('storyline-abc')
  })
})

describe('plotlinkPublish — transaction handling', () => {
  it('returns error if transaction is not confirmed', async () => {
    const signer = mockSigner()
    ;(signer.sendTransaction as ReturnType<typeof vi.fn>).mockResolvedValue({
      txHash: 'tx-pending',
      confirmed: false
    })
    const config = liveConfig({ signer })

    const result = await plotlinkPublish(newStorylineOutbound(), config)

    expect(result.success).toBe(false)
    expect(result.error).toBe('Transaction not confirmed')
  })
})

describe('plotlinkPublish — mock mode', () => {
  it('returns mock response without calling fetch or signer', async () => {
    const signer = mockSigner()
    const fetchFn = mockFetch([])
    const config: PlotLinkPublishAdapterConfig = {
      baseUrl: 'https://plotlink.example',
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
    expect(signer.sendTransaction).not.toHaveBeenCalled()
  })
})

describe('plotlinkPublish — error handling', () => {
  it('returns error when plot indexing fails', async () => {
    const fetchFn = mockFetch([
      { body: { success: true, storylineId: 'sl-1' } },
      { body: {}, status: 502 }
    ])
    const config = liveConfig({ fetch: fetchFn })

    const result = await plotlinkPublish(newStorylineOutbound(), config)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Plot indexing failed')
  })
})

describe('createPlotLinkPublishFn', () => {
  it('returns a PublishFn-compatible function mapping to PublishRequestResult', async () => {
    const fetchFn = mockFetch([
      { body: { success: true, storylineId: 'sl-1' } },
      { body: { success: true, plotId: 'plot-1', plotUrl: 'https://plotlink.example/plots/1' } }
    ])
    const config = liveConfig({ fetch: fetchFn })

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
