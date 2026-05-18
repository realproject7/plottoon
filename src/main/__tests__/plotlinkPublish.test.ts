import { describe, it, expect, vi } from 'vitest'
import {
  realPublish,
  createPublishTransactionFn,
  createOWSTransactionSigner,
  getDefaultPublishConfig,
  type PlotlinkPublishDeps,
  type PublishConfig,
  type TransactionSigner,
  type ContractEncoder,
  type IpfsClient,
  type TransactionReceipt
} from '../services/plotlinkPublish'
import type { OWSCoreModule } from '../services/owsAdapter'

function mockConfig(): PublishConfig {
  return {
    rpcUrl: 'https://rpc.example',
    plotlinkBaseUrl: 'https://plotlink.example',
    contractAddress: '0xcontract',
    ipfsUploadUrl: 'https://ipfs.example/upload',
    creationFeeWei: '100000000000000',
    indexRetries: 1,
    indexRetryDelayMs: 0
  }
}

function mockSigner(receipt?: Partial<TransactionReceipt>): TransactionSigner {
  return {
    sendTransaction: vi.fn().mockResolvedValue({ txHash: '0xtxhash' }),
    waitForReceipt: vi.fn().mockResolvedValue({
      status: 'success',
      logs: [],
      gasUsed: '21000',
      effectiveGasPrice: '1000000000',
      ...receipt
    })
  }
}

function mockEncoder(decoded?: { storylineId?: string; plotIndex?: number }): ContractEncoder {
  return {
    encodeCreateStoryline: vi.fn().mockReturnValue('0xencodedCreateStoryline'),
    encodeChainPlot: vi.fn().mockReturnValue('0xencodedChainPlot'),
    decodePublishEvents: vi.fn().mockReturnValue(decoded ?? {})
  }
}

function mockIpfs(): IpfsClient {
  return {
    upload: vi.fn().mockResolvedValue({ cid: 'bafyipfs123' })
  }
}

function mockOws(): OWSCoreModule {
  return {
    listWallets: vi.fn().mockReturnValue([]),
    createWallet: vi.fn(),
    signMessage: vi.fn().mockReturnValue({ signature: '0xsig' }),
    signTransaction: vi.fn().mockReturnValue({ signature: '0xtxsig' })
  }
}

function mockFetch(responses: Array<{ ok: boolean; body: unknown }>) {
  const fn = vi.fn()
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: r.ok,
      json: () => Promise.resolve(r.body)
    })
  }
  return fn
}

function createDeps(overrides?: Partial<PlotlinkPublishDeps>): PlotlinkPublishDeps {
  return {
    ows: mockOws(),
    signer: mockSigner(),
    encoder: mockEncoder(),
    ipfs: mockIpfs(),
    keccak: vi.fn().mockReturnValue('0x' + 'ab'.repeat(32)),
    fetch: mockFetch([{ ok: true, body: { success: true } }]),
    config: mockConfig(),
    ...overrides
  }
}

describe('realPublish — new storyline', () => {
  it('uploads content, encodes tx, signs via signer, indexes, and returns full result', async () => {
    const encoder = mockEncoder({ storylineId: '0xsl-new-id', plotIndex: 0 })
    const signer = mockSigner()
    const ipfs = mockIpfs()
    const fetchFn = mockFetch([{ ok: true, body: { success: true } }])
    const deps = createDeps({ signer, encoder, ipfs, fetch: fetchFn })

    const result = await realPublish(
      {
        action: 'create-storyline',
        title: 'My Story',
        contentCid: '',
        contentHash: '',
        creationFeeWei: '100000000000000',
        hasDeadline: false
      },
      '# Episode 1',
      '0xauthor',
      deps,
      { isNsfw: 'false', contentType: 'cartoon' }
    )

    expect(result.confirmed).toBe(true)
    expect(result.txHash).toBe('0xtxhash')
    expect(result.contentCid).toBe('bafyipfs123')
    expect(result.authorAddress).toBe('0xauthor')
    expect(result.indexed).toBe(true)
    expect(result.storylineId).toBe('0xsl-new-id')

    expect(ipfs.upload).toHaveBeenCalledWith('# Episode 1')
    expect(encoder.encodeCreateStoryline).toHaveBeenCalledWith(
      'My Story',
      'bafyipfs123',
      '0x' + 'ab'.repeat(32),
      false
    )
    expect(signer.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '0xcontract',
        data: '0xencodedCreateStoryline',
        value: '100000000000000'
      })
    )
    expect(encoder.decodePublishEvents).toHaveBeenCalled()

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url] = fetchFn.mock.calls[0]
    expect(url).toBe('https://plotlink.example/api/index/storyline')
  })

  it('preserves metadata when indexing fails', async () => {
    const encoder = mockEncoder({ storylineId: '0xsl-id', plotIndex: 0 })
    const signer = mockSigner()
    const fetchFn = mockFetch([
      { ok: false, body: {} },
      { ok: false, body: {} }
    ])
    const deps = createDeps({ signer, encoder, fetch: fetchFn })

    const result = await realPublish(
      {
        action: 'create-storyline',
        title: 'My Story',
        contentCid: '',
        contentHash: '',
        hasDeadline: true
      },
      '# Episode 1',
      '0xauthor',
      deps
    )

    expect(result.confirmed).toBe(true)
    expect(result.indexed).toBe(false)
    expect(result.indexError).toContain('failed after retries')
    expect(result.txHash).toBe('0xtxhash')
    expect(result.contentCid).toBe('bafyipfs123')
    expect(result.storylineId).toBe('0xsl-id')
  })
})

