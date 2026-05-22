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

// Fake wallets only — never real addresses.
const WALLET_A = '0xaaaa000000000000000000000000000000000001'
const WALLET_B = '0xbbbb000000000000000000000000000000000002'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) }
}))

vi.mock('../services/plotlinkPublish', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    realPublish: vi.fn(),
    fetchCreationFee: vi.fn().mockResolvedValue('1'),
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

function mockSigner(isMock = false): WalletSigner {
  return {
    isMockMode: vi.fn().mockReturnValue(isMock),
    sign: vi.fn(),
    getAddress: vi.fn().mockReturnValue('0xaddr')
  } as unknown as WalletSigner
}

function mockOws(): OWSCoreModule {
  return {
    // #235 default vault contains both fake wallets so the freshness
    // guard passes for the happy path. Mismatch tests in this file
    // don't depend on the guard — they short-circuit on project
    // ownership (#223). The mid-flight wallet switch test uses
    // `pw-fake-b` as wallet B's name so it also has to be present.
    // #240: this file's `createDeps()` builds the wallet with a fixed
    // `name: 'pw-fake'` regardless of which test wallet is active, so
    // the `pw-fake` vault entry below carries accounts for BOTH
    // WALLET_A and WALLET_B. Real-world wallets have unique names per
    // address; this is a test-fixture convenience that lets the
    // freshness guard pass for either address so the suite can focus
    // on ownership-mismatch behavior (which is the point of these
    // tests).
    listWallets: vi.fn().mockReturnValue([
      {
        id: 'fake-id-a',
        name: 'pw-fake',
        accounts: [
          { chainId: 'eip155:8453', address: WALLET_A, derivationPath: "m/44'/60'/0'/0/0" },
          { chainId: 'eip155:8453', address: WALLET_B, derivationPath: "m/44'/60'/0'/0/1" }
        ],
        createdAt: '2026-05-22T00:00:00.000Z'
      },
      {
        id: 'fake-id-b',
        name: 'pw-fake-b',
        accounts: [
          { chainId: 'eip155:8453', address: WALLET_B, derivationPath: "m/44'/60'/0'/0/0" }
        ],
        createdAt: '2026-05-22T00:00:00.000Z'
      }
    ]),
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

function createDeps(activeWalletAddress: string | null, mockMode = false): PublishHandlerDeps {
  return {
    walletState: {
      wallet: activeWalletAddress
        ? {
            address: activeWalletAddress,
            source: 'plottoon-writer',
            name: 'pw-fake',
            createdAt: '2026-05-22T00:00:00.000Z'
          }
        : null
    },
    signer: mockSigner(mockMode),
    owsModule: mockOws(),
    vaultConfig: { chain: 'eip155:8453' },
    config: mockConfig(),
    ipfs: mockIpfs(),
    keccak: vi.fn().mockReturnValue('0x' + 'ab'.repeat(32)),
    fetchFn: vi.fn(),
    getWindow: vi.fn().mockReturnValue(null),
    resolvePlotDir: vi.fn().mockResolvedValue(tmpDir)
  }
}

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const calls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls
  const match = calls.find((c: unknown[]) => c[0] === channel)
  if (!match) throw new Error(`No handler registered for ${channel}`)
  return match[1] as (...args: unknown[]) => unknown
}

async function registerStampedProject(walletAddress: string, name = 'stamped'): Promise<string> {
  const root = path.join(tmpDir, name)
  await fs.mkdir(root, { recursive: true })
  await writeProjectMeta(
    root,
    createProjectMeta('Test Project', undefined, {
      address: walletAddress,
      source: 'plottoon-writer'
    })
  )
  return registerProject(root)
}

async function registerLegacyProject(name = 'legacy'): Promise<string> {
  const root = path.join(tmpDir, name)
  await fs.mkdir(root, { recursive: true })
  await writeProjectMeta(root, createProjectMeta('Legacy Project'))
  return registerProject(root)
}

beforeEach(async () => {
  vi.clearAllMocks()
  clearRegistry()
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plottoon-pubbind-'))
})

describe('publish:preflight wallet ownership (#223)', () => {
  it('surfaces a wallet-mismatch error when the project is owned by a different wallet', async () => {
    registerPublishHandlers(createDeps(WALLET_B))
    const projectId = await registerStampedProject(WALLET_A)
    const handler = getHandler('publish:preflight')
    const result = (await handler({}, projectId)) as PublishPreflightResult
    expect(result.ready).toBe(false)
    expect(result.errors.join(' ')).toMatch(/different wallet/i)
  })

  it('passes when the active wallet matches the project owner', async () => {
    registerPublishHandlers(createDeps(WALLET_A))
    const projectId = await registerStampedProject(WALLET_A)
    const handler = getHandler('publish:preflight')
    const result = (await handler({}, projectId)) as PublishPreflightResult
    expect(result.ready).toBe(true)
    expect(result.errors).toEqual([])
    // The active wallet is surfaced so the renderer can display it in the
    // confirmation UI without an extra IPC round-trip.
    expect(result.walletAddress).toBe(WALLET_A)
  })

  it('rejects a legacy unstamped project with a clear "assign first" message', async () => {
    registerPublishHandlers(createDeps(WALLET_A))
    const projectId = await registerLegacyProject()
    const handler = getHandler('publish:preflight')
    const result = (await handler({}, projectId)) as PublishPreflightResult
    expect(result.ready).toBe(false)
    expect(result.errors.join(' ')).toMatch(/no wallet ownership|assign/i)
  })

  it('rejects when no active wallet is selected', async () => {
    registerPublishHandlers(createDeps(null))
    const projectId = await registerStampedProject(WALLET_A)
    const handler = getHandler('publish:preflight')
    const result = (await handler({}, projectId)) as PublishPreflightResult
    expect(result.ready).toBe(false)
    expect(result.errors.join(' ')).toMatch(/no active wallet|no wallet connected/i)
  })

  it('omits the ownership check entirely when no projectId is supplied (legacy call shape)', async () => {
    registerPublishHandlers(createDeps(WALLET_A))
    const handler = getHandler('publish:preflight')
    // No projectId — preflight should report on wallet/config readiness only.
    const result = (await handler({})) as PublishPreflightResult
    expect(result.ready).toBe(true)
    expect(result.errors).toEqual([])
  })
})

describe('publish:execute wallet ownership (#223)', () => {
  const request = {
    action: 'create-storyline' as const,
    title: 'Story',
    markdown: '# Hello',
    projectId: 'will-be-replaced',
    plotSlug: 'ep-1'
  }

  it('blocks publish in live mode when the project belongs to a different wallet', async () => {
    registerPublishHandlers(createDeps(WALLET_B))
    const projectId = await registerStampedProject(WALLET_A)
    const handler = getHandler('publish:execute')
    const result = (await handler({}, { ...request, projectId }, true)) as PublishExecuteResult
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/different wallet/i)
    // realPublish must never run when ownership fails — no signing of A's
    // project with B's wallet.
    const { realPublish } = await import('../services/plotlinkPublish')
    expect(realPublish).not.toHaveBeenCalled()
  })

  it('blocks publish for a legacy unstamped project (#223 forbids implicit ownership)', async () => {
    registerPublishHandlers(createDeps(WALLET_A))
    const projectId = await registerLegacyProject()
    const handler = getHandler('publish:execute')
    const result = (await handler({}, { ...request, projectId }, true)) as PublishExecuteResult
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/no wallet ownership|assign/i)
  })

  it('runs publish when the active wallet matches the project (happy path)', async () => {
    const { realPublish } = await import('../services/plotlinkPublish')
    ;(realPublish as ReturnType<typeof vi.fn>).mockResolvedValue({
      txHash: '0xabc',
      confirmed: true,
      storylineId: '1',
      plotIndex: 0,
      contentCid: 'bafy',
      contentHash: '0x' + 'cc'.repeat(32),
      gasCostWei: '0',
      authorAddress: WALLET_A,
      indexed: true
    })
    registerPublishHandlers(createDeps(WALLET_A))
    const projectId = await registerStampedProject(WALLET_A)
    const handler = getHandler('publish:execute')
    const result = (await handler({}, { ...request, projectId }, true)) as PublishExecuteResult
    expect(result.success).toBe(true)
    expect(result.result?.walletAddress).toBe(WALLET_A)
  })

  it('a mid-flight wallet switch from A to B mid-test causes the second execute to fail', async () => {
    // Wallet A's project is registered. Two execute calls — the first under
    // A (passes ownership), the second under B (fails ownership). Mirrors
    // the user-flow: open confirmation under A, switch wallets in the side-
    // bar, then click Confirm. The second call must not sign.
    const projectId = await registerStampedProject(WALLET_A)
    const deps = createDeps(WALLET_A)
    registerPublishHandlers(deps)
    const handler = getHandler('publish:execute')

    const { realPublish } = await import('../services/plotlinkPublish')
    ;(realPublish as ReturnType<typeof vi.fn>).mockResolvedValue({
      txHash: '0xabc',
      confirmed: true,
      storylineId: '1',
      plotIndex: 0,
      contentCid: 'bafy',
      contentHash: '0x' + 'cc'.repeat(32),
      gasCostWei: '0',
      authorAddress: WALLET_A,
      indexed: true
    })

    const ok = (await handler({}, { ...request, projectId }, true)) as PublishExecuteResult
    expect(ok.success).toBe(true)

    // Simulate wallet switch by mutating the shared walletState in place —
    // the main-process source of truth.
    deps.walletState.wallet = {
      address: WALLET_B,
      source: 'plottoon-writer',
      name: 'pw-fake-b',
      createdAt: '2026-05-22T00:00:00.000Z'
    }

    const mismatched = (await handler({}, { ...request, projectId }, true)) as PublishExecuteResult
    expect(mismatched.success).toBe(false)
    expect(mismatched.error).toMatch(/different wallet/i)
  })
})

