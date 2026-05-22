import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'
import { registerRoyaltyHandlers, type RoyaltyHandlerDeps } from '../ipc/royaltyHandlers'
import type { RoyaltyClaimConfig } from '../services/royaltyClaim'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn()
  },
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/plottoon-test')
  }
}))

vi.mock('../services/royaltyClaim', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    readRoyaltyInfo: vi.fn(),
    executeRoyaltyClaim: vi.fn()
  }
})

vi.mock('../services/royaltyClaimStatus', () => ({
  readClaimHistory: vi.fn().mockResolvedValue({ claims: [] }),
  appendClaimRecord: vi.fn().mockResolvedValue(undefined)
}))

type IpcHandler = (...args: unknown[]) => unknown

function getHandler(channel: string): IpcHandler {
  const calls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls
  const match = calls.find((c: unknown[]) => c[0] === channel)
  if (!match) throw new Error(`No handler registered for ${channel}`)
  return match[1] as IpcHandler
}

function mockConfig(): RoyaltyClaimConfig {
  return {
    rpcUrl: 'https://rpc.example',
    mcv2BondAddress: '0x1234567890abcdef1234567890abcdef12345678',
    plotTokenAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
  }
}

// #235: the freshness guard calls `owsModule.listWallets`. Default mock
// returns the common test wallet names so existing live-mode tests pass.
// Stale-wallet regression tests override `listWallets` to return [].
const STOCK_ROYALTY_VAULT_NAMES = ['pw-1', 'pw-fake', 'plottoon-writer-1']
function makeStockRoyaltyEntries() {
  return STOCK_ROYALTY_VAULT_NAMES.map((name) => ({
    id: `fake-id-${name}`,
    name,
    accounts: [],
    createdAt: '2026-05-22T00:00:00.000Z'
  }))
}

function createDeps(overrides?: Partial<RoyaltyHandlerDeps>): RoyaltyHandlerDeps {
  return {
    walletState: { wallet: null },
    owsModule: {
      listWallets: vi.fn().mockReturnValue(makeStockRoyaltyEntries()),
      createWallet: vi.fn(),
      signMessage: vi.fn().mockReturnValue({ signature: '0xsig' }),
      signTransaction: vi.fn().mockReturnValue({ signature: '0xtxsig' })
    },
    vaultConfig: { chain: 'eip155:8453' },
    royaltyConfig: mockConfig(),
    signerMode: 'mock',
    getWindow: vi.fn().mockReturnValue(null),
    ...overrides
  }
}