describe('realPublish — existing storyline (chain-plot)', () => {
  it('chains a plot without creation fee', async () => {
    const encoder = mockEncoder({ plotIndex: 3 })
    const signer = mockSigner()
    const fetchFn = mockFetch([{ ok: true, body: { success: true } }])
    const deps = createDeps({ signer, encoder, fetch: fetchFn })

    const result = await realPublish(
      {
        action: 'chain-plot',
        storylineId: 'sl-existing',
        title: 'Episode 3',
        contentCid: '',
        contentHash: ''
      },
      '# Episode 3',
      '0xauthor',
      deps
    )

    expect(result.confirmed).toBe(true)
    expect(result.storylineId).toBe('sl-existing')
    expect(result.plotIndex).toBe(3)
    expect(result.indexed).toBe(true)

    expect(encoder.encodeChainPlot).toHaveBeenCalled()
    expect(signer.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ to: '0xcontract', value: undefined })
    )

    const [url] = (deps.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://plotlink.example/api/index/plot')
  })
})

describe('realPublish — reverted transaction', () => {
  it('returns not-confirmed with metadata preserved', async () => {
    const signer = mockSigner({ status: 'reverted' })
    const deps = createDeps({ signer })

    const result = await realPublish(
      {
        action: 'create-storyline',
        title: 'Fail Story',
        contentCid: '',
        contentHash: ''
      },
      '# Fail',
      '0xauthor',
      deps
    )

    expect(result.confirmed).toBe(false)
    expect(result.indexed).toBe(false)
    expect(result.contentCid).toBe('bafyipfs123')
    expect(result.authorAddress).toBe('0xauthor')
  })
})

describe('createOWSTransactionSigner', () => {
  it('signs transaction via OWS before sending to RPC', async () => {
    const ows = mockOws()
    const rpcSender = mockSigner()

    const signer = createOWSTransactionSigner(ows, 'my-wallet', 'eip155:8453', 'pass', rpcSender)

    await signer.sendTransaction({
      to: '0xcontract',
      data: '0xcalldata',
      value: '1000'
    })

    expect(ows.signTransaction).toHaveBeenCalledWith(
      'my-wallet',
      'eip155:8453',
      '0xcalldata',
      'pass'
    )
    expect(rpcSender.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ data: '0xtxsig' })
    )
  })
})

describe('createPublishTransactionFn', () => {
  it('returns a function compatible with PublishTransactionResult', async () => {
    const encoder = mockEncoder({ storylineId: '0xsl-fn', plotIndex: 0 })
    const signer = mockSigner()
    const deps = createDeps({ signer, encoder })

    const txFn = createPublishTransactionFn(deps, 'my-wallet')

    const result = await txFn({
      action: 'create-storyline',
      title: 'Test',
      contentCid: 'bafytest',
      contentHash: '0x' + 'ab'.repeat(32),
      creationFeeWei: '100000000000000',
      hasDeadline: false
    })

    expect(result.txHash).toBe('0xtxhash')
    expect(result.confirmed).toBe(true)
    expect(result.storylineId).toBe('0xsl-fn')
    expect(encoder.encodeCreateStoryline).toHaveBeenCalled()
  })

  it('returns not confirmed for reverted transaction', async () => {
    const signer = mockSigner({ status: 'reverted' })
    const deps = createDeps({ signer })

    const txFn = createPublishTransactionFn(deps, 'my-wallet')

    const result = await txFn({
      action: 'chain-plot',
      storylineId: 'sl-1',
      title: 'Ep2',
      contentCid: 'bafytest',
      contentHash: '0x' + 'cd'.repeat(32)
    })

    expect(result.confirmed).toBe(false)
  })
})

describe('getDefaultPublishConfig', () => {
  it('returns config with Base RPC defaults', () => {
    const config = getDefaultPublishConfig()

    expect(config.rpcUrl).toBe('https://mainnet.base.org')
    expect(config.indexRetries).toBe(2)
    expect(config.creationFeeWei).toBeTruthy()
  })
})
