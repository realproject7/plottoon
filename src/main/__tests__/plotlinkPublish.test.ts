import { describe, it, expect, vi } from 'vitest'
import { encodeEventTopics, encodeAbiParameters } from 'viem'
import {
  realPublish,
  createPublishTransactionFn,
  createViemContractEncoder,
  createRealPublishDeps,
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

describe('createViemContractEncoder', () => {
  it('encodes createStoryline with real ABI encoding', () => {
    const encoder = createViemContractEncoder()
    const contentHash = '0x' + 'ab'.repeat(32)

    const calldata = encoder.encodeCreateStoryline('My Story', 'bafytest', contentHash, false)

    expect(calldata).toMatch(/^0x/)
    expect(calldata.length).toBeGreaterThan(10)
  })

  it('encodes chainPlot with real ABI encoding', () => {
    const encoder = createViemContractEncoder()
    const storylineId = '0x' + 'cd'.repeat(32)
    const contentHash = '0x' + 'ab'.repeat(32)

    const calldata = encoder.encodeChainPlot(storylineId, 'Episode 2', 'bafytest', contentHash)

    expect(calldata).toMatch(/^0x/)
    expect(calldata.length).toBeGreaterThan(10)
  })

  it('decodes StorylineCreated event from receipt logs', () => {
    const encoder = createViemContractEncoder()
    const storylineId = '0x' + 'aa'.repeat(32)

    const abi = [
      {
        type: 'event' as const,
        name: 'StorylineCreated' as const,
        inputs: [
          { name: 'storylineId' as const, type: 'bytes32' as const, indexed: true },
          { name: 'plotIndex' as const, type: 'uint256' as const, indexed: false }
        ]
      }
    ]

    const topics = encodeEventTopics({ abi, eventName: 'StorylineCreated', args: { storylineId } })
    const data = encodeAbiParameters([{ type: 'uint256' }], [BigInt(0)])

    const receipt: TransactionReceipt = {
      status: 'success',
      logs: [{ topics: [...topics] as string[], data }],
      gasUsed: '21000',
      effectiveGasPrice: '1000000000'
    }

    const decoded = encoder.decodePublishEvents(receipt)
    expect(decoded.storylineId).toBe(storylineId)
    expect(decoded.plotIndex).toBe(0)
  })

  it('decodes PlotChained event from receipt logs', () => {
    const encoder = createViemContractEncoder()
    const storylineId = '0x' + 'bb'.repeat(32)

    const abi = [
      {
        type: 'event' as const,
        name: 'PlotChained' as const,
        inputs: [
          { name: 'storylineId' as const, type: 'bytes32' as const, indexed: true },
          { name: 'plotIndex' as const, type: 'uint256' as const, indexed: false }
        ]
      }
    ]

    const topics = encodeEventTopics({ abi, eventName: 'PlotChained', args: { storylineId } })
    const data = encodeAbiParameters([{ type: 'uint256' }], [BigInt(5)])

    const receipt: TransactionReceipt = {
      status: 'success',
      logs: [{ topics: [...topics] as string[], data }],
      gasUsed: '21000',
      effectiveGasPrice: '1000000000'
    }

    const decoded = encoder.decodePublishEvents(receipt)
    expect(decoded.storylineId).toBe(storylineId)
    expect(decoded.plotIndex).toBe(5)
  })

  it('returns empty when no matching events in logs', () => {
    const encoder = createViemContractEncoder()

    const receipt: TransactionReceipt = {
      status: 'success',
      logs: [{ topics: ['0xdeadbeef'], data: '0x' }],
      gasUsed: '21000',
      effectiveGasPrice: '1000000000'
    }

    const decoded = encoder.decodePublishEvents(receipt)
    expect(decoded).toEqual({})
  })
})

describe('createRealPublishDeps', () => {
  it('wires OWS viem signer and viem contract encoder into deps', () => {
    const ows = mockOws()
    const ipfs = mockIpfs()
    const keccak = vi.fn().mockReturnValue('0x' + 'ab'.repeat(32))
    const fetchFn = mockFetch([{ ok: true, body: { success: true } }])
    const config = mockConfig()

    const deps = createRealPublishDeps(
      ows,
      'plottoon-writer-123',
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      'eip155:8453',
      undefined,
      ipfs,
      keccak,
      fetchFn,
      config
    )

    expect(deps.ows).toBe(ows)
    expect(deps.ipfs).toBe(ipfs)
    expect(deps.config).toBe(config)
    expect(deps.signer).toBeDefined()
    expect(deps.signer.sendTransaction).toBeInstanceOf(Function)
    expect(deps.signer.waitForReceipt).toBeInstanceOf(Function)
    expect(deps.encoder).toBeDefined()
    expect(deps.encoder.encodeCreateStoryline).toBeInstanceOf(Function)
    expect(deps.encoder.encodeChainPlot).toBeInstanceOf(Function)
    expect(deps.encoder.decodePublishEvents).toBeInstanceOf(Function)
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
