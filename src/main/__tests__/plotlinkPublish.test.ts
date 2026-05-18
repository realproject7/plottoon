import { describe, it, expect, vi } from 'vitest'
import {
  realPublish,
  createPublishTransactionFn,
  getDefaultPublishConfig,
  type PlotlinkPublishDeps,
  type PublishConfig,
  type RpcClient,
  type IpfsClient,
  type TransactionReceipt
} from '../services/plotlinkPublish'
import type { OWSCoreModule } from '../services/owsAdapter'

const STORYLINE_CREATED_TOPIC =
  '0x' +
  '0'.repeat(24) +
  'storyline_created'
    .split('')
    .map(() => 'a1')
    .join('')
    .slice(0, 40)
const PLOT_CHAINED_TOPIC =
  '0x' +
  '0'.repeat(24) +
  'plot_chained'
    .split('')
    .map(() => 'b2')
    .join('')
    .slice(0, 40)

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

function mockRpc(receipt?: Partial<TransactionReceipt>): RpcClient {
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
    rpc: mockRpc(),
    ipfs: mockIpfs(),
    keccak: vi.fn().mockReturnValue('0x' + 'ab'.repeat(32)),
    fetch: mockFetch([{ ok: true, body: { success: true } }]),
    config: mockConfig(),
    ...overrides
  }
}

describe('realPublish — new storyline', () => {
  it('uploads content, sends transaction, indexes, and returns full result', async () => {
    const receipt: TransactionReceipt = {
      status: 'success',
      logs: [{ topics: [STORYLINE_CREATED_TOPIC, '0xsl-new-id'], data: '0x0' }],
      gasUsed: '50000',
      effectiveGasPrice: '2000000000'
    }
    const rpc = mockRpc(receipt)
    const ipfs = mockIpfs()
    const fetchFn = mockFetch([{ ok: true, body: { success: true } }])
    const deps = createDeps({ rpc, ipfs, fetch: fetchFn })

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
    expect(result.gasCostWei).toBe('100000000000000')

    expect(ipfs.upload).toHaveBeenCalledWith('# Episode 1')
    expect(rpc.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ to: '0xcontract', value: '100000000000000' })
    )

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url] = fetchFn.mock.calls[0]
    expect(url).toBe('https://plotlink.example/api/index/storyline')
  })

  it('preserves metadata when indexing fails', async () => {
    const receipt: TransactionReceipt = {
      status: 'success',
      logs: [{ topics: [STORYLINE_CREATED_TOPIC, '0xsl-id'], data: '0x0' }],
      gasUsed: '50000',
      effectiveGasPrice: '2000000000'
    }
    const rpc = mockRpc(receipt)
    const fetchFn = mockFetch([
      { ok: false, body: {} },
      { ok: false, body: {} }
    ])
    const deps = createDeps({ rpc, fetch: fetchFn })

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
    const receipt: TransactionReceipt = {
      status: 'success',
      logs: [{ topics: [PLOT_CHAINED_TOPIC], data: '0x3' }],
      gasUsed: '40000',
      effectiveGasPrice: '1000000000'
    }
    const rpc = mockRpc(receipt)
    const fetchFn = mockFetch([{ ok: true, body: { success: true } }])
    const deps = createDeps({ rpc, fetch: fetchFn })

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

    expect(rpc.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ to: '0xcontract', value: undefined })
    )

    const [url] = (deps.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://plotlink.example/api/index/plot')
  })
})

describe('realPublish — reverted transaction', () => {
  it('returns not-confirmed with metadata preserved', async () => {
    const rpc = mockRpc({ status: 'reverted' })
    const deps = createDeps({ rpc })

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

describe('createPublishTransactionFn', () => {
  it('returns a function compatible with PublishTransactionResult', async () => {
    const receipt: TransactionReceipt = {
      status: 'success',
      logs: [{ topics: [STORYLINE_CREATED_TOPIC, '0xsl-fn'], data: '0x0' }],
      gasUsed: '50000',
      effectiveGasPrice: '1000000000'
    }
    const rpc = mockRpc(receipt)
    const deps = createDeps({ rpc })

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
  })

  it('returns not confirmed for reverted transaction', async () => {
    const rpc = mockRpc({ status: 'reverted' })
    const deps = createDeps({ rpc })

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
