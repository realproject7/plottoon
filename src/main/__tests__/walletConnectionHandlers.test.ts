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

function mockConfig(): WalletConnectionConfig {
  return {
    discoverVault: vi.fn().mockResolvedValue([{ name: 'plotlink-writer-main', address: '0xabc' }]),
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
    const typed = result as { options: unknown[] }
    expect(typed.options).toHaveLength(2)
    expect((typed.options[0] as { type: string }).type).toBe('create-new')
    expect((typed.options[1] as { type: string }).type).toBe('reuse-existing')
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

  it('wallet:getOptions returns disabled create-new option when OWS native module is unavailable', async () => {
    const brokenConfig: WalletConnectionConfig = {
      discoverVault: vi.fn().mockRejectedValue(new Error('OWS native module is not available')),
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
    expect(typed.options[0].unavailableReason).toContain('OWS native module is not available')
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
      createWallet: vi.fn().mockRejectedValue(new Error('OWS native module is not available'))
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
    expect(typed.error).toBe('OWS native module is not available')
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
    const unsafeConfig: WalletConnectionConfig = {
      discoverVault: vi.fn().mockResolvedValue([]),
      createWallet: vi.fn().mockResolvedValue({ address: '0xbad' })
    }
    Object.keys(handlers).forEach((k) => delete handlers[k])
    const unsafeState = createSelectedWalletState()
    registerWalletConnectionHandlers(unsafeConfig, unsafeState, mockSigner())

    // Monkeypatch to return unsafe name
    ;(unsafeConfig.createWallet as ReturnType<typeof vi.fn>).mockResolvedValue({
      address: '0xbad'
    })

    // The name generated by connectWallet uses Date.now, so it's safe
    // But let's test reuse-existing with unsafe name
    const result = await handlers['wallet:connect'](
      {},
      {
        type: 'reuse-existing',
        source: 'plotlink-writer',
        address: '0xbad',
        name: 'private-key-leak'
      }
    )
    const typed = result as { success: boolean; error?: string }
    expect(typed.success).toBe(false)
    expect(typed.error).toContain('unsafe content')
  })
})