describe('royalty:info', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null info when no wallet connected', async () => {
    const deps = createDeps()
    registerRoyaltyHandlers(deps)
    const handler = getHandler('royalty:info')
    const result = (await handler()) as { info: null; error: null }
    expect(result.info).toBeNull()
    expect(result.error).toBeNull()
  })

  it('returns null info when reserve token is zero address', async () => {
    const config = mockConfig()
    config.plotTokenAddress = '0x0000000000000000000000000000000000000000'
    const deps = createDeps({
      walletState: {
        wallet: {
          address: '0xabc',
          source: 'plottoon-writer',
          name: 'pw-1',
          createdAt: '2026-05-18T00:00:00Z'
        }
      },
      royaltyConfig: config
    })
    registerRoyaltyHandlers(deps)
    const handler = getHandler('royalty:info')
    const result = (await handler()) as { info: null; error: null }
    expect(result.info).toBeNull()
  })

  it('returns mock zero royalty in mock mode', async () => {
    const deps = createDeps({
      walletState: {
        wallet: {
          address: '0xabc',
          source: 'plottoon-writer',
          name: 'pw-1',
          createdAt: '2026-05-18T00:00:00Z'
        }
      }
    })
    registerRoyaltyHandlers(deps)
    const handler = getHandler('royalty:info')
    const result = (await handler()) as { info: { earnedWei: string }; error: null }
    expect(result.info).toBeDefined()
    expect(result.info.earnedWei).toBe('0')
    expect(result.error).toBeNull()
  })

  it('reads live royalty info when in live mode', async () => {
    const { readRoyaltyInfo } = await import('../services/royaltyClaim')
    ;(readRoyaltyInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
      earnedWei: '500000',
      claimedWei: '100000',
      unclaimedWei: '400000',
      reserveToken: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
    })

    const deps = createDeps({
      signerMode: 'live',
      walletState: {
        wallet: {
          address: '0xabc',
          source: 'plottoon-writer',
          name: 'pw-1',
          createdAt: '2026-05-18T00:00:00Z'
        }
      }
    })
    registerRoyaltyHandlers(deps)
    const handler = getHandler('royalty:info')
    const result = (await handler()) as { info: { earnedWei: string }; error: null }
    expect(result.info.earnedWei).toBe('500000')
    expect(readRoyaltyInfo).toHaveBeenCalled()
  })

  it('returns error when live read fails', async () => {
    const { readRoyaltyInfo } = await import('../services/royaltyClaim')
    ;(readRoyaltyInfo as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('RPC timeout'))

    const deps = createDeps({
      signerMode: 'live',
      walletState: {
        wallet: {
          address: '0xabc',
          source: 'plottoon-writer',
          name: 'pw-1',
          createdAt: '2026-05-18T00:00:00Z'
        }
      }
    })
    registerRoyaltyHandlers(deps)
    const handler = getHandler('royalty:info')
    const result = (await handler()) as { info: null; error: string }
    expect(result.info).toBeNull()
    expect(result.error).toBe('RPC timeout')
  })
})

