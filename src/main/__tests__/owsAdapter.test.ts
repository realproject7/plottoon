import { describe, it, expect, vi } from 'vitest'
import {
  createOWSDiscoverFn,
  createOWSCreateFn,
  createOWSSignMessageFn,
  createOWSSignTransactionFn,
  createOWSConfig
} from '../services/owsAdapter'
import type { OWSCoreModule, OWSWalletInfo, OWSVaultConfig } from '../services/owsAdapter'

function makeWallet(name: string, evmAddress: string): OWSWalletInfo {
  return {
    id: `id-${name}`,
    name,
    accounts: [
      { chainId: 'eip155:1', address: evmAddress, derivationPath: "m/44'/60'/0'/0/0" },
      { chainId: 'solana:mainnet', address: 'sol-addr', derivationPath: "m/44'/501'/0'/0'" }
    ],
    createdAt: '2026-05-18T00:00:00.000Z'
  }
}

function makeWalletNoEvm(name: string): OWSWalletInfo {
  return {
    id: `id-${name}`,
    name,
    accounts: [
      { chainId: 'solana:mainnet', address: 'sol-only', derivationPath: "m/44'/501'/0'/0'" }
    ],
    createdAt: '2026-05-18T00:00:00.000Z'
  }
}

function mockOWSModule(): OWSCoreModule {
  return {
    listWallets: vi
      .fn()
      .mockReturnValue([
        makeWallet('plotlink-writer-main', '0xaaa'),
        makeWallet('plottoon-writer-1', '0xbbb'),
        makeWalletNoEvm('solana-only-wallet')
      ]),
    createWallet: vi.fn().mockReturnValue(makeWallet('plottoon-writer-new', '0xnew')),
    signMessage: vi.fn().mockReturnValue({ signature: '0xsig', recoveryId: 0 }),
    signTransaction: vi.fn().mockReturnValue({ signature: '0xtxsig', recoveryId: 1 })
  }
}

const TEST_VAULT_CONFIG: OWSVaultConfig = {
  vaultPath: '/tmp/test-vault',
  passphrase: 'test-pass',
  chain: 'eip155:8453'
}

describe('createOWSDiscoverFn', () => {
  it('discovers wallets with EVM accounts from OWS core module', async () => {
    const ows = mockOWSModule()
    const discover = createOWSDiscoverFn(ows, TEST_VAULT_CONFIG)

    const entries = await discover()

    expect(entries).toEqual([
      { name: 'plotlink-writer-main', address: '0xaaa' },
      { name: 'plottoon-writer-1', address: '0xbbb' }
    ])
    expect(ows.listWallets).toHaveBeenCalledWith('/tmp/test-vault')
  })

  it('excludes wallets without EVM accounts', async () => {
    const ows: OWSCoreModule = {
      listWallets: vi.fn().mockReturnValue([makeWalletNoEvm('no-evm')]),
      createWallet: vi.fn(),
      signMessage: vi.fn(),
      signTransaction: vi.fn()
    }
    const discover = createOWSDiscoverFn(ows, TEST_VAULT_CONFIG)

    const entries = await discover()

    expect(entries).toEqual([])
  })
})

describe('createOWSCreateFn', () => {
  it('creates a wallet forwarding passphrase and vaultPath', async () => {
    const ows = mockOWSModule()
    const create = createOWSCreateFn(ows, TEST_VAULT_CONFIG)

    const result = await create('plottoon-writer-999')

    expect(result.address).toBe('0xnew')
    expect(ows.createWallet).toHaveBeenCalledWith(
      'plottoon-writer-999',
      'test-pass',
      null,
      '/tmp/test-vault'
    )
  })

  it('throws if created wallet has no EVM account', async () => {
    const ows: OWSCoreModule = {
      listWallets: vi.fn(),
      createWallet: vi.fn().mockReturnValue(makeWalletNoEvm('no-evm')),
      signMessage: vi.fn(),
      signTransaction: vi.fn()
    }
    const create = createOWSCreateFn(ows, TEST_VAULT_CONFIG)

    await expect(create('bad-wallet')).rejects.toThrow('Created wallet has no EVM account')
  })
})

describe('createOWSSignMessageFn', () => {
  it('signs a message forwarding chain, passphrase, and vaultPath', () => {
    const ows = mockOWSModule()
    const sign = createOWSSignMessageFn(ows, TEST_VAULT_CONFIG)

    const result = sign('my-wallet', 'hello world')

    expect(result.signature).toBe('0xsig')
    expect(ows.signMessage).toHaveBeenCalledWith(
      'my-wallet',
      'eip155:8453',
      'hello world',
      'test-pass',
      null,
      null,
      '/tmp/test-vault'
    )
  })
})

describe('createOWSSignTransactionFn', () => {
  it('signs a transaction forwarding chain, passphrase, and vaultPath', () => {
    const ows = mockOWSModule()
    const sign = createOWSSignTransactionFn(ows, TEST_VAULT_CONFIG)

    const result = sign('my-wallet', '0xdeadbeef')

    expect(result.signature).toBe('0xtxsig')
    expect(ows.signTransaction).toHaveBeenCalledWith(
      'my-wallet',
      'eip155:8453',
      '0xdeadbeef',
      'test-pass',
      null,
      '/tmp/test-vault'
    )
  })
})

describe('createOWSConfig', () => {
  it('returns config with all OWS functions wired to vault config', () => {
    const ows = mockOWSModule()
    const config = createOWSConfig(ows, TEST_VAULT_CONFIG)

    expect(typeof config.discoverVault).toBe('function')
    expect(typeof config.createWallet).toBe('function')
    expect(typeof config.signMessage).toBe('function')
    expect(typeof config.signTransaction).toBe('function')
  })
})
