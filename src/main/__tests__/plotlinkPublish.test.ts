import { describe, it, expect, vi } from 'vitest'
import { encodeEventTopics, encodeAbiParameters, encodeFunctionData } from 'viem'
import {
  realPublish,
  createPublishTransactionFn,
  createViemContractEncoder,
  createRealPublishDeps,
  getDefaultPublishConfig,
  validatePublishConfig,
  slugify,
  generateUploadKey,
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
    storyFactoryAddress: '0xstoryfactory',
    mcv2BondAddress: '0xmcv2bond',
    creationFeeWei: '100000000000000',
    indexRetries: 1,
    indexRetryDelayMs: 0,
    indexInitialDelayMs: 0
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

    expect(ipfs.upload).toHaveBeenCalledWith('# Episode 1', expect.stringMatching(/^plotlink\//))
    expect(encoder.encodeCreateStoryline).toHaveBeenCalledWith(
      'My Story',
      'bafyipfs123',
      '0x' + 'ab'.repeat(32),
      false
    )
    expect(signer.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '0xstoryfactory',
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
      expect.objectContaining({ to: '0xstoryfactory', value: undefined })
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

  it('encodes chainPlot with numeric storylineId', () => {
    const encoder = createViemContractEncoder()
    const storylineId = '42'
    const contentHash = '0x' + 'ab'.repeat(32)

    const calldata = encoder.encodeChainPlot(storylineId, 'Episode 2', 'bafytest', contentHash)

    expect(calldata).toMatch(/^0x/)
    expect(calldata.length).toBeGreaterThan(10)
  })

  it('encodes chainPlot with viem parity for uint256 storylineId', () => {
    const encoder = createViemContractEncoder()
    const storylineId = '12345'
    const contentHash = '0x' + 'ab'.repeat(32)

    const calldata = encoder.encodeChainPlot(storylineId, 'Episode 2', 'bafytest', contentHash)

    const directEncoded = encodeFunctionData({
      abi: [
        {
          type: 'function',
          name: 'chainPlot',
          inputs: [
            { name: 'storylineId', type: 'uint256' },
            { name: 'title', type: 'string' },
            { name: 'cid', type: 'string' },
            { name: 'contentHash', type: 'bytes32' }
          ],
          outputs: [],
          stateMutability: 'nonpayable'
        }
      ],
      functionName: 'chainPlot',
      args: [BigInt(12345), 'Episode 2', 'bafytest', contentHash]
    })

    expect(calldata).toBe(directEncoded)
  })

  it('decodes StorylineCreated event with uint256 storylineId', () => {
    const encoder = createViemContractEncoder()
    const storylineIdNum = BigInt(42)

    const abi = [
      {
        type: 'event' as const,
        name: 'StorylineCreated' as const,
        inputs: [
          { name: 'storylineId' as const, type: 'uint256' as const, indexed: true },
          { name: 'writer' as const, type: 'address' as const, indexed: true },
          { name: 'tokenAddress' as const, type: 'address' as const, indexed: false },
          { name: 'title' as const, type: 'string' as const, indexed: false },
          { name: 'hasDeadline' as const, type: 'bool' as const, indexed: false },
          { name: 'openingCID' as const, type: 'string' as const, indexed: false },
          { name: 'openingHash' as const, type: 'bytes32' as const, indexed: false }
        ]
      }
    ]

    const writerAddr = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
    const tokenAddr = '0x0000000000000000000000000000000000000001'
    const openingHash = '0x' + 'ab'.repeat(32)

    const topics = encodeEventTopics({
      abi,
      eventName: 'StorylineCreated',
      args: { storylineId: storylineIdNum, writer: writerAddr }
    })
    const data = encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'string' },
        { type: 'bool' },
        { type: 'string' },
        { type: 'bytes32' }
      ],
      [tokenAddr, 'My Story', false, 'bafytest', openingHash as `0x${string}`]
    )

    const receipt: TransactionReceipt = {
      status: 'success',
      logs: [{ topics: [...topics] as string[], data }],
      gasUsed: '21000',
      effectiveGasPrice: '1000000000'
    }

    const decoded = encoder.decodePublishEvents(receipt)
    expect(decoded.storylineId).toBe('42')
    expect(decoded.plotIndex).toBe(0)
  })

  it('decodes PlotChained event with uint256 storylineId', () => {
    const encoder = createViemContractEncoder()
    const storylineIdNum = BigInt(99)
    const plotIndexNum = BigInt(5)

    const abi = [
      {
        type: 'event' as const,
        name: 'PlotChained' as const,
        inputs: [
          { name: 'storylineId' as const, type: 'uint256' as const, indexed: true },
          { name: 'plotIndex' as const, type: 'uint256' as const, indexed: true },
          { name: 'writer' as const, type: 'address' as const, indexed: true },
          { name: 'title' as const, type: 'string' as const, indexed: false },
          { name: 'contentCID' as const, type: 'string' as const, indexed: false },
          { name: 'contentHash' as const, type: 'bytes32' as const, indexed: false }
        ]
      }
    ]

    const writerAddr = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
    const contentHash = '0x' + 'ab'.repeat(32)

    const topics = encodeEventTopics({
      abi,
      eventName: 'PlotChained',
      args: { storylineId: storylineIdNum, plotIndex: plotIndexNum, writer: writerAddr }
    })
    const data = encodeAbiParameters(
      [{ type: 'string' }, { type: 'string' }, { type: 'bytes32' }],
      ['Episode 5', 'bafytest', contentHash as `0x${string}`]
    )

    const receipt: TransactionReceipt = {
      status: 'success',
      logs: [{ topics: [...topics] as string[], data }],
      gasUsed: '21000',
      effectiveGasPrice: '1000000000'
    }

    const decoded = encoder.decodePublishEvents(receipt)
    expect(decoded.storylineId).toBe('99')
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
  it('returns config with Base RPC defaults and plotlink-ows retry timing', () => {
    const config = getDefaultPublishConfig()

    expect(config.rpcUrl).toBe('https://mainnet.base.org')
    expect(config.indexRetries).toBe(10)
    expect(config.indexInitialDelayMs).toBe(8000)
    expect(config.indexRetryDelayMs).toBe(30000)
    expect(config.storyFactoryAddress).toBe('')
    expect(config.mcv2BondAddress).toBe('')
    expect(config.creationFeeWei).toBeUndefined()
    expect(config.plotlinkBaseUrl).toBe('https://plotlink.xyz')
  })
})

describe('validatePublishConfig', () => {
  it('returns no errors for valid config', () => {
    const errors = validatePublishConfig(mockConfig())
    expect(errors).toEqual([])
  })

  it('rejects zero-address StoryFactory', () => {
    const config = mockConfig()
    config.storyFactoryAddress = '0x0000000000000000000000000000000000000000'
    const errors = validatePublishConfig(config)
    expect(errors).toContain('PLOTLINK_STORY_FACTORY_ADDRESS is required for live publish')
  })

  it('rejects empty StoryFactory address', () => {
    const config = mockConfig()
    config.storyFactoryAddress = ''
    const errors = validatePublishConfig(config)
    expect(errors).toContain('PLOTLINK_STORY_FACTORY_ADDRESS is required for live publish')
  })

  it('rejects empty MCV2_BOND address', () => {
    const config = mockConfig()
    config.mcv2BondAddress = ''
    const errors = validatePublishConfig(config)
    expect(errors).toContain('MCV2_BOND_ADDRESS is required for live publish')
  })

  it('rejects empty RPC URL', () => {
    const config = mockConfig()
    config.rpcUrl = ''
    const errors = validatePublishConfig(config)
    expect(errors).toContain('BASE_RPC_URL is required for live publish')
  })

  it('rejects empty PlotLink base URL', () => {
    const config = mockConfig()
    config.plotlinkBaseUrl = ''
    const errors = validatePublishConfig(config)
    expect(errors).toContain('PLOTLINK_BASE_URL is required for live publish')
  })

  it('collects multiple errors', () => {
    const config = mockConfig()
    config.storyFactoryAddress = ''
    config.mcv2BondAddress = ''
    config.rpcUrl = ''
    config.plotlinkBaseUrl = ''
    const errors = validatePublishConfig(config)
    expect(errors).toHaveLength(4)
  })
})

describe('realPublish — indexing initial delay', () => {
  it('waits indexInitialDelayMs before first index attempt', async () => {
    const encoder = mockEncoder({ storylineId: '0xsl-id', plotIndex: 0 })
    const signer = mockSigner()
    const fetchFn = mockFetch([{ ok: true, body: { success: true } }])
    const config = { ...mockConfig(), indexInitialDelayMs: 50 }
    const deps = createDeps({ signer, encoder, fetch: fetchFn, config })

    const start = Date.now()
    await realPublish(
      {
        action: 'create-storyline',
        title: 'Story',
        contentCid: '',
        contentHash: '',
        hasDeadline: false
      },
      '# Ep',
      '0xauthor',
      deps
    )
    const elapsed = Date.now() - start

    expect(elapsed).toBeGreaterThanOrEqual(40)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('skips initial delay when indexInitialDelayMs is 0', async () => {
    const encoder = mockEncoder({ storylineId: '0xsl-id', plotIndex: 0 })
    const signer = mockSigner()
    const fetchFn = mockFetch([{ ok: true, body: { success: true } }])
    const config = { ...mockConfig(), indexInitialDelayMs: 0 }
    const deps = createDeps({ signer, encoder, fetch: fetchFn, config })

    const start = Date.now()
    await realPublish(
      {
        action: 'create-storyline',
        title: 'Story',
        contentCid: '',
        contentHash: '',
        hasDeadline: false
      },
      '# Ep',
      '0xauthor',
      deps
    )
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(50)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})

describe('realPublish — creation fee usage', () => {
  it('uses provided creationFeeWei as transaction value', async () => {
    const encoder = mockEncoder({ storylineId: '0xsl-id', plotIndex: 0 })
    const signer = mockSigner()
    const fetchFn = mockFetch([{ ok: true, body: { success: true } }])
    const deps = createDeps({ signer, encoder, fetch: fetchFn })

    await realPublish(
      {
        action: 'create-storyline',
        title: 'Story',
        contentCid: '',
        contentHash: '',
        creationFeeWei: '250000000000000',
        hasDeadline: false
      },
      '# Ep',
      '0xauthor',
      deps
    )

    expect(signer.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ value: '250000000000000' })
    )
  })

  it('sends no value for chain-plot action', async () => {
    const encoder = mockEncoder({ plotIndex: 3 })
    const signer = mockSigner()
    const fetchFn = mockFetch([{ ok: true, body: { success: true } }])
    const deps = createDeps({ signer, encoder, fetch: fetchFn })

    await realPublish(
      {
        action: 'chain-plot',
        storylineId: '42',
        title: 'Ep2',
        contentCid: '',
        contentHash: ''
      },
      '# Ep2',
      '0xauthor',
      deps
    )

    expect(signer.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ value: undefined })
    )
  })
})

describe('realPublish — cached index responses', () => {
  it('marks cached storyline index response as indexed', async () => {
    const encoder = mockEncoder({ storylineId: '0xsl-cached', plotIndex: 0 })
    const signer = mockSigner()
    const fetchFn = mockFetch([{ ok: true, body: { ok: true, cached: true } }])
    const deps = createDeps({ signer, encoder, fetch: fetchFn })

    const result = await realPublish(
      {
        action: 'create-storyline',
        title: 'Cached Story',
        contentCid: '',
        contentHash: '',
        hasDeadline: false
      },
      '# Cached',
      '0xauthor',
      deps,
      { isNsfw: 'false', contentType: 'cartoon' }
    )

    expect(result.indexed).toBe(true)
    expect(result.indexError).toBeUndefined()
    const [url] = fetchFn.mock.calls[0]
    expect(url).toContain('/api/index/storyline')
  })

  it('marks cached plot index response as indexed', async () => {
    const encoder = mockEncoder({ plotIndex: 2 })
    const signer = mockSigner()
    const fetchFn = mockFetch([{ ok: true, body: { ok: true, cached: true } }])
    const deps = createDeps({ signer, encoder, fetch: fetchFn })

    const result = await realPublish(
      {
        action: 'chain-plot',
        storylineId: '42',
        title: 'Cached Plot',
        contentCid: '',
        contentHash: ''
      },
      '# Cached Plot',
      '0xauthor',
      deps
    )

    expect(result.indexed).toBe(true)
    expect(result.indexError).toBeUndefined()
    const [url] = fetchFn.mock.calls[0]
    expect(url).toContain('/api/index/plot')
  })

  it('rejects response with ok:true but cached:false', async () => {
    const encoder = mockEncoder({ storylineId: '0xsl-id', plotIndex: 0 })
    const signer = mockSigner()
    const fetchFn = mockFetch([
      { ok: true, body: { ok: true, cached: false } },
      { ok: true, body: { ok: true, cached: false } }
    ])
    const deps = createDeps({ signer, encoder, fetch: fetchFn })

    const result = await realPublish(
      {
        action: 'create-storyline',
        title: 'Story',
        contentCid: '',
        contentHash: '',
        hasDeadline: false
      },
      '# Ep',
      '0xauthor',
      deps
    )

    expect(result.indexed).toBe(false)
    expect(result.indexError).toContain('failed')
  })
})

describe('fetchCreationFee reads MCV2_BOND not StoryFactory', () => {
  it('calls creationFee() on mcv2BondAddress', async () => {
    const bondAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const feeWei = BigInt(100000000000000)
    const encodedResult = '0x' + feeWei.toString(16).padStart(64, '0')

    const capturedBodies: unknown[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      capturedBodies.push(body)
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: encodedResult }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    })

    try {
      const { fetchCreationFee } = await import('../services/plotlinkPublish')
      const fee = await fetchCreationFee({
        rpcUrl: 'https://rpc.test',
        mcv2BondAddress: bondAddress
      })

      expect(fee).toBe('100000000000000')

      const ethCall = capturedBodies.find(
        (b: unknown) => (b as { method: string }).method === 'eth_call'
      ) as { params: [{ to: string; data: string }, string] }

      expect(ethCall).toBeDefined()
      expect(ethCall.params[0].to).toBe(bondAddress)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('realPublish sends tx to storyFactoryAddress', () => {
  it('sends create-storyline tx to storyFactoryAddress, not mcv2BondAddress', async () => {
    const encoder = mockEncoder({ storylineId: '0xsl', plotIndex: 0 })
    const signer = mockSigner()
    const fetchFn = mockFetch([{ ok: true, body: { success: true } }])
    const config = {
      ...mockConfig(),
      storyFactoryAddress: '0xstoryfactoryaddr',
      mcv2BondAddress: '0xmcv2bondaddr'
    }
    const deps = createDeps({ signer, encoder, fetch: fetchFn, config })

    await realPublish(
      {
        action: 'create-storyline',
        title: 'Story',
        contentCid: '',
        contentHash: '',
        creationFeeWei: '100000000000000',
        hasDeadline: false
      },
      '# Ep',
      '0xauthor',
      deps
    )

    expect(signer.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ to: '0xstoryfactoryaddr' })
    )
  })
})

describe('default retry constants match plotlink-ows', () => {
  it('defaults to 10 retries, 30s interval, 8s initial delay', () => {
    const config = getDefaultPublishConfig()
    expect(config.indexRetries).toBe(10)
    expect(config.indexRetryDelayMs).toBe(30000)
    expect(config.indexInitialDelayMs).toBe(8000)
  })
})

describe('upload body/response shape', () => {
  it('IpfsClient upload returns { cid } from provider', async () => {
    const ipfs = mockIpfs()
    const result = await ipfs.upload('# My Story', 'plotlink/storylines/test.json')
    expect(result).toEqual({ cid: 'bafyipfs123' })
  })

  it('upload is called with markdown content and generated key in realPublish', async () => {
    const encoder = mockEncoder({ storylineId: '0xsl', plotIndex: 0 })
    const signer = mockSigner()
    const ipfs = mockIpfs()
    const fetchFn = mockFetch([{ ok: true, body: { success: true } }])
    const deps = createDeps({ signer, encoder, ipfs, fetch: fetchFn })

    await realPublish(
      {
        action: 'create-storyline',
        title: 'Story',
        contentCid: '',
        contentHash: '',
        hasDeadline: false
      },
      '# Episode Content',
      '0xauthor',
      deps
    )

    expect(ipfs.upload).toHaveBeenCalledWith(
      '# Episode Content',
      expect.stringMatching(/^plotlink\/storylines\/\d+-story\.json$/)
    )
  })

  it('upload key for chain-plot uses plotlink/plots prefix', async () => {
    const encoder = mockEncoder({ storylineId: '42', plotIndex: 1 })
    const signer = mockSigner()
    const ipfs = mockIpfs()
    const fetchFn = mockFetch([{ ok: true, body: { success: true } }])
    const deps = createDeps({ signer, encoder, ipfs, fetch: fetchFn })

    await realPublish(
      {
        action: 'chain-plot',
        title: 'Chapter 2',
        contentCid: '',
        contentHash: '',
        storylineId: '42'
      },
      '# Chapter Content',
      '0xauthor',
      deps
    )

    expect(ipfs.upload).toHaveBeenCalledWith(
      '# Chapter Content',
      expect.stringMatching(/^plotlink\/plots\/42-\d+\.txt$/)
    )
  })

  it('upload URL derives from PLOTLINK_BASE_URL, not a separate IPFS URL', () => {
    const config = getDefaultPublishConfig()
    const expectedUploadUrl = `${config.plotlinkBaseUrl}/api/upload`
    expect(expectedUploadUrl).toBe('https://plotlink.xyz/api/upload')
  })

  it('upload body contains content and key, no auth token or secrets', async () => {
    const encoder = mockEncoder({ storylineId: '0xsl', plotIndex: 0 })
    const signer = mockSigner()
    const ipfs = mockIpfs()
    const fetchFn = mockFetch([{ ok: true, body: { success: true } }])
    const deps = createDeps({ signer, encoder, ipfs, fetch: fetchFn })

    await realPublish(
      {
        action: 'create-storyline',
        title: 'Test',
        contentCid: '',
        contentHash: '',
        hasDeadline: false
      },
      '# Content',
      '0xauthor',
      deps
    )

    const uploadCall = (ipfs.upload as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(uploadCall[0]).toBe('# Content')
    expect(uploadCall[1]).toMatch(/^plotlink\//)
    expect(uploadCall[1]).not.toContain('token')
    expect(uploadCall[1]).not.toContain('secret')
  })
})

describe('generateUploadKey', () => {
  it('generates storyline key with plotlink/storylines prefix and slugified title', () => {
    const key = generateUploadKey('create-storyline', 'My Amazing Story')
    expect(key).toMatch(/^plotlink\/storylines\/\d+-my-amazing-story\.json$/)
  })

  it('generates chain-plot key with plotlink/plots prefix and storylineId', () => {
    const key = generateUploadKey('chain-plot', 'Chapter 2', '42')
    expect(key).toMatch(/^plotlink\/plots\/42-\d+\.txt$/)
  })

  it('uses unknown when storylineId is missing for chain-plot', () => {
    const key = generateUploadKey('chain-plot', 'Chapter')
    expect(key).toMatch(/^plotlink\/plots\/unknown-\d+\.txt$/)
  })

  it('key never contains secrets or auth tokens', () => {
    const key = generateUploadKey('create-storyline', 'Test Story')
    expect(key).not.toContain('token')
    expect(key).not.toContain('secret')
    expect(key).not.toContain('auth')
  })
})

describe('slugify', () => {
  it('lowercases and replaces non-alphanumeric with hyphens', () => {
    expect(slugify('My Amazing Story!')).toBe('my-amazing-story')
  })

  it('trims leading/trailing hyphens', () => {
    expect(slugify('--hello--')).toBe('hello')
  })

  it('truncates to 60 characters', () => {
    const long = 'a'.repeat(100)
    expect(slugify(long).length).toBeLessThanOrEqual(60)
  })
})