describe('royalty:claim', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects when not confirmed', async () => {
    const deps = createDeps()
    registerRoyaltyHandlers(deps)
    const handler = getHandler('royalty:claim')
    const result = (await handler({}, false)) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('requires explicit confirmation')
  })

  it('rejects when no wallet connected', async () => {
    const deps = createDeps()
    registerRoyaltyHandlers(deps)
    const handler = getHandler('royalty:claim')
    const result = (await handler({}, true)) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('No wallet connected')
  })

  it('rejects when reserve token is zero address', async () => {
    const config = mockConfig()
    config.plotTokenAddress = '0x0000000000000000000000000000000000000000'
    const deps = createDeps({
      walletState: {
        wallet: {
          address: '0xabc',
          source: 'plottoon-writer',
          name: 'pw-1',
          createdAt: '2026-05-18T00:00:00Z'
        }
      },
      royaltyConfig: config
    })
    registerRoyaltyHandlers(deps)
    const handler = getHandler('royalty:claim')
    const result = (await handler({}, true)) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Reserve token not configured')
  })

  it('rejects when config validation fails', async () => {
    const config = mockConfig()
    config.mcv2BondAddress = ''
    const deps = createDeps({
      walletState: {
        wallet: {
          address: '0xabc',
          source: 'plottoon-writer',
          name: 'pw-1',
          createdAt: '2026-05-18T00:00:00Z'
        }
      },
      royaltyConfig: config
    })
    registerRoyaltyHandlers(deps)
    const handler = getHandler('royalty:claim')
    const result = (await handler({}, true)) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('MCV2_BOND_ADDRESS is required')
  })

  it('rejects in live mode when no unclaimed royalties', async () => {
    const { readRoyaltyInfo } = await import('../services/royaltyClaim')
    ;(readRoyaltyInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
      earnedWei: '500000',
      claimedWei: '500000',
      unclaimedWei: '0',
      reserveToken: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
    })

    const deps = createDeps({
      signerMode: 'live',
      walletState: {
        wallet: {
          address: '0xabc',
          source: 'plottoon-writer',
          name: 'pw-1',
          createdAt: '2026-05-18T00:00:00Z'
        }
      }
    })
    registerRoyaltyHandlers(deps)
    const handler = getHandler('royalty:claim')
    const result = (await handler({}, true)) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('No unclaimed royalties')
  })

  it('returns mock success in mock mode', async () => {
    const { appendClaimRecord } = await import('../services/royaltyClaimStatus')
    const deps = createDeps({
      walletState: {
        wallet: {
          address: '0xabc',
          source: 'plottoon-writer',
          name: 'pw-1',
          createdAt: '2026-05-18T00:00:00Z'
        }
      }
    })
    registerRoyaltyHandlers(deps)
    const handler = getHandler('royalty:claim')
    const result = (await handler({}, true)) as { success: boolean; txHash: string }
    expect(result.success).toBe(true)
    expect(result.txHash).toMatch(/^0x/)
    expect(appendClaimRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        walletAddress: '0xabc',
        status: 'confirmed'
      })
    )
  })

  it('sends progress events in mock mode', async () => {
    const mockWin = {
      isDestroyed: () => false,
      webContents: { send: vi.fn() }
    }
    const deps = createDeps({
      walletState: {
        wallet: {
          address: '0xabc',
          source: 'plottoon-writer',
          name: 'pw-1',
          createdAt: '2026-05-18T00:00:00Z'
        }
      },
      getWindow: vi.fn().mockReturnValue(mockWin)
    })
    registerRoyaltyHandlers(deps)
    const handler = getHandler('royalty:claim')
    await handler({}, true)

    const states = mockWin.webContents.send.mock.calls
      .filter((c: unknown[]) => c[0] === 'royalty:progress')
      .map((c: unknown[]) => (c[1] as { state: string }).state)
    expect(states).toContain('preparing')
    expect(states).toContain('signing')
    expect(states).toContain('broadcasting')
    expect(states).toContain('confirming')
    expect(states).toContain('done')
  })

  it('persists failed claim when live executeRoyaltyClaim throws', async () => {
    const { executeRoyaltyClaim, readRoyaltyInfo } = await import('../services/royaltyClaim')
    const { appendClaimRecord } = await import('../services/royaltyClaimStatus')
    ;(readRoyaltyInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
      earnedWei: '500000',
      claimedWei: '100000',
      unclaimedWei: '400000',
      reserveToken: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
    })
    ;(executeRoyaltyClaim as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('RPC connection refused')
    )

    const deps = createDeps({
      signerMode: 'live',
      walletState: {
        wallet: {
          address: '0xabc',
          source: 'plottoon-writer',
          name: 'pw-1',
          createdAt: '2026-05-18T00:00:00Z'
        }
      }
    })
    registerRoyaltyHandlers(deps)
    const handler = getHandler('royalty:claim')
    const result = (await handler({}, true)) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toBe('RPC connection refused')
    expect(appendClaimRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error: 'RPC connection refused'
      })
    )
  })
})

