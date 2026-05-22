import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { registerPublishHandlers, type PublishHandlerDeps } from '../ipc/publishHandlers'
import { registerProject, clearRegistry } from '../services/projectRegistry'
import { writeProjectMeta, createProjectMeta } from '../services/projectMeta'
import type { WalletSigner } from '../services/walletSigning'
import type { OWSCoreModule } from '../services/owsAdapter'
import type { PublishConfig, IpfsClient } from '../services/plotlinkPublish'
import type { PublishPreflightResult, PublishExecuteResult } from '../../shared/publishFlow'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn()
  },
  BrowserWindow: {
    getAllWindows: vi.fn().mockReturnValue([])
  }
}))

vi.mock('../services/plotlinkPublish', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    realPublish: vi.fn(),
    fetchCreationFee: vi.fn().mockRejectedValue(new Error('RPC not available in test')),
    createOWSViemSigner: vi.fn().mockReturnValue({
      sendTransaction: vi.fn(),
      waitForReceipt: vi.fn()
    }),
    createViemContractEncoder: vi.fn().mockReturnValue({
      encodeCreateStoryline: vi.fn(),
      encodeChainPlot: vi.fn(),
      decodePublishEvents: vi.fn()
    })
  }
})

function mockSigner(isMock = true): WalletSigner {
  return {
    isMockMode: vi.fn().mockReturnValue(isMock),
    sign: vi.fn(),
    getAddress: vi.fn().mockReturnValue('0xaddr')
  } as unknown as WalletSigner
}

// #235: the freshness guard calls `owsModule.listWallets` and refuses to
// sign if the active wallet's name isn't present. The default mock returns
// the common test wallet names so existing live-mode tests still pass.
// Stale-wallet regression tests override `listWallets` to return [] or to
// omit the active wallet's name on purpose.
//
// #240: the guard now also requires an EVM account address match. Each
// stock entry carries an account whose address equals `0xabc` — the
// address every live-mode test in this file sets on `walletState.wallet`.
const STOCK_VAULT_NAMES = [
  'pw-1',
  'plottoon-writer-1',
  'pw-recovery-test',
  'pw-fake',
  'plotlink-writer-main'
]
const STOCK_TEST_ADDRESS = '0xabc'
function makeStockEntries() {
  return STOCK_VAULT_NAMES.map((name) => ({
    id: `fake-id-${name}`,
    name,
    accounts: [
      {
        chainId: 'eip155:8453',
        address: STOCK_TEST_ADDRESS,
        derivationPath: "m/44'/60'/0'/0/0"
      }
    ],
    createdAt: '2026-05-22T00:00:00.000Z'
  }))
}

function mockOws(): OWSCoreModule {
  return {
    listWallets: vi.fn().mockReturnValue(makeStockEntries()),
    createWallet: vi.fn(),
    signMessage: vi.fn().mockReturnValue({ signature: '0xsig' }),
    signTransaction: vi.fn().mockReturnValue({ signature: '0xtxsig' })
  }
}

function mockConfig(): PublishConfig {
  return {
    rpcUrl: 'https://rpc.example',
    plotlinkBaseUrl: 'https://plotlink.example',
    storyFactoryAddress: '0x1234567890abcdef1234567890abcdef12345678',
    mcv2BondAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    creationFeeWei: '100000000000000',
    indexRetries: 1,
    indexRetryDelayMs: 0,
    indexInitialDelayMs: 0
  }
}

function mockIpfs(): IpfsClient {
  return {
    upload: vi.fn().mockResolvedValue({ cid: 'bafyipfs123' })
  }
}

let tmpDir: string

function createDeps(overrides?: Partial<PublishHandlerDeps>): PublishHandlerDeps {
  return {
    walletState: { wallet: null },
    signer: mockSigner(true),
    owsModule: mockOws(),
    vaultConfig: { chain: 'eip155:8453' },
    config: mockConfig(),
    ipfs: mockIpfs(),
    keccak: vi.fn().mockReturnValue('0x' + 'ab'.repeat(32)),
    fetchFn: vi.fn(),
    getWindow: vi.fn().mockReturnValue(null),
    resolvePlotDir: vi.fn().mockResolvedValue(tmpDir),
    ...overrides
  }
}

