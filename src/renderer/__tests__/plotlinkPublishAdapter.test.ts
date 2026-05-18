import { describe, it, expect, vi } from 'vitest'
import {
  plotlinkPublish,
  createPlotLinkPublishFn,
  type PlotLinkPublishAdapterConfig,
  type PlotLinkSigner,
  type ContentCommitFn,
  type ContentHashFn,
  type PlotLinkStorylineIndexRequest,
  type PlotLinkPlotIndexRequest
} from '../plotlinkPublishAdapter'
import type { OutboundPublishRequest } from '../cartoonPublish'

function mockSigner(): PlotLinkSigner {
  return {
    sign: vi.fn().mockResolvedValue('test-signature'),
    sendTransaction: vi.fn().mockResolvedValue({
      txHash: 'tx-abc123',
      confirmed: true,
      storylineId: 'sl-from-tx',
      plotIndex: 0
    })
  }
}

function mockCommitContent(): ContentCommitFn {
  return vi.fn().mockResolvedValue({ cid: 'bafytest123', contentHash: '0xdeadbeef' })
}

function mockContentHash(): ContentHashFn {
  return vi.fn().mockReturnValue('0x' + 'ab'.repeat(32)) as unknown as ContentHashFn
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
    contentHash: mockContentHash(),
    mode: 'live',
    creationFeeWei: '1000000000000000',
    hasDeadline: true,
    ...overrides
  }
}

describe('plotlinkPublish — new storyline', () => {
  it('derives storylineId from transaction result, not index response', async () => {
    const fetchFn = mockFetch([{ body: { success: true } }])
    const config = liveConfig({ fetch: fetchFn })

    const result = await plotlinkPublish(newStorylineOutbound(), config)

    expect(result.success).toBe(true)
    expect(result.storylineId).toBe('sl-from-tx')
    expect(result.plotIndex).toBe(0)
    expect(result.txHash).toBe('tx-abc123')
  })

  it('calls only /api/index/storyline with correct fields', async () => {
    const fetchFn = mockFetch([{ body: { success: true } }])
    const config = liveConfig({ fetch: fetchFn })

    await plotlinkPublish(newStorylineOutbound(), config)

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('https://plotlink.example/api/index/storyline')

    const body = JSON.parse(init.body) as PlotLinkStorylineIndexRequest
    expect(body.storylineTitle).toBe('My Cartoon')
    expect(body.contentType).toBe('cartoon')
    expect(body.isNsfw).toBe('true')
    expect(body.content).toContain('# Episode 1')
    expect(body.imageCount).toBe(1)
    expect(body.txHash).toBe('tx-abc123')
    expect(body.message).toMatch(/^PlotLink: Create storyline and publish plot\nTimestamp: \d+$/)
    expect(body.signature).toBe('test-signature')
  })

  it('sends create-storyline transaction with creationFeeWei and hasDeadline', async () => {
    const signer = mockSigner()
    const fetchFn = mockFetch([{ body: { success: true } }])
    const config = liveConfig({ signer, fetch: fetchFn })

    await plotlinkPublish(newStorylineOutbound(), config)

    const sendTx = signer.sendTransaction as ReturnType<typeof vi.fn>
    expect(sendTx).toHaveBeenCalledTimes(1)
    const payload = sendTx.mock.calls[0][0]
    expect(payload.action).toBe('create-storyline')
    expect(payload.title).toBe('My Cartoon')
    expect(payload.contentCid).toBe('bafytest123')
    expect(payload.contentHash).toBe('0x' + 'ab'.repeat(32))
    expect(payload.creationFeeWei).toBe('1000000000000000')
    expect(payload.hasDeadline).toBe(true)
  })

  it('validates content hash is 0x-prefixed keccak256 bytes32', async () => {
    const badHash = vi.fn().mockReturnValue('sha256-not-valid') as unknown as ContentHashFn
    const config = liveConfig({ contentHash: badHash })

    const result = await plotlinkPublish(newStorylineOutbound(), config)

    expect(result.success).toBe(false)
    expect(result.error).toContain('keccak256 bytes32')
  })

  it('fails when transaction does not return storylineId', async () => {
    const signer: PlotLinkSigner = {
      sign: vi.fn().mockResolvedValue('sig'),
      sendTransaction: vi.fn().mockResolvedValue({
        txHash: 'tx-1',
        confirmed: true
      })
    }
    const fetchFn = mockFetch([{ body: { success: true } }])
    const config = liveConfig({ signer, fetch: fetchFn })

    const result = await plotlinkPublish(newStorylineOutbound(), config)

    expect(result.success).toBe(false)
    expect(result.error).toContain('storylineId')
  })

  it('commits content before sending transaction', async () => {
    const commitContent = vi.fn().mockResolvedValue({ cid: 'cid-1', contentHash: '0xaabb' })
    const fetchFn = mockFetch([{ body: { success: true } }])
    const config = liveConfig({ commitContent, fetch: fetchFn })
    const outbound = newStorylineOutbound()

    await plotlinkPublish(outbound, config)

    expect(commitContent).toHaveBeenCalledWith(outbound.markdown)
  })

  it('sets isNsfw false when matureFlag is undefined', async () => {
    const fetchFn = mockFetch([{ body: { success: true } }])
    const outbound = { ...newStorylineOutbound(), matureFlag: undefined }
    const config = liveConfig({ fetch: fetchFn })

    await plotlinkPublish(outbound, config)

    const body = JSON.parse(fetchFn.mock.calls[0][1].body) as PlotLinkStorylineIndexRequest
    expect(body.isNsfw).toBe('false')
  })

  it('does NOT call /api/index/plot for new storylines', async () => {
    const fetchFn = mockFetch([{ body: { success: true } }])
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
    expect(result.error).toContain('Storyline indexing failed')
  })
})

