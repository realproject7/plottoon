import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  registerWalletConnectionHandlers,
  createSelectedWalletState,
  type SelectedWalletState
} from '../ipc/walletConnectionHandlers'
import type { WalletConnectionConfig } from '../services/walletConnection'
import type { WalletSigner } from '../services/walletSigning'

const handlers: Record<string, (...args: unknown[]) => unknown> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers[channel] = handler
    }
  }
}))

// #239: the wallet:connect handler re-resolves the OWS internal name from
// the vault by address — the renderer no longer sends a name. The default
// vault mock includes every address used by tests in this file so the
// resolver finds a match. Tests that need an empty vault or a specific
// missing-address scenario override `discoverVault`.
function mockConfig(): WalletConnectionConfig {
  return {
    discoverVault: vi.fn().mockResolvedValue([
      { name: 'plotlink-writer-main', address: '0xabc' },
      { name: 'plotlink-writer-1', address: '0xfoo' },
      { name: 'plotlink-writer-1', address: '0xbar' },
      {
        name: 'plotlink-writer-internal-selector',
        address: '0xaaaa000000000000000000000000000000000001'
      },
      {
        name: 'plottoon-writer-internal-selector',
        address: '0xbbbb000000000000000000000000000000000002'
      }
    ]),
    createWallet: vi.fn().mockResolvedValue({ address: '0xnew-created' })
  }
}

function mockSigner(): WalletSigner {
  return {
    requestSignature: vi
      .fn()
      .mockResolvedValue({ signature: 'sig', message: 'msg', timestamp: '' }),
    isMockMode: vi.fn().mockReturnValue(false)
  }
}

