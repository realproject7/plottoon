import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { registerPublishHandlers, type PublishHandlerDeps } from '../ipc/publishHandlers'
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

function mockOws(): OWSCoreModule {
  return {
    listWallets: vi.fn().mockReturnValue([]),
    createWallet: vi.fn(),
    signMessage: vi.fn().mockReturnValue({ signature: '0xsig' }),
    signTransaction: vi.fn().mockReturnValue({ signature: '0xtxsig' })
  }
}

function mockConfig(): PublishConfig {
  return {
    rpcUrl: 'https://rpc.example',
    plotlinkBaseUrl: 'https://plotlink.example',
    contractAddress: '0x1234567890abcdef1234567890abcdef12345678',
    ipfsUploadUrl: 'https://ipfs.example/upload',
    creationFeeWei: '100000000000000',
    indexRetries: 1,
    indexRetryDelayMs: 0
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

describe('publish:preflight', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plottoon-pubhandler-'))
  })

  it('returns ready in mock mode even without wallet', () => {
    const deps = createDeps()
    registerPublishHandlers(deps)

    const handler = getHandler('publish:preflight')
    const result = handler() as PublishPreflightResult

    expect(result.ready).toBe(true)
    expect(result.signerMode).toBe('mock')
    expect(result.errors).toEqual([])
  })

  it('returns errors in live mode without wallet', () => {
    const deps = createDeps({ signer: mockSigner(false) })
    registerPublishHandlers(deps)

    const handler = getHandler('publish:preflight')
    const result = handler() as PublishPreflightResult

    expect(result.ready).toBe(false)
    expect(result.signerMode).toBe('live')
    expect(result.errors).toContain('No wallet connected')
  })

  it('returns errors in live mode with zero contract address', () => {
    const config = mockConfig()
    config.contractAddress = '0x0000000000000000000000000000000000000000'
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
    const result = handler() as PublishPreflightResult

    expect(result.ready).toBe(false)
    expect(result.errors).toContain('PlotLink contract address not configured')
  })

  it('returns errors in live mode with missing creation fee', () => {
    const config = mockConfig()
    config.creationFeeWei = ''
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
    const result = handler() as PublishPreflightResult

    expect(result.ready).toBe(false)
    expect(result.errors).toContain('Creation fee not configured')
  })

  it('returns ready in live mode with wallet and config', () => {
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
    const result = handler() as PublishPreflightResult

    expect(result.ready).toBe(true)
    expect(result.walletAddress).toBe('0xabc')
    expect(result.walletSource).toBe('plottoon-writer')
  })

  it('returns missing RPC URL error', () => {
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
    const result = handler() as PublishPreflightResult

    expect(result.ready).toBe(false)
    expect(result.errors).toContain('Base RPC URL not configured')
  })
})

describe('publish:execute', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
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

  it('returns error in live mode without contract address', async () => {
    const config = mockConfig()
    config.contractAddress = '0x0000000000000000000000000000000000000000'
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
    expect(result.error).toContain('contract address not configured')
  })

  it('returns error for create-storyline without creation fee', async () => {
    const config = mockConfig()
    config.creationFeeWei = ''
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
    expect(result.error).toContain('Creation fee not configured')
  })

  it('persists published result to status file', async () => {
    const { realPublish: realPublishMock } = await import('../services/plotlinkPublish')
    ;(realPublishMock as ReturnType<typeof vi.fn>).mockResolvedValue({
      txHash: '0xrealtx',
      confirmed: true,
      storylineId: '0xsl-id',
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
    const result = (await handler({}, mockRequest, true)) as PublishExecuteResult

    expect(result.success).toBe(true)
    expect(result.result!.txHash).toBe('0xrealtx')
    expect(result.result!.plotlinkUrl).toBe('https://plotlink.example/story/0xsl-id')

    const statusRaw = await fs.readFile(path.join(tmpDir, '.publish-status.json'), 'utf-8')
    const status = JSON.parse(statusRaw)
    expect(status.plotState).toBe('published')
    expect(status.publishResult.txHash).toBe('0xrealtx')
    expect(status.publishResult.storylineId).toBe('0xsl-id')
    expect(status.publishResult.walletAddress).toBe('0xabc')
  })

  it('persists published-not-indexed when tx succeeds but index fails', async () => {
    const { realPublish: realPublishMock } = await import('../services/plotlinkPublish')
    ;(realPublishMock as ReturnType<typeof vi.fn>).mockResolvedValue({
      txHash: '0xrealtx',
      confirmed: true,
      storylineId: '0xsl-id',
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
    const result = (await handler({}, mockRequest, true)) as PublishExecuteResult

    expect(result.success).toBe(true)
    expect(result.result!.indexed).toBe(false)

    const statusRaw = await fs.readFile(path.join(tmpDir, '.publish-status.json'), 'utf-8')
    const status = JSON.parse(statusRaw)
    expect(status.plotState).toBe('published-not-indexed')
    expect(status.publishResult.txHash).toBe('0xrealtx')
    expect(status.publishResult.indexError).toBe('Index failed after retries')
  })

  it('persists failed state when realPublish throws', async () => {
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
    const result = (await handler({}, mockRequest, true)) as PublishExecuteResult

    expect(result.success).toBe(false)
    expect(result.error).toBe('RPC connection refused')

    const statusRaw = await fs.readFile(path.join(tmpDir, '.publish-status.json'), 'utf-8')
    const status = JSON.parse(statusRaw)
    expect(status.plotState).toBe('failed')
    expect(status.error).toBe('RPC connection refused')
  })
})