type IpcHandler = (...args: unknown[]) => unknown

function getHandler(channel: string): IpcHandler {
  const calls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls
  const match = calls.find((c: unknown[]) => c[0] === channel)
  if (!match) throw new Error(`No handler registered for ${channel}`)
  return match[1] as IpcHandler
}

const mockRequest = {
  action: 'create-storyline' as const,
  title: 'Test Story',
  markdown: '# Episode 1',
  projectId: 'proj-1',
  plotSlug: 'episode-1'
}

/**
 * Register a fake project on disk with `meta.wallet.address` set so the
 * #223 ownership guard passes for the active wallet's address. Tests that
 * run a live-mode publish path must call this before invoking the handler.
 *
 * Pass a different `walletAddress` to set up an intentional mismatch
 * scenario.
 */
async function registerStampedProject(walletAddress: string): Promise<string> {
  const projectRoot = path.join(tmpDir, 'project')
  await fs.mkdir(projectRoot, { recursive: true })
  await writeProjectMeta(
    projectRoot,
    createProjectMeta('Stamped Test Project', undefined, {
      address: walletAddress,
      source: 'plottoon-writer'
    })
  )
  return registerProject(projectRoot)
}

describe('publish:preflight', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plottoon-pubhandler-'))
  })

  it('returns ready in mock mode even without wallet', async () => {
    const deps = createDeps()
    registerPublishHandlers(deps)

    const handler = getHandler('publish:preflight')
    const result = (await handler()) as PublishPreflightResult

    expect(result.ready).toBe(true)
    expect(result.signerMode).toBe('mock')
    expect(result.errors).toEqual([])
  })

  it('returns errors in live mode without wallet', async () => {
    const deps = createDeps({ signer: mockSigner(false) })
    registerPublishHandlers(deps)

    const handler = getHandler('publish:preflight')
    const result = (await handler()) as PublishPreflightResult

    expect(result.ready).toBe(false)
    expect(result.signerMode).toBe('live')
    expect(result.errors).toContain('No wallet connected')
  })

  it('returns errors in live mode with zero StoryFactory address', async () => {
    const config = mockConfig()
    config.storyFactoryAddress = '0x0000000000000000000000000000000000000000'
    const deps = createDeps({
      signer: mockSigner(false),
      walletState: {
        wallet: {
          address: '0xabc',
          source: 'plottoon-writer',
          name: 'plottoon-writer-1',
          createdAt: '2026-05-18T00:00:00Z'
        }
      },
      config
    })
    registerPublishHandlers(deps)

    const handler = getHandler('publish:preflight')
    const result = (await handler()) as PublishPreflightResult

    expect(result.ready).toBe(false)
    expect(result.errors).toContain('PLOTLINK_STORY_FACTORY_ADDRESS is required for live publish')
  })

  it('returns errors in live mode with missing PlotLink base URL', async () => {
    const config = mockConfig()
    config.plotlinkBaseUrl = ''
    const deps = createDeps({
      signer: mockSigner(false),
      walletState: {
        wallet: {
          address: '0xabc',
          source: 'plottoon-writer',
          name: 'pw-1',
          createdAt: '2026-05-18T00:00:00Z'
        }
      },
      config
    })
    registerPublishHandlers(deps)

    const handler = getHandler('publish:preflight')
    const result = (await handler()) as PublishPreflightResult

    expect(result.ready).toBe(false)
    expect(result.errors).toContain('PLOTLINK_BASE_URL is required for live publish')
  })

  it('returns ready in live mode with wallet and config', async () => {
    const deps = createDeps({
      signer: mockSigner(false),
      walletState: {
        wallet: {
          address: '0xabc',
          source: 'plottoon-writer',
          name: 'plottoon-writer-1',
          createdAt: '2026-05-18T00:00:00Z'
        }
      }
    })
    registerPublishHandlers(deps)

    const handler = getHandler('publish:preflight')
    const result = (await handler()) as PublishPreflightResult

    expect(result.ready).toBe(true)
    expect(result.walletAddress).toBe('0xabc')
    expect(result.walletSource).toBe('plottoon-writer')
  })

  it('returns missing RPC URL error', async () => {
    const config = mockConfig()
    config.rpcUrl = ''
    const deps = createDeps({
      signer: mockSigner(false),
      walletState: {
        wallet: {
          address: '0xabc',
          source: 'plottoon-writer',
          name: 'pw-1',
          createdAt: '2026-05-18T00:00:00Z'
        }
      },
      config
    })
    registerPublishHandlers(deps)

    const handler = getHandler('publish:preflight')
    const result = (await handler()) as PublishPreflightResult

    expect(result.ready).toBe(false)
    expect(result.errors).toContain('BASE_RPC_URL is required for live publish')
  })

  it('rejects non-Base chain in live mode', async () => {
    const deps = createDeps({
      signer: mockSigner(false),
      walletState: {
        wallet: {
          address: '0xabc',
          source: 'plottoon-writer',
          name: 'pw-1',
          createdAt: '2026-05-18T00:00:00Z'
        }
      },
      vaultConfig: { chain: 'eip155:1' }
    })
    registerPublishHandlers(deps)

    const handler = getHandler('publish:preflight')
    const result = (await handler()) as PublishPreflightResult

    expect(result.ready).toBe(false)
    expect(result.errors.some((e: string) => e.includes('eip155:8453'))).toBe(true)
  })
})

