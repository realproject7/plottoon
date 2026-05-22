import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  registerWalletIdentityHandlers,
  restoreActiveWalletFromStore
} from '../ipc/walletIdentityHandlers'
import type { WalletIdentityStore } from '../services/walletIdentityStore'
import type { SelectedWalletState } from '../ipc/walletConnectionHandlers'
import type { WalletIdentity } from '../../shared/walletIdentity'

const handlers: Record<string, (...args: unknown[]) => unknown> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers[channel] = handler
    }
  }
}))

const FAKE_A: WalletIdentity = {
  address: '0xaaaa000000000000000000000000000000000001',
  source: 'plottoon-writer',
  owsName: 'plottoon-writer-fake-a',
  registeredAt: '2026-05-22T00:00:00.000Z'
}
const FAKE_B: WalletIdentity = {
  address: '0xbbbb000000000000000000000000000000000002',
  source: 'plotlink-writer',
  owsName: 'plotlink-writer-fake-b',
  label: 'Secondary',
  registeredAt: '2026-05-22T00:01:00.000Z'
}

function mockStore(): WalletIdentityStore {
  return {
    list: vi.fn().mockResolvedValue([FAKE_A, FAKE_B]),
    getActive: vi.fn().mockResolvedValue(FAKE_A),
    setActive: vi.fn(async (addr: string) => {
      if (addr.toLowerCase() === FAKE_A.address) return FAKE_A
      if (addr.toLowerCase() === FAKE_B.address) return FAKE_B
      return null
    }),
    clearActive: vi.fn().mockResolvedValue(undefined),
    register: vi.fn(),
    remove: vi.fn()
  }
}

function freshState(): SelectedWalletState {
  return { wallet: null }
}

describe('walletIdentityHandlers', () => {
  beforeEach(() => {
    Object.keys(handlers).forEach((k) => delete handlers[k])
  })

  it('wallet:identity:list returns every registered identity', async () => {
    const store = mockStore()
    const state = freshState()
    registerWalletIdentityHandlers({ store, walletState: state })

    const result = (await handlers['wallet:identity:list']({})) as {
      identities: WalletIdentity[]
    }
    expect(result.identities).toHaveLength(2)
    expect(result.identities[0].owsName).toBe(FAKE_A.owsName)
    expect(result.identities[1].owsName).toBe(FAKE_B.owsName)
  })

  it('wallet:identity:getActive returns the active identity', async () => {
    const store = mockStore()
    const state = freshState()
    registerWalletIdentityHandlers({ store, walletState: state })

    const result = (await handlers['wallet:identity:getActive']({})) as {
      identity: WalletIdentity | null
    }
    expect(result.identity?.address).toBe(FAKE_A.address)
  })

  it('wallet:identity:setActive switches active and mirrors into walletState.wallet', async () => {
    const store = mockStore()
    const state = freshState()
    registerWalletIdentityHandlers({ store, walletState: state })

    const result = (await handlers['wallet:identity:setActive'](
      {},
      { address: FAKE_B.address }
    )) as {
      identity: WalletIdentity | null
      error?: string
    }
    expect(result.identity?.owsName).toBe(FAKE_B.owsName)
    expect(result.error).toBeUndefined()
    // State mirror must carry the OWS name for signing — not just the address.
    expect(state.wallet?.name).toBe(FAKE_B.owsName)
    expect(state.wallet?.address).toBe(FAKE_B.address)
    expect(state.wallet?.source).toBe(FAKE_B.source)
  })

  it('wallet:identity:setActive returns an error for unknown addresses without changing state', async () => {
    const store = mockStore()
    const state = freshState()
    state.wallet = {
      address: FAKE_A.address,
      source: FAKE_A.source,
      name: FAKE_A.owsName,
      createdAt: FAKE_A.registeredAt
    }
    registerWalletIdentityHandlers({ store, walletState: state })

    const result = (await handlers['wallet:identity:setActive'](
      {},
      { address: '0xc0ffee0000000000000000000000000000000000' }
    )) as { identity: WalletIdentity | null; error?: string }

    expect(result.identity).toBeNull()
    expect(result.error).toBe('Unknown wallet address')
    // Existing active wallet must remain in state.wallet on a failed switch.
    expect(state.wallet?.name).toBe(FAKE_A.owsName)
  })

  it('wallet:identity:setActive rejects malformed payloads', async () => {
    const store = mockStore()
    const state = freshState()
    registerWalletIdentityHandlers({ store, walletState: state })

    const result1 = (await handlers['wallet:identity:setActive']({}, null)) as {
      identity: WalletIdentity | null
      error?: string
    }
    expect(result1.identity).toBeNull()
    expect(result1.error).toContain('payload')

    const result2 = (await handlers['wallet:identity:setActive']({}, { address: 42 })) as {
      identity: WalletIdentity | null
      error?: string
    }
    expect(result2.identity).toBeNull()
    expect(result2.error).toContain('string address')

    const result3 = (await handlers['wallet:identity:setActive']({}, { address: '' })) as {
      identity: WalletIdentity | null
      error?: string
    }
    expect(result3.identity).toBeNull()
    expect(result3.error).toContain('string address')
  })

  it('handlers never expose private-material fields', async () => {
    const store = mockStore()
    const state = freshState()
    registerWalletIdentityHandlers({ store, walletState: state })

    const list = (await handlers['wallet:identity:list']({})) as { identities: WalletIdentity[] }
    const json = JSON.stringify(list)
    expect(json).not.toMatch(/privateKey|mnemonic|passphrase|vaultPath/i)

    const active = (await handlers['wallet:identity:getActive']({})) as {
      identity: WalletIdentity | null
    }
    expect(JSON.stringify(active)).not.toMatch(/privateKey|mnemonic|passphrase|vaultPath/i)
  })
})

describe('restoreActiveWalletFromStore', () => {
  it('mirrors the persisted active identity into walletState on startup', async () => {
    const store = mockStore()
    const state = freshState()
    await restoreActiveWalletFromStore(store, state)
    expect(state.wallet?.name).toBe(FAKE_A.owsName)
    expect(state.wallet?.address).toBe(FAKE_A.address)
  })

  it('leaves walletState untouched when no identity is active', async () => {
    const store: WalletIdentityStore = {
      ...mockStore(),
      getActive: vi.fn().mockResolvedValue(null)
    }
    const state = freshState()
    await restoreActiveWalletFromStore(store, state)
    expect(state.wallet).toBeNull()
  })
})
