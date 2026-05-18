import { describe, it, expect, vi } from 'vitest'
import {
  plotlinkPublish,
  createPlotLinkPublishFn,
  type PlotLinkPublishAdapterConfig,
  type PlotLinkSigner,
  type ContentCommitFn,
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

function mockCommitContent(): ContentCommitFn {
  return vi.fn().mockResolvedValue({ cid: 'bafytest123', contentHash: 'sha256-deadbeef' })
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
    commitContent: mockCommitContent(),
    mode: 'live',
    ...overrides
  }
}

describe('plotlinkPublish — new storyline', () => {
  it('calls only /api/index/storyline (genesis plot included) for new storylines', async () => {
    const fetchFn = mockFetch([
      {
        body: {
          success: true,
          storylineId: 'sl-new-1',
          plotId: 'plot-genesis',
          plotUrl: 'https://plotlink.example/plots/genesis'
        }
      }
    ])
    const config = liveConfig({ fetch: fetchFn })

    const result = await plotlinkPublish(newStorylineOutbound(), config)

    expect(result.success).toBe(true)
    expect(result.storylineId).toBe('sl-new-1')
    expect(result.plotId).toBe('plot-genesis')
    expect(result.plotUrl).toBe('https://plotlink.example/plots/genesis')

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('https://plotlink.example/api/index/storyline')

    const body = JSON.parse(init.body) as PlotLinkStorylineIndexRequest
    expect(body.storylineTitle).toBe('My Cartoon')
    expect(body.contentType).toBe('cartoon')
    expect(body.isNsfw).toBe(true)
    expect(body.content).toContain('# Episode 1')
    expect(body.imageCount).toBe(1)
    expect(body.txHash).toBe('tx-abc123')
    expect(body.message).toMatch(/^PlotLink: Create storyline and publish plot\nTimestamp: \d+$/)
    expect(body.signature).toBe('test-signature')
  })

  it('sends create-storyline transaction with content CID, title, and hash', async () => {
    const signer = mockSigner()
    const commitContent = mockCommitContent()
    const fetchFn = mockFetch([{ body: { success: true, storylineId: 'sl-1', plotId: 'p-1' } }])
    const config = liveConfig({ signer, commitContent, fetch: fetchFn })

    await plotlinkPublish(newStorylineOutbound(), config)

    const sendTx = signer.sendTransaction as ReturnType<typeof vi.fn>
    expect(sendTx).toHaveBeenCalledTimes(1)
    expect(sendTx.mock.calls[0][0]).toEqual({
      action: 'create-storyline',
      storylineId: undefined,
      title: 'My Cartoon',
      contentCid: 'bafytest123',
      contentHash: 'sha256-deadbeef'
    })
  })

  it('commits content before sending transaction', async () => {
    const commitContent = vi.fn().mockResolvedValue({ cid: 'cid-1', contentHash: 'hash-1' })
    const fetchFn = mockFetch([{ body: { success: true, storylineId: 'sl-1' } }])
    const config = liveConfig({ commitContent, fetch: fetchFn })
    const outbound = newStorylineOutbound()

    await plotlinkPublish(outbound, config)

    expect(commitContent).toHaveBeenCalledWith(outbound.markdown)
  })

  it('sets isNsfw false when matureFlag is undefined', async () => {
    const fetchFn = mockFetch([{ body: { success: true, storylineId: 'sl-1' } }])
    const outbound = { ...newStorylineOutbound(), matureFlag: undefined }
    const config = liveConfig({ fetch: fetchFn })

    await plotlinkPublish(outbound, config)

    const body = JSON.parse(fetchFn.mock.calls[0][1].body) as PlotLinkStorylineIndexRequest
    expect(body.isNsfw).toBe(false)
  })

  it('does NOT call /api/index/plot for new storylines', async () => {
    const fetchFn = mockFetch([{ body: { success: true, storylineId: 'sl-1', plotId: 'p-1' } }])
    const config = liveConfig({ fetch: fetchFn })

    await plotlinkPublish(newStorylineOutbound(), config)

    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(fetchFn.mock.calls[0][0]).not.toContain('/api/index/plot')
  })

  it('returns error if storyline indexing fails', async () => {
    const fetchFn = mockFetch([{ body: {}, status: 500 }])
    const config = liveConfig({ fetch: fetchFn })

    const result = await plotlinkPublish(newStorylineOutbound(), config)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Storyline creation failed')
  })
})

describe('plotlinkPublish — existing storyline', () => {
  it('calls only /api/index/plot for existing storylines', async () => {
    const fetchFn = mockFetch([
      { body: { success: true, plotId: 'plot-2', plotUrl: 'https://plotlink.example/plots/2' } }
    ])
    const config = liveConfig({ fetch: fetchFn })

    const result = await plotlinkPublish(existingStorylineOutbound(), config)

    expect(result.success).toBe(true)
    expect(result.storylineId).toBe('storyline-abc')
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

  it('sends chain-plot transaction with storylineId and content CID', async () => {
    const signer = mockSigner()
    const commitContent = mockCommitContent()
    const fetchFn = mockFetch([{ body: { success: true, plotId: 'p-1' } }])
    const config = liveConfig({ signer, commitContent, fetch: fetchFn })

    await plotlinkPublish(existingStorylineOutbound(), config)

    const sendTx = signer.sendTransaction as ReturnType<typeof vi.fn>
    expect(sendTx.mock.calls[0][0]).toEqual({
      action: 'chain-plot',
      storylineId: 'storyline-abc',
      title: 'Episode 2',
      contentCid: 'bafytest123',
      contentHash: 'sha256-deadbeef'
    })
  })

  it('returns error when plot indexing fails', async () => {
    const fetchFn = mockFetch([{ body: {}, status: 502 }])
    const config = liveConfig({ fetch: fetchFn })

    const result = await plotlinkPublish(existingStorylineOutbound(), config)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Plot indexing failed')
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

  it('does not call index routes when transaction fails', async () => {
    const signer = mockSigner()
    ;(signer.sendTransaction as ReturnType<typeof vi.fn>).mockResolvedValue({
      txHash: '',
      confirmed: false
    })
    const fetchFn = mockFetch([])
    const config = liveConfig({ signer, fetch: fetchFn })

    await plotlinkPublish(newStorylineOutbound(), config)

    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('plotlinkPublish — mock mode', () => {
  it('returns mock response without calling fetch, signer, or commitContent', async () => {
    const signer = mockSigner()
    const commitContent = mockCommitContent()
    const fetchFn = mockFetch([])
    const config: PlotLinkPublishAdapterConfig = {
      baseUrl: 'https://plotlink.example',
      signer,
      commitContent,
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
    expect(commitContent).not.toHaveBeenCalled()
  })
})

describe('createPlotLinkPublishFn', () => {
  it('returns a PublishFn-compatible function', async () => {
    const fetchFn = mockFetch([
      {
        body: {
          success: true,
          storylineId: 'sl-1',
          plotId: 'plot-1',
          plotUrl: 'https://plotlink.example/plots/1'
        }
      }
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