describe('walletConnectionHandlers', () => {
  let state: SelectedWalletState
  let config: WalletConnectionConfig

  beforeEach(() => {
    Object.keys(handlers).forEach((k) => delete handlers[k])
    state = createSelectedWalletState()
    config = mockConfig()
    registerWalletConnectionHandlers(config, state, mockSigner())
  })

  it('registers wallet:getOptions handler', async () => {
    const result = await handlers['wallet:getOptions']({})
    const typed = result as { options: Array<{ type: string }> }
    // 1 create-new + 5 reuse-existing entries from the default mock vault.
    expect(typed.options).toHaveLength(6)
    expect(typed.options[0].type).toBe('create-new')
    expect(typed.options.slice(1).every((o) => o.type === 'reuse-existing')).toBe(true)
  })

  it('registers wallet:connect handler for create-new', async () => {
    const result = await handlers['wallet:connect'](
      {},
      {
        type: 'create-new',
        source: 'plottoon-writer'
      }
    )
    const typed = result as { success: boolean; wallet?: { address: string } }
    expect(typed.success).toBe(true)
    expect(typed.wallet!.address).toBe('0xnew-created')
    expect(state.wallet).not.toBeNull()
    expect(state.wallet!.address).toBe('0xnew-created')
  })

  it('registers wallet:connect handler for reuse-existing', async () => {
    const result = await handlers['wallet:connect'](
      {},
      {
        type: 'reuse-existing',
        source: 'plotlink-writer',
        address: '0xabc',
        name: 'plotlink-writer-main'
      }
    )
    const typed = result as { success: boolean; wallet?: { address: string } }
    expect(typed.success).toBe(true)
    expect(state.wallet!.address).toBe('0xabc')
  })

  it('registers wallet:getConnected handler', async () => {
    const before = await handlers['wallet:getConnected']({})
    expect((before as { connected: boolean }).connected).toBe(false)

    await handlers['wallet:connect'](
      {},
      {
        type: 'reuse-existing',
        source: 'plotlink-writer',
        address: '0xfoo',
        name: 'plotlink-writer-1'
      }
    )

    const after = await handlers['wallet:getConnected']({})
    const typed = after as { connected: boolean; address: string; source: string }
    expect(typed.connected).toBe(true)
    expect(typed.address).toBe('0xfoo')
    expect(typed.source).toBe('plotlink-writer')
  })

  it('#234 — wallet:getConnected does NOT expose the OWS internal name/id', async () => {
    await handlers['wallet:connect'](
      {},
      {
        type: 'reuse-existing',
        source: 'plotlink-writer',
        address: '0xaaaa000000000000000000000000000000000001',
        // OWS internal selector. Must never leave the main process.
        name: 'plotlink-writer-internal-selector'
      }
    )

    const response = (await handlers['wallet:getConnected']({})) as Record<string, unknown>

    // Renderer-facing keys are only the non-signing metadata.
    expect(Object.keys(response).sort()).toEqual(['address', 'connected', 'source'])
    // Specifically, the OWS internal name/id never crosses the boundary.
    expect(response).not.toHaveProperty('name')
    expect(response).not.toHaveProperty('owsName')
    const serialized = JSON.stringify(response)
    expect(serialized).not.toContain('plotlink-writer-internal-selector')

    // Main process still has the selector — it's needed for signing flows
    // (publish, royalty, agent registration).
    expect(state.wallet?.name).toBe('plotlink-writer-internal-selector')
  })

  it('#239 — wallet:getOptions does NOT serialize OWS internal names in reuse-existing options', async () => {
    // Distinctive selector strings the renderer must never see.
    const distinctiveConfig: WalletConnectionConfig = {
      discoverVault: vi.fn().mockResolvedValue([
        {
          name: 'plotlink-writer-distinctive-selector-A',
          address: '0xaaaa000000000000000000000000000000000001'
        },
        {
          name: 'plottoon-writer-distinctive-selector-B',
          address: '0xbbbb000000000000000000000000000000000002'
        }
      ]),
      createWallet: vi.fn()
    }
    Object.keys(handlers).forEach((k) => delete handlers[k])
    registerWalletConnectionHandlers(distinctiveConfig, createSelectedWalletState(), mockSigner())

    const result = (await handlers['wallet:getOptions']({})) as {
      options: Array<Record<string, unknown>>
    }

    // Each reuse-existing option's keys must be exactly the renderer-safe
    // view shape — no `name` or `owsName` allowed.
    const reuse = result.options.filter((o) => o.type === 'reuse-existing')
    expect(reuse).toHaveLength(2)
    for (const opt of reuse) {
      expect(opt).not.toHaveProperty('name')
      expect(opt).not.toHaveProperty('owsName')
      // Required identifier the renderer uses to call back: address.
      expect(opt.address).toBeDefined()
      expect(opt.source).toBeDefined()
    }
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('plotlink-writer-distinctive-selector-A')
    expect(serialized).not.toContain('plottoon-writer-distinctive-selector-B')
  })

  it('#239 — wallet:connect resolves the OWS name in main, even when renderer omits it', async () => {
    Object.keys(handlers).forEach((k) => delete handlers[k])
    const newState = createSelectedWalletState()
    const newConfig: WalletConnectionConfig = {
      discoverVault: vi.fn().mockResolvedValue([
        {
          name: 'plotlink-writer-resolved',
          address: '0xcccc000000000000000000000000000000000003'
        }
      ]),
      createWallet: vi.fn()
    }
    registerWalletConnectionHandlers(newConfig, newState, mockSigner())

    // Renderer sends only the address — no `name` field at all.
    const result = (await handlers['wallet:connect'](
      {},
      {
        type: 'reuse-existing',
        source: 'plotlink-writer',
        address: '0xcccc000000000000000000000000000000000003'
      }
    )) as { success: boolean; wallet?: Record<string, unknown> }

    expect(result.success).toBe(true)
    // Renderer-facing response is still the #234 projection (no name).
    expect(Object.keys(result.wallet!).sort()).toEqual(['address', 'source'])
    // Main-process state, however, has the resolved OWS name available
    // for downstream signing flows.
    expect(newState.wallet?.name).toBe('plotlink-writer-resolved')
  })

  it('#239 — wallet:connect refuses when the renderer-supplied address is not in the vault', async () => {
    Object.keys(handlers).forEach((k) => delete handlers[k])
    const newState = createSelectedWalletState()
    const emptyConfig: WalletConnectionConfig = {
      discoverVault: vi.fn().mockResolvedValue([]),
      createWallet: vi.fn()
    }
    registerWalletConnectionHandlers(emptyConfig, newState, mockSigner())

    const result = (await handlers['wallet:connect'](
      {},
      {
        type: 'reuse-existing',
        source: 'plotlink-writer',
        address: '0xdead000000000000000000000000000000000000'
      }
    )) as { success: boolean; error?: string }

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/no longer available|not found/i)
    expect(newState.wallet).toBeNull()
  })

  it('#239 RE1 — wallet:connect refuses an unrecognized vault entry (non-writer prefix) even when address matches', async () => {
    // The vault contains a `personal-wallet` at the same address the
    // renderer requests. `wallet:getOptions` wouldn't list it because
    // `discoverExistingWallets` filters to writer-prefix names; the
    // resolver must enforce the same boundary or a renderer could
    // bypass the option list to connect an unrelated OWS wallet.
    Object.keys(handlers).forEach((k) => delete handlers[k])
    const newState = createSelectedWalletState()
    const newConfig: WalletConnectionConfig = {
      discoverVault: vi.fn().mockResolvedValue([
        {
          name: 'personal-wallet',
          address: '0xdddd000000000000000000000000000000000005'
        }
      ]),
      createWallet: vi.fn()
    }
    registerWalletConnectionHandlers(newConfig, newState, mockSigner())

    const result = (await handlers['wallet:connect'](
      {},
      {
        type: 'reuse-existing',
        source: 'plottoon-writer',
        address: '0xdddd000000000000000000000000000000000005'
      }
    )) as { success: boolean; error?: string }

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/no longer available|not found|unavailable/i)
    expect(newState.wallet).toBeNull()
    // Confirm that `getOptions` similarly hides the unrecognized entry
    // (same boundary, both paths).
    const options = (await handlers['wallet:getOptions']({})) as {
      options: Array<{ type: string }>
    }
    expect(options.options.filter((o) => o.type === 'reuse-existing')).toHaveLength(0)
  })

  it('#239 — wallet:connect ignores a renderer-forged `name` field if one is sent', async () => {
    Object.keys(handlers).forEach((k) => delete handlers[k])
    const newState = createSelectedWalletState()
    const newConfig: WalletConnectionConfig = {
      discoverVault: vi.fn().mockResolvedValue([
        {
          name: 'plotlink-writer-real-vault-name',
          address: '0xeeee000000000000000000000000000000000004'
        }
      ]),
      createWallet: vi.fn()
    }
    registerWalletConnectionHandlers(newConfig, newState, mockSigner())

    // A malicious renderer could try to inject a different OWS name as a
    // signing selector. The main process must IGNORE that field and use
    // the real vault entry's name.
    await handlers['wallet:connect'](
      {},
      {
        type: 'reuse-existing',
        source: 'plotlink-writer',
        address: '0xeeee000000000000000000000000000000000004',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        name: 'plotlink-writer-forged-attacker-controlled' as any
      }
    )

    expect(newState.wallet?.name).toBe('plotlink-writer-real-vault-name')
    expect(newState.wallet?.name).not.toBe('plotlink-writer-forged-attacker-controlled')
  })

  it('#234 — wallet:connect does NOT echo the OWS internal name/id back to the renderer', async () => {
    const connectResult = (await handlers['wallet:connect'](
      {},
      {
        type: 'reuse-existing',
        source: 'plottoon-writer',
        address: '0xbbbb000000000000000000000000000000000002',
        name: 'plottoon-writer-internal-selector'
      }
    )) as { success: boolean; wallet?: Record<string, unknown> }

    expect(connectResult.success).toBe(true)
    expect(connectResult.wallet).toBeDefined()
    // The returned wallet payload exposes only non-signing metadata.
    expect(Object.keys(connectResult.wallet!).sort()).toEqual(['address', 'source'])
    expect(connectResult.wallet).not.toHaveProperty('name')
    expect(connectResult.wallet).not.toHaveProperty('owsName')
    const serialized = JSON.stringify(connectResult)
    expect(serialized).not.toContain('plottoon-writer-internal-selector')

    // But the main process kept the selector internally so signing still works.
    expect(state.wallet?.name).toBe('plottoon-writer-internal-selector')
  })

  it('registers wallet:disconnect handler', async () => {
    await handlers['wallet:connect'](
      {},
      {
        type: 'reuse-existing',
        source: 'plotlink-writer',
        address: '0xbar',
        name: 'plotlink-writer-1'
      }
    )
    expect(state.wallet).not.toBeNull()

    await handlers['wallet:disconnect']({})
    expect(state.wallet).toBeNull()
  })

  it('wallet:getOptions returns disabled create-new option with the stable sentinel when OWS is unavailable', async () => {
    const brokenConfig: WalletConnectionConfig = {
      discoverVault: vi.fn().mockRejectedValue(new Error('OWS wallet module is unavailable')),
      createWallet: vi.fn()
    }
    Object.keys(handlers).forEach((k) => delete handlers[k])
    registerWalletConnectionHandlers(brokenConfig, createSelectedWalletState(), mockSigner())

    const result = await handlers['wallet:getOptions']({})
    const typed = result as {
      options: { type: string; source: string; available?: boolean; unavailableReason?: string }[]
    }
    expect(typed.options).toHaveLength(1)
    expect(typed.options[0].type).toBe('create-new')
    expect(typed.options[0].source).toBe('plottoon-writer')
    expect(typed.options[0].available).toBe(false)
    expect(typed.options[0].unavailableReason).toBe('OWS wallet module is unavailable')
  })

  it('wallet:getOptions hides bundler-internal names like `mod2.listWallets is not a function`', async () => {
    const brokenConfig: WalletConnectionConfig = {
      discoverVault: vi.fn().mockRejectedValue(new Error('mod2.listWallets is not a function')),
      createWallet: vi.fn()
    }
    Object.keys(handlers).forEach((k) => delete handlers[k])
    registerWalletConnectionHandlers(brokenConfig, createSelectedWalletState(), mockSigner())

    const result = await handlers['wallet:getOptions']({})
    const typed = result as { options: { unavailableReason?: string }[] }
    expect(typed.options[0].unavailableReason).toBe('OWS wallet module is unavailable')
    expect(typed.options[0].unavailableReason).not.toMatch(/mod\d*\./i)
    expect(typed.options[0].unavailableReason).not.toMatch(/is not a function/i)
  })

  it('wallet:getOptions also maps the legacy OWS-unavailable wording onto the stable sentinel', async () => {
    const brokenConfig: WalletConnectionConfig = {
      discoverVault: vi.fn().mockRejectedValue(new Error('OWS native module is not available')),
      createWallet: vi.fn()
    }
    Object.keys(handlers).forEach((k) => delete handlers[k])
    registerWalletConnectionHandlers(brokenConfig, createSelectedWalletState(), mockSigner())

    const result = await handlers['wallet:getOptions']({})
    const typed = result as { options: { unavailableReason?: string }[] }
    expect(typed.options[0].unavailableReason).toBe('OWS wallet module is unavailable')
  })

  it('wallet:getOptions returns disabled option with sanitized reason on generic discovery failure', async () => {
    const brokenConfig: WalletConnectionConfig = {
      discoverVault: vi.fn().mockRejectedValue(new Error('vault read failed')),
      createWallet: vi.fn()
    }
    Object.keys(handlers).forEach((k) => delete handlers[k])
    registerWalletConnectionHandlers(brokenConfig, createSelectedWalletState(), mockSigner())

    const result = await handlers['wallet:getOptions']({})
    const typed = result as {
      options: { available?: boolean; unavailableReason?: string }[]
    }
    expect(typed.options[0].available).toBe(false)
    expect(typed.options[0].unavailableReason).toBe('vault read failed')
  })

  it('wallet:connect returns non-throwing failure when createWallet throws', async () => {
    const failingConfig: WalletConnectionConfig = {
      discoverVault: vi.fn().mockResolvedValue([]),
      createWallet: vi.fn().mockRejectedValue(new Error('OWS wallet module is unavailable'))
    }
    Object.keys(handlers).forEach((k) => delete handlers[k])
    const failingState = createSelectedWalletState()
    registerWalletConnectionHandlers(failingConfig, failingState, mockSigner())

    const result = await handlers['wallet:connect'](
      {},
      { type: 'create-new', source: 'plottoon-writer' }
    )
    const typed = result as { success: boolean; error?: string }
    expect(typed.success).toBe(false)
    expect(typed.error).toBe('OWS wallet module is unavailable')
    expect(failingState.wallet).toBeNull()
  })

  it('wallet:connect sanitizes error messages that contain secret-like words', async () => {
    const leakyConfig: WalletConnectionConfig = {
      discoverVault: vi.fn().mockResolvedValue([]),
      createWallet: vi.fn().mockRejectedValue(new Error('mnemonic decoding failed'))
    }
    Object.keys(handlers).forEach((k) => delete handlers[k])
    registerWalletConnectionHandlers(leakyConfig, createSelectedWalletState(), mockSigner())

    const result = await handlers['wallet:connect'](
      {},
      { type: 'create-new', source: 'plottoon-writer' }
    )
    const typed = result as { success: boolean; error?: string }
    expect(typed.success).toBe(false)
    expect(typed.error).toBe('Wallet operation failed')
    expect(typed.error).not.toMatch(/mnemonic/i)
  })

  it('wallet:connect short-circuits when option is marked unavailable', async () => {
    const result = await handlers['wallet:connect'](
      {},
      {
        type: 'create-new',
        source: 'plottoon-writer',
        available: false,
        unavailableReason: 'OWS native module is not available'
      }
    )
    const typed = result as { success: boolean; error?: string }
    expect(typed.success).toBe(false)
    expect(typed.error).toBe('OWS native module is not available')
    expect(state.wallet).toBeNull()
  })

  it('rejects wallet with unsafe metadata', async () => {
    // #239: the renderer no longer sends `name` — the unsafe name now has
    // to come from the vault itself. Simulate a vault entry whose OWS
    // name contains a banned substring; `walletMetadataIsSafe` rejects
    // the resolved metadata after `resolveReuseExistingOption`.
    const unsafeConfig: WalletConnectionConfig = {
      discoverVault: vi
        .fn()
        .mockResolvedValue([{ name: 'plotlink-writer-private-key-leak', address: '0xbad' }]),
      createWallet: vi.fn().mockResolvedValue({ address: '0xbad' })
    }
    Object.keys(handlers).forEach((k) => delete handlers[k])
    const unsafeState = createSelectedWalletState()
    registerWalletConnectionHandlers(unsafeConfig, unsafeState, mockSigner())

    const result = await handlers['wallet:connect'](
      {},
      {
        type: 'reuse-existing',
        source: 'plotlink-writer',
        address: '0xbad'
      }
    )
    const typed = result as { success: boolean; error?: string }
    expect(typed.success).toBe(false)
    expect(typed.error).toContain('unsafe content')
  })

  it('wallet:connect registers and activates the identity when a store is provided', async () => {
    Object.keys(handlers).forEach((k) => delete handlers[k])
    const newState = createSelectedWalletState()
    const newConfig = mockConfig()
    const identityStore = {
      list: vi.fn().mockResolvedValue([]),
      getActive: vi.fn().mockResolvedValue(null),
      setActive: vi.fn(async (addr: string) => ({
        address: addr.toLowerCase(),
        source: 'plottoon-writer' as const,
        owsName: 'plottoon-writer-fake',
        registeredAt: '2026-05-22T00:00:00.000Z'
      })),
      clearActive: vi.fn().mockResolvedValue(undefined),
      register: vi.fn(async (input) => ({
        address: input.address.toLowerCase(),
        source: input.source,
        owsName: input.owsName,
        label: input.label,
        registeredAt: input.registeredAt ?? '2026-05-22T00:00:00.000Z'
      })),
      remove: vi.fn()
    }
    registerWalletConnectionHandlers(newConfig, newState, mockSigner(), identityStore)

    const result = await handlers['wallet:connect'](
      {},
      { type: 'create-new', source: 'plottoon-writer' }
    )
    const typed = result as { success: boolean; wallet?: { address: string; name: string } }
    expect(typed.success).toBe(true)
    expect(identityStore.register).toHaveBeenCalledTimes(1)
    expect(identityStore.setActive).toHaveBeenCalledTimes(1)
    expect(identityStore.setActive).toHaveBeenCalledWith('0xnew-created')
  })

  it('wallet:disconnect clears the active identity in the store', async () => {
    Object.keys(handlers).forEach((k) => delete handlers[k])
    const newState = createSelectedWalletState()
    const identityStore = {
      list: vi.fn(),
      getActive: vi.fn(),
      setActive: vi.fn(),
      clearActive: vi.fn().mockResolvedValue(undefined),
      register: vi.fn(),
      remove: vi.fn()
    }
    registerWalletConnectionHandlers(mockConfig(), newState, mockSigner(), identityStore)

    await handlers['wallet:disconnect']({})
    expect(identityStore.clearActive).toHaveBeenCalledTimes(1)
    expect(newState.wallet).toBeNull()
  })
})