describe('royalty:claimHistory', () => {
  // #233 — fake test wallets only; no real addresses or wallet material.
  const WALLET_A = '0xaaaa000000000000000000000000000000000001'
  const WALLET_B = '0xbbbb000000000000000000000000000000000002'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function depsWithWallet(address: string): RoyaltyHandlerDeps {
    return createDeps({
      walletState: {
        wallet: {
          address,
          source: 'plottoon-writer',
          name: 'pw-fake',
          createdAt: '2026-05-18T00:00:00Z'
        }
      }
    })
  }

  it('returns only the active wallet’s claim records', async () => {
    const { readClaimHistory } = await import('../services/royaltyClaimStatus')
    ;(readClaimHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      claims: [
        {
          txHash: '0xtxA',
          walletAddress: WALLET_A,
          reserveToken: '0xtoken',
          gasCostWei: '1000',
          status: 'confirmed',
          error: null,
          claimedAt: '2026-05-22T00:00:00Z'
        },
        {
          txHash: '0xtxB',
          walletAddress: WALLET_B,
          reserveToken: '0xtoken',
          gasCostWei: '1000',
          status: 'confirmed',
          error: null,
          claimedAt: '2026-05-22T00:30:00Z'
        }
      ]
    })

    registerRoyaltyHandlers(depsWithWallet(WALLET_A))
    const handler = getHandler('royalty:claimHistory')
    const result = (await handler()) as { claims: Array<{ txHash: string }> }
    expect(result.claims).toHaveLength(1)
    expect(result.claims[0].txHash).toBe('0xtxA')
  })

  it('shows wallet B only B’s records (mirror of the wallet-A case)', async () => {
    const { readClaimHistory } = await import('../services/royaltyClaimStatus')
    ;(readClaimHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      claims: [
        {
          txHash: '0xtxA',
          walletAddress: WALLET_A,
          reserveToken: '0xtoken',
          gasCostWei: '1000',
          status: 'confirmed',
          error: null,
          claimedAt: '2026-05-22T00:00:00Z'
        },
        {
          txHash: '0xtxB',
          walletAddress: WALLET_B,
          reserveToken: '0xtoken',
          gasCostWei: '1000',
          status: 'confirmed',
          error: null,
          claimedAt: '2026-05-22T00:30:00Z'
        }
      ]
    })

    registerRoyaltyHandlers(depsWithWallet(WALLET_B))
    const handler = getHandler('royalty:claimHistory')
    const result = (await handler()) as { claims: Array<{ txHash: string }> }
    expect(result.claims).toHaveLength(1)
    expect(result.claims[0].txHash).toBe('0xtxB')
  })

  it('normalizes case when matching record addresses against the active wallet', async () => {
    const { readClaimHistory } = await import('../services/royaltyClaimStatus')
    ;(readClaimHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      claims: [
        {
          txHash: '0xtxA',
          walletAddress: WALLET_A.toUpperCase(),
          reserveToken: '0xtoken',
          gasCostWei: '1000',
          status: 'confirmed',
          error: null,
          claimedAt: '2026-05-22T00:00:00Z'
        }
      ]
    })

    registerRoyaltyHandlers(depsWithWallet(WALLET_A.toLowerCase()))
    const handler = getHandler('royalty:claimHistory')
    const result = (await handler()) as { claims: Array<{ txHash: string }> }
    expect(result.claims).toHaveLength(1)
  })

  it('returns an empty list when no wallet is active', async () => {
    const { readClaimHistory } = await import('../services/royaltyClaimStatus')
    ;(readClaimHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      claims: [
        {
          txHash: '0xtxA',
          walletAddress: WALLET_A,
          reserveToken: '0xtoken',
          gasCostWei: '1000',
          status: 'confirmed',
          error: null,
          claimedAt: '2026-05-22T00:00:00Z'
        }
      ]
    })

    registerRoyaltyHandlers(createDeps())
    const handler = getHandler('royalty:claimHistory')
    const result = (await handler()) as { claims: unknown[] }
    expect(result.claims).toEqual([])
  })

  it('keeps existing on-disk records readable (no format migration required)', async () => {
    // The on-disk format from `royaltyClaimStatus` already includes
    // `walletAddress` on each record (added when the file was first
    // written by `royalty:claim`). #233 is purely an output-filter at
    // the handler — no migration, no rewrite of `royalty-claims.json`.
    const { readClaimHistory } = await import('../services/royaltyClaimStatus')
    ;(readClaimHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      claims: [
        {
          txHash: '0xLegacyTx',
          walletAddress: WALLET_A,
          reserveToken: '0xtoken',
          gasCostWei: '1000',
          status: 'confirmed',
          error: null,
          claimedAt: '2026-05-22T00:00:00Z'
        }
      ]
    })

    registerRoyaltyHandlers(depsWithWallet(WALLET_A))
    const handler = getHandler('royalty:claimHistory')
    const result = (await handler()) as { claims: Array<{ txHash: string }> }
    expect(result.claims).toHaveLength(1)
    expect(result.claims[0].txHash).toBe('0xLegacyTx')
  })
})