describe('publish:execute', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    clearRegistry()
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plottoon-pubhandler-'))
  })

  it('rejects when not confirmed', async () => {
    const deps = createDeps()
    registerPublishHandlers(deps)

    const handler = getHandler('publish:execute')
    const result = (await handler({}, mockRequest, false)) as PublishExecuteResult

    expect(result.success).toBe(false)
    expect(result.error).toContain('requires explicit confirmation')
  })

  it('rejects non-Base chain in live execute', async () => {
    const deps = createDeps({
      signer: mockSigner(false),
      walletState: {
        wallet: {
          address: '0xabc',
          source: 'plottoon-writer',
          name: 'pw-1',
          createdAt: '2026-05-18T00:00:00Z'
        }
      },
      vaultConfig: { chain: 'eip155:1' }
    })
    registerPublishHandlers(deps)

    const handler = getHandler('publish:execute')
    const result = (await handler({}, mockRequest, true)) as PublishExecuteResult

    expect(result.success).toBe(false)
    expect(result.error).toContain('eip155:8453')
  })

  it('returns mock result in mock mode with estimating state', async () => {
    const mockWin = {
      isDestroyed: () => false,
      webContents: { send: vi.fn() }
    }
    const deps = createDeps({
      getWindow: vi.fn().mockReturnValue(mockWin)
    })
    registerPublishHandlers(deps)

    const handler = getHandler('publish:execute')
    const result = (await handler({}, mockRequest, true)) as PublishExecuteResult

    expect(result.success).toBe(true)
    expect(result.result).toBeDefined()
    expect(result.result!.txHash).toMatch(/^0x/)
    expect(result.result!.indexed).toBe(true)

    const progressStates = mockWin.webContents.send.mock.calls
      .filter((c: unknown[]) => c[0] === 'publish:progress')
      .map((c: unknown[]) => (c[1] as { state: string }).state)
    expect(progressStates).toContain('estimating')
    expect(progressStates).toContain('uploading')
    expect(progressStates).toContain('signing')
    expect(progressStates).toContain('broadcasting')
    expect(progressStates).toContain('confirming')
    expect(progressStates).toContain('indexing')
    expect(progressStates).toContain('done')
  })

  it('returns error in live mode without wallet', async () => {
    const deps = createDeps({ signer: mockSigner(false) })
    registerPublishHandlers(deps)

    const handler = getHandler('publish:execute')
    const result = (await handler({}, mockRequest, true)) as PublishExecuteResult

    expect(result.success).toBe(false)
    expect(result.error).toContain('No wallet connected')
  })

  it('returns error in live mode without StoryFactory address', async () => {
    const config = mockConfig()
    config.storyFactoryAddress = '0x0000000000000000000000000000000000000000'
    const deps = createDeps({
      signer: mockSigner(false),
      walletState: {
        wallet: {
          address: '0xabc',
          source: 'plottoon-writer',
          name: 'pw-1',
          createdAt: '2026-05-18T00:00:00Z'
        }
      },
      config
    })
    registerPublishHandlers(deps)

    const handler = getHandler('publish:execute')
    const result = (await handler({}, mockRequest, true)) as PublishExecuteResult

    expect(result.success).toBe(false)
    expect(result.error).toContain('PLOTLINK_STORY_FACTORY_ADDRESS is required')
  })

  it('returns error for create-storyline when fee fetch fails', async () => {
    const projectId = await registerStampedProject('0xabc')
    const config = mockConfig()
    config.creationFeeWei = undefined
    const deps = createDeps({
      signer: mockSigner(false),
      walletState: {
        wallet: {
          address: '0xabc',
          source: 'plottoon-writer',
          name: 'pw-1',
          createdAt: '2026-05-18T00:00:00Z'
        }
      },
      config
    })
    registerPublishHandlers(deps)

    const handler = getHandler('publish:execute')
    const result = (await handler({}, { ...mockRequest, projectId }, true)) as PublishExecuteResult

    expect(result.success).toBe(false)
    expect(result.error).toContain('Failed to fetch creation fee')
  })

  it('passes fetched creation fee to realPublish when config fee is undefined', async () => {
    const projectId = await registerStampedProject('0xabc')
    const { realPublish: realPublishMock, fetchCreationFee: fetchCreationFeeMock } =
      await import('../services/plotlinkPublish')
    ;(fetchCreationFeeMock as ReturnType<typeof vi.fn>).mockResolvedValue('777000000000000')
    ;(realPublishMock as ReturnType<typeof vi.fn>).mockResolvedValue({
      txHash: '0xfeetx',
      confirmed: true,
      storylineId: '200',
      plotIndex: 0,
      contentCid: 'bafyfee',
      contentHash: '0x' + 'dd'.repeat(32),
      gasCostWei: '21000000000000',
      authorAddress: '0xabc',
      indexed: true
    })

    const config = mockConfig()
    config.creationFeeWei = undefined
    const deps = createDeps({
      signer: mockSigner(false),
      walletState: {
        wallet: {
          address: '0xabc',
          source: 'plottoon-writer',
          name: 'pw-1',
          createdAt: '2026-05-18T00:00:00Z'
        }
      },
      config
    })
    registerPublishHandlers(deps)

    const handler = getHandler('publish:execute')
    const result = (await handler({}, { ...mockRequest, projectId }, true)) as PublishExecuteResult

    expect(result.success).toBe(true)
    expect(fetchCreationFeeMock).toHaveBeenCalledWith(config)
    const publishCall = (realPublishMock as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(publishCall[0].creationFeeWei).toBe('777000000000000')
  })

  it('persists published result to status file', async () => {
    const projectId = await registerStampedProject('0xabc')
    const { realPublish: realPublishMock } = await import('../services/plotlinkPublish')
    ;(realPublishMock as ReturnType<typeof vi.fn>).mockResolvedValue({
      txHash: '0xrealtx',
      confirmed: true,
      storylineId: '101',
      plotIndex: 0,
      contentCid: 'bafyreal',
      contentHash: '0x' + 'cc'.repeat(32),
      gasCostWei: '21000000000000',
      authorAddress: '0xabc',
      indexed: true
    })

    const deps = createDeps({
      signer: mockSigner(false),
      walletState: {
        wallet: {
          address: '0xabc',
          source: 'plottoon-writer',
          name: 'pw-1',
          createdAt: '2026-05-18T00:00:00Z'
        }
      }
    })
    registerPublishHandlers(deps)

    const handler = getHandler('publish:execute')
    const result = (await handler({}, { ...mockRequest, projectId }, true)) as PublishExecuteResult

    expect(result.success).toBe(true)
    expect(result.result!.txHash).toBe('0xrealtx')
    expect(result.result!.plotlinkUrl).toBe('https://plotlink.example/story/101')

    const statusRaw = await fs.readFile(path.join(tmpDir, '.publish-status.json'), 'utf-8')
    const status = JSON.parse(statusRaw)
    expect(status.plotState).toBe('published')
    expect(status.publishResult.txHash).toBe('0xrealtx')
    expect(status.publishResult.storylineId).toBe('101')
    expect(status.publishResult.walletAddress).toBe('0xabc')
  })

  it('persists published-not-indexed when tx succeeds but index fails', async () => {
    const projectId = await registerStampedProject('0xabc')
    const { realPublish: realPublishMock } = await import('../services/plotlinkPublish')
    ;(realPublishMock as ReturnType<typeof vi.fn>).mockResolvedValue({
      txHash: '0xrealtx',
      confirmed: true,
      storylineId: '101',
      plotIndex: 0,
      contentCid: 'bafyreal',
      contentHash: '0x' + 'cc'.repeat(32),
      gasCostWei: '21000000000000',
      authorAddress: '0xabc',
      indexed: false,
      indexError: 'Index failed after retries'
    })

    const deps = createDeps({
      signer: mockSigner(false),
      walletState: {
        wallet: {
          address: '0xabc',
          source: 'plottoon-writer',
          name: 'pw-1',
          createdAt: '2026-05-18T00:00:00Z'
        }
      }
    })
    registerPublishHandlers(deps)

    const handler = getHandler('publish:execute')
    const result = (await handler({}, { ...mockRequest, projectId }, true)) as PublishExecuteResult

    expect(result.success).toBe(true)
    expect(result.result!.indexed).toBe(false)

    const statusRaw = await fs.readFile(path.join(tmpDir, '.publish-status.json'), 'utf-8')
    const status = JSON.parse(statusRaw)
    expect(status.plotState).toBe('published-not-indexed')
    expect(status.publishResult.txHash).toBe('0xrealtx')
    expect(status.publishResult.indexError).toBe('Index failed after retries')
  })

  it('persists failed state when realPublish throws', async () => {
    const projectId = await registerStampedProject('0xabc')
    const { realPublish: realPublishMock } = await import('../services/plotlinkPublish')
    ;(realPublishMock as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('RPC connection refused')
    )

    const deps = createDeps({
      signer: mockSigner(false),
      walletState: {
        wallet: {
          address: '0xabc',
          source: 'plottoon-writer',
          name: 'pw-1',
          createdAt: '2026-05-18T00:00:00Z'
        }
      }
    })
    registerPublishHandlers(deps)

    const handler = getHandler('publish:execute')
    const result = (await handler({}, { ...mockRequest, projectId }, true)) as PublishExecuteResult

    expect(result.success).toBe(false)
    expect(result.error).toBe('RPC connection refused')

    const statusRaw = await fs.readFile(path.join(tmpDir, '.publish-status.json'), 'utf-8')
    const status = JSON.parse(statusRaw)
    expect(status.plotState).toBe('failed')
    expect(status.error).toBe('RPC connection refused')
  })
})

