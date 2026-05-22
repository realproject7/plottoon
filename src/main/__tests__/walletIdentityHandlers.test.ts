import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  registerWalletIdentityHandlers,
  restoreActiveWalletFromStore
} from '../ipc/walletIdentityHandlers'
import type { WalletIdentityStore } from '../services/walletIdentityStore'
import type { SelectedWalletState } from '../ipc/walletConnectionHandlers'
import type { WalletIdentity, WalletIdentityView } from '../../shared/walletIdentity'

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

  it('wallet:identity:list returns the renderer-safe view of every identity', async () => {
    const store = mockStore()
    const state = freshState()
    registerWalletIdentityHandlers({ store, walletState: state })

    const result = (await handlers['wallet:identity:list']({})) as {
      identities: WalletIdentityView[]
    }
    expect(result.identities).toHaveLength(2)
    expect(result.identities[0]).toEqual({
      address: FAKE_A.address,
      source: FAKE_A.source
    })
    expect(result.identities[1]).toEqual({
      address: FAKE_B.address,
      source: FAKE_B.source,
      label: FAKE_B.label
    })
    // The view must not carry the internal OWS name or registeredAt.
    for (const view of result.identities) {
      expect((view as Record<string, unknown>).owsName).toBeUndefined()
      expect((view as Record<string, unknown>).registeredAt).toBeUndefined()
    }
  })

  it('wallet:identity:getActive returns the renderer-safe view of the active identity', async () => {
    const store = mockStore()
    const state = freshState()
    registerWalletIdentityHandlers({ store, walletState: state })

    const result = (await handlers['wallet:identity:getActive']({})) as {
      identity: WalletIdentityView | null
    }
    expect(result.identity?.address).toBe(FAKE_A.address)
    expect(result.identity?.source).toBe(FAKE_A.source)
    expect((result.identity as Record<string, unknown> | null)?.owsName).toBeUndefined()
    expect((result.identity as Record<string, unknown> | null)?.registeredAt).toBeUndefined()
  })

  it('wallet:identity:setActive returns the view and mirrors owsName into walletState.wallet', async () => {
    const store = mockStore()
    const state = freshState()
    registerWalletIdentityHandlers({ store, walletState: state })

    const result = (await handlers['wallet:identity:setActive'](
      {},
      { address: FAKE_B.address }
    )) as {
      identity: WalletIdentityView | null
      error?: string
    }
    expect(result.identity).toEqual({
      address: FAKE_B.address,
      source: FAKE_B.source,
      label: FAKE_B.label
    })
    expect((result.identity as Record<string, unknown> | null)?.owsName).toBeUndefined()
    expect((result.identity as Record<string, unknown> | null)?.registeredAt).toBeUndefined()
    expect(result.error).toBeUndefined()
    // The OWS name still flows into the in-memory main-process state used by
    // publish / royalty / signing — that mirror is what wires the active
    // identity into signing flows.
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

  it('handlers never expose internal or private-material fields across IPC', async () => {
    const store = mockStore()
    const state = freshState()
    registerWalletIdentityHandlers({ store, walletState: state })

    const list = (await handlers['wallet:identity:list']({})) as {
      identities: WalletIdentityView[]
    }
    const active = (await handlers['wallet:identity:getActive']({})) as {
      identity: WalletIdentityView | null
    }
    const setActive = (await handlers['wallet:identity:setActive'](
      {},
      { address: FAKE_B.address }
    )) as { identity: WalletIdentityView | null; error?: string }

    // No private material in any IPC response. The OWS name and the internal
    // registeredAt timestamp must stay in the main process — they are not
    // part of the renderer-facing view.
    for (const payload of [list, active, setActive]) {
      const json = JSON.stringify(payload)
      expect(json).not.toMatch(/privateKey|mnemonic|seed|passphrase|secret|vaultPath/i)
      expect(json).not.toMatch(/owsName/i)
      expect(json).not.toMatch(/registeredAt/i)
      // The fake wallets in this test use distinctive `plottoon-writer-fake-a`
      // / `plotlink-writer-fake-b` OWS names. If projection regresses, the
      // raw OWS name will show up in the IPC JSON.
      expect(json).not.toContain('plottoon-writer-fake-a')
      expect(json).not.toContain('plotlink-writer-fake-b')
    }
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