describe('recovery wallet ownership (#223)', () => {
  it('publish:retryIndex refuses when the active wallet is not the project owner', async () => {
    registerPublishHandlers(createDeps(WALLET_B))
    const projectId = await registerStampedProject(WALLET_A)
    const handler = getHandler('publish:retryIndex')
    const result = (await handler({}, { projectId, plotSlug: 'ep-1' })) as {
      success: boolean
      error?: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/different wallet/i)
  })

  it('publish:retryIndex refuses in MOCK mode too — recovery state cannot bleed even with no live signer (RE1)', async () => {
    // RE1 #223 finding: mock signer mode is the default runtime; if the
    // guard were live-only, a wallet B caller could flip wallet A's
    // .publish-status.json from `published-not-indexed` to `published` in
    // mock mode. The check now runs unconditionally.
    registerPublishHandlers(createDeps(WALLET_B, /* mockMode */ true))
    const projectId = await registerStampedProject(WALLET_A)
    const handler = getHandler('publish:retryIndex')
    const result = (await handler({}, { projectId, plotSlug: 'ep-1' })) as {
      success: boolean
      error?: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/different wallet/i)
  })

  it('publish:markNotIndexed refuses when the active wallet is not the project owner', async () => {
    registerPublishHandlers(createDeps(WALLET_B))
    const projectId = await registerStampedProject(WALLET_A)
    const handler = getHandler('publish:markNotIndexed')
    const result = (await handler(
      {},
      {
        projectId,
        plotSlug: 'ep-1',
        reason: 'manual'
      }
    )) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/different wallet/i)
  })

  it('publish:markNotIndexed refuses in MOCK mode too (RE1 #223)', async () => {
    registerPublishHandlers(createDeps(WALLET_B, /* mockMode */ true))
    const projectId = await registerStampedProject(WALLET_A)
    const handler = getHandler('publish:markNotIndexed')
    const result = (await handler({}, { projectId, plotSlug: 'ep-1', reason: 'manual' })) as {
      success: boolean
      error?: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/different wallet/i)
  })
})