describe('plotlinkPublish — existing storyline', () => {
  it('derives plotIndex from transaction result, not index response', async () => {
    const signer: PlotLinkSigner = {
      sign: vi.fn().mockResolvedValue('sig'),
      sendTransaction: vi.fn().mockResolvedValue({
        txHash: 'tx-chain',
        confirmed: true,
        plotIndex: 3
      })
    }
    const fetchFn = mockFetch([{ body: { success: true } }])
    const config = liveConfig({ signer, fetch: fetchFn })

    const result = await plotlinkPublish(existingStorylineOutbound(), config)

    expect(result.success).toBe(true)
    expect(result.storylineId).toBe('storyline-abc')
    expect(result.plotIndex).toBe(3)
    expect(result.txHash).toBe('tx-chain')
  })

  it('calls only /api/index/plot with correct fields', async () => {
    const fetchFn = mockFetch([{ body: { success: true } }])
    const config = liveConfig({ fetch: fetchFn })

    await plotlinkPublish(existingStorylineOutbound(), config)

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('https://plotlink.example/api/index/plot')
    const body = JSON.parse(init.body) as PlotLinkPlotIndexRequest
    expect(body.storylineId).toBe('storyline-abc')
    expect(body.isNsfw).toBe('false')
    expect(body.content).toContain('# Episode 2')
    expect(body.txHash).toBe('tx-abc123')
    expect(body.message).toMatch(/^PlotLink: Publish plot\nTimestamp: \d+$/)
    expect('contentType' in body).toBe(false)
  })

  it('sends chain-plot transaction without creationFeeWei or hasDeadline', async () => {
    const signer = mockSigner()
    const fetchFn = mockFetch([{ body: { success: true } }])
    const config = liveConfig({ signer, fetch: fetchFn })

    await plotlinkPublish(existingStorylineOutbound(), config)

    const sendTx = signer.sendTransaction as ReturnType<typeof vi.fn>
    const payload = sendTx.mock.calls[0][0]
    expect(payload.action).toBe('chain-plot')
    expect(payload.storylineId).toBe('storyline-abc')
    expect(payload.creationFeeWei).toBeUndefined()
    expect(payload.hasDeadline).toBeUndefined()
  })

  it('fails when chain-plot transaction does not return plotIndex', async () => {
    const signer: PlotLinkSigner = {
      sign: vi.fn().mockResolvedValue('sig'),
      sendTransaction: vi.fn().mockResolvedValue({
        txHash: 'tx-no-index',
        confirmed: true
      })
    }
    const fetchFn = mockFetch([{ body: { success: true } }])
    const config = liveConfig({ signer, fetch: fetchFn })

    const result = await plotlinkPublish(existingStorylineOutbound(), config)

    expect(result.success).toBe(false)
    expect(result.error).toContain('plotIndex')
    expect(fetchFn).not.toHaveBeenCalled()
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
    const signer: PlotLinkSigner = {
      sign: vi.fn().mockResolvedValue('sig'),
      sendTransaction: vi.fn().mockResolvedValue({ txHash: 'tx-pending', confirmed: false })
    }
    const config = liveConfig({ signer })

    const result = await plotlinkPublish(newStorylineOutbound(), config)

    expect(result.success).toBe(false)
    expect(result.error).toBe('Transaction not confirmed')
  })

  it('does not call index routes when transaction fails', async () => {
    const signer: PlotLinkSigner = {
      sign: vi.fn().mockResolvedValue('sig'),
      sendTransaction: vi.fn().mockResolvedValue({ txHash: '', confirmed: false })
    }
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
      contentHash: mockContentHash(),
      fetch: fetchFn,
      mode: 'mock'
    }

    const result = await plotlinkPublish(newStorylineOutbound(), config)

    expect(result.success).toBe(true)
    expect(result.storylineId).toBeTruthy()
    expect(result.txHash).toBeTruthy()
    expect(fetchFn).not.toHaveBeenCalled()
    expect(signer.sign).not.toHaveBeenCalled()
    expect(signer.sendTransaction).not.toHaveBeenCalled()
    expect(commitContent).not.toHaveBeenCalled()
  })
})

describe('createPlotLinkPublishFn', () => {
  it('returns a PublishFn-compatible function deriving plotUrl from IDs', async () => {
    const fetchFn = mockFetch([{ body: { success: true } }])
    const config = liveConfig({ fetch: fetchFn })

    const publishFn = createPlotLinkPublishFn(config)
    const result = await publishFn(newStorylineOutbound())

    expect(result.success).toBe(true)
    expect(result.publishId).toBe('tx-abc123')
    expect(result.storylineId).toBe('sl-from-tx')
    expect(result.plotUrl).toBe('https://plotlink.example/storyline/sl-from-tx/plot/0')
    expect(result.isDryRun).toBe(false)
    expect(result.timestamp).toBeTruthy()
  })
})
