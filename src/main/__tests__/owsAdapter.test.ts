import { describe, it, expect, vi } from 'vitest'
import { createOWSDiscoverFn, createOWSCreateFn, createOWSConfig } from '../services/owsAdapter'
import type { OWSCoreModule } from '../services/owsAdapter'

function mockOWSModule(): OWSCoreModule {
  return {
    listWallets: vi.fn().mockResolvedValue([
      { name: 'plotlink-writer-main', address: '0xaaa' },
      { name: 'plottoon-writer-1', address: '0xbbb' }
    ]),
    createWallet: vi.fn().mockResolvedValue({ address: '0xnew' })
  }
}

describe('createOWSDiscoverFn', () => {
  it('discovers wallets from OWS core module', async () => {
    const ows = mockOWSModule()
    const discover = createOWSDiscoverFn(ows)

    const entries = await discover()

    expect(entries).toEqual([
      { name: 'plotlink-writer-main', address: '0xaaa' },
      { name: 'plottoon-writer-1', address: '0xbbb' }
    ])
    expect(ows.listWallets).toHaveBeenCalled()
  })
})

describe('createOWSCreateFn', () => {
  it('creates a wallet via OWS core module', async () => {
    const ows = mockOWSModule()
    const create = createOWSCreateFn(ows)

    const result = await create('plottoon-writer-999')

    expect(result.address).toBe('0xnew')
    expect(ows.createWallet).toHaveBeenCalledWith('plottoon-writer-999')
  })
})

describe('createOWSConfig', () => {
  it('returns a WalletConnectionConfig with both functions', () => {
    const ows = mockOWSModule()
    const config = createOWSConfig(ows)

    expect(typeof config.discoverVault).toBe('function')
    expect(typeof config.createWallet).toBe('function')
  })
})