// #223: recovery handlers (retryIndex / markNotIndexed) now enforce project
// wallet ownership in both mock and live modes. Tests here pre-register a
// stamped fixture project owned by `RECOVERY_TEST_WALLET` and configure
// `walletState.wallet` to match, so the ownership guard passes for the
// happy path. Explicit mismatch coverage lives in publishWalletBinding.
const RECOVERY_TEST_WALLET = '0xabc'
let recoveryProjectId: string

function recoveryDeps(overrides?: Partial<PublishHandlerDeps>): PublishHandlerDeps {
  return createDeps({
    walletState: {
      wallet: {
        address: RECOVERY_TEST_WALLET,
        source: 'plottoon-writer',
        name: 'pw-recovery-test',
        createdAt: '2026-05-22T00:00:00.000Z'
      }
    },
    ...overrides
  })
}

describe('publish:retryIndex', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    clearRegistry()
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plottoon-pubhandler-'))
    recoveryProjectId = await registerStampedProject(RECOVERY_TEST_WALLET)
  })

  async function writeNotIndexedStatus(txHash = '0xtx123') {
    const status = {
      version: 1,
      plotState: 'published-not-indexed',
      error: 'Indexing failed',
      publishedAt: '2026-05-18T00:00:00Z',
      updatedAt: '2026-05-18T00:00:00Z',
      cuts: [],
      publishResult: {
        txHash,
        storylineId: '42',
        plotIndex: 1,
        contentCid: 'bafyabc',
        contentHash: '0xhash',
        authorAddress: '0xauthor',
        gasCostWei: '1000',
        plotlinkUrl: null,
        walletAddress: '0xwallet',
        walletSource: 'plottoon-writer',
        indexed: false,
        indexError: 'Index failed after retries'
      }
    }
    await fs.writeFile(
      path.join(tmpDir, '.publish-status.json'),
      JSON.stringify(status, null, 2),
      'utf-8'
    )
  }

  it('retries indexing and updates status on success', async () => {
    await writeNotIndexedStatus()
    const mockFetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true })
    })
    const deps = recoveryDeps({ fetchFn: mockFetchFn })
    registerPublishHandlers(deps)

    const handler = getHandler('publish:retryIndex')
    const result = (await handler(
      {},
      { projectId: recoveryProjectId, plotSlug: 'ep1', fallbackContent: '# Episode 1' }
    )) as {
      success: boolean
    }
    expect(result.success).toBe(true)

    const statusRaw = await fs.readFile(path.join(tmpDir, '.publish-status.json'), 'utf-8')
    const status = JSON.parse(statusRaw)
    expect(status.plotState).toBe('published')
    expect(status.publishResult.indexed).toBe(true)
    expect(status.publishResult.indexError).toBeNull()
  })

  it('rejects when plot is not published-not-indexed', async () => {
    const status = {
      version: 1,
      plotState: 'draft',
      error: null,
      publishedAt: null,
      updatedAt: '2026-05-18T00:00:00Z',
      cuts: [],
      publishResult: null
    }
    await fs.writeFile(
      path.join(tmpDir, '.publish-status.json'),
      JSON.stringify(status, null, 2),
      'utf-8'
    )

    const deps = recoveryDeps()
    registerPublishHandlers(deps)

    const handler = getHandler('publish:retryIndex')
    const result = (await handler(
      {},
      { projectId: recoveryProjectId, plotSlug: 'ep1', fallbackContent: '# Episode 1' }
    )) as {
      success: boolean
      error: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toContain('not in published-not-indexed')
  })

  it('blocks retry when txHash is missing', async () => {
    await writeNotIndexedStatus()
    const statusRaw = await fs.readFile(path.join(tmpDir, '.publish-status.json'), 'utf-8')
    const status = JSON.parse(statusRaw)
    status.publishResult.txHash = null
    await fs.writeFile(
      path.join(tmpDir, '.publish-status.json'),
      JSON.stringify(status, null, 2),
      'utf-8'
    )

    const deps = recoveryDeps()
    registerPublishHandlers(deps)

    const handler = getHandler('publish:retryIndex')
    const result = (await handler(
      {},
      { projectId: recoveryProjectId, plotSlug: 'ep1', fallbackContent: '# Episode 1' }
    )) as {
      success: boolean
      error: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Missing txHash')
  })

  it('updates indexError on retry failure', async () => {
    await writeNotIndexedStatus()
    const mockFetchFn = vi.fn().mockRejectedValue(new Error('Network error'))
    const deps = recoveryDeps({
      fetchFn: mockFetchFn,
      config: { ...mockConfig(), indexRetries: 0 }
    })
    registerPublishHandlers(deps)

    const handler = getHandler('publish:retryIndex')
    const result = (await handler(
      {},
      { projectId: recoveryProjectId, plotSlug: 'ep1', fallbackContent: '# Episode 1' }
    )) as {
      success: boolean
      error: string
    }
    expect(result.success).toBe(false)

    const statusRaw = await fs.readFile(path.join(tmpDir, '.publish-status.json'), 'utf-8')
    const status = JSON.parse(statusRaw)
    expect(status.plotState).toBe('published-not-indexed')
    expect(status.publishResult.txHash).toBe('0xtx123')
  })

  it('selects correct endpoint based on plot type', async () => {
    await writeNotIndexedStatus()
    const statusRaw = await fs.readFile(path.join(tmpDir, '.publish-status.json'), 'utf-8')
    const status = JSON.parse(statusRaw)
    status.publishResult.plotIndex = 2
    status.publishResult.storylineId = '42'
    await fs.writeFile(
      path.join(tmpDir, '.publish-status.json'),
      JSON.stringify(status, null, 2),
      'utf-8'
    )

    const mockFetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true })
    })
    const deps = recoveryDeps({ fetchFn: mockFetchFn })
    registerPublishHandlers(deps)

    const handler = getHandler('publish:retryIndex')
    await handler(
      {},
      { projectId: recoveryProjectId, plotSlug: 'ep1', fallbackContent: '# Episode 1' }
    )

    expect(mockFetchFn).toHaveBeenCalledWith(
      'https://plotlink.example/api/index/plot',
      expect.any(Object)
    )
  })

  it('blocks retry when fallbackContent is missing', async () => {
    await writeNotIndexedStatus()
    const deps = recoveryDeps()
    registerPublishHandlers(deps)

    const handler = getHandler('publish:retryIndex')
    const result = (await handler({}, { projectId: recoveryProjectId, plotSlug: 'ep1' })) as {
      success: boolean
      error: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Missing fallback content')
  })
})

describe('publish:markNotIndexed', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plottoon-pubhandler-'))
  })

  it('marks published plot as not-indexed preserving metadata', async () => {
    const status = {
      version: 1,
      plotState: 'published',
      error: null,
      publishedAt: '2026-05-18T00:00:00Z',
      updatedAt: '2026-05-18T00:00:00Z',
      cuts: [],
      publishResult: {
        txHash: '0xtx123',
        storylineId: '42',
        plotIndex: 1,
        contentCid: 'bafyabc',
        contentHash: '0xhash',
        authorAddress: '0xauthor',
        gasCostWei: '1000',
        plotlinkUrl: null,
        walletAddress: '0xwallet',
        walletSource: 'plottoon-writer',
        indexed: true,
        indexError: null
      }
    }
    await fs.writeFile(
      path.join(tmpDir, '.publish-status.json'),
      JSON.stringify(status, null, 2),
      'utf-8'
    )

    const deps = recoveryDeps()
    registerPublishHandlers(deps)

    const handler = getHandler('publish:markNotIndexed')
    const result = (await handler(
      {},
      { projectId: recoveryProjectId, plotSlug: 'ep1', reason: 'Bad metadata on PlotLink' }
    )) as { success: boolean }
    expect(result.success).toBe(true)

    const raw = await fs.readFile(path.join(tmpDir, '.publish-status.json'), 'utf-8')
    const updated = JSON.parse(raw)
    expect(updated.plotState).toBe('published-not-indexed')
    expect(updated.error).toBe('Bad metadata on PlotLink')
    expect(updated.publishResult.txHash).toBe('0xtx123')
    expect(updated.publishResult.contentCid).toBe('bafyabc')
    expect(updated.publishResult.indexed).toBe(false)
    expect(updated.publishResult.indexError).toBe('Bad metadata on PlotLink')
  })

  it('rejects for draft plots', async () => {
    const status = {
      version: 1,
      plotState: 'draft',
      error: null,
      publishedAt: null,
      updatedAt: '2026-05-18T00:00:00Z',
      cuts: [],
      publishResult: null
    }
    await fs.writeFile(
      path.join(tmpDir, '.publish-status.json'),
      JSON.stringify(status, null, 2),
      'utf-8'
    )

    const deps = recoveryDeps()
    registerPublishHandlers(deps)

    const handler = getHandler('publish:markNotIndexed')
    const result = (await handler(
      {},
      { projectId: recoveryProjectId, plotSlug: 'ep1', reason: 'test' }
    )) as {
      success: boolean
      error: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Can only mark published')
  })
})
