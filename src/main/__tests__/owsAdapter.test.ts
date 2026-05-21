import { describe, it, expect, vi } from 'vitest'
import {
  createOWSDiscoverFn,
  createOWSCreateFn,
  createOWSSignMessageFn,
  createOWSSignTransactionFn,
  createOWSConfig,
  createOWSFromCore,
  unwrapOwsCoreExports,
  OWS_UNAVAILABLE_MESSAGE
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

describe('unwrapOwsCoreExports', () => {
  function makeOwsLikeRecord(): Record<string, unknown> {
    return {
      listWallets: () => [],
      createWallet: () => ({}),
      signMessage: () => ({}),
      signTransaction: () => ({})
    }
  }

  it('returns the input directly when methods are top-level functions (plain Node CJS shape)', () => {
    const direct = makeOwsLikeRecord()
    expect(unwrapOwsCoreExports(direct)).toBe(direct)
  })

  it('unwraps a single-default Vite/Rollup synthetic namespace', () => {
    const inner = makeOwsLikeRecord()
    const wrapped = { default: inner }
    expect(unwrapOwsCoreExports(wrapped)).toBe(inner)
  })

  it('unwraps a double-default wrapping (namespace { default: { default: core } })', () => {
    const inner = makeOwsLikeRecord()
    const wrapped = { default: { default: inner } }
    expect(unwrapOwsCoreExports(wrapped)).toBe(inner)
  })

  it('throws the stable sentinel when no layer carries the OWS core methods', () => {
    expect(() => unwrapOwsCoreExports({})).toThrow(OWS_UNAVAILABLE_MESSAGE)
    expect(() => unwrapOwsCoreExports({ default: { default: {} } })).toThrow(
      OWS_UNAVAILABLE_MESSAGE
    )
    // Bundler bug shape: methods exist as keys but values are undefined.
    expect(() =>
      unwrapOwsCoreExports({
        default: { listWallets: undefined, createWallet: undefined }
      })
    ).toThrow(OWS_UNAVAILABLE_MESSAGE)
  })

  it('throws the stable sentinel for null / non-object input', () => {
    expect(() => unwrapOwsCoreExports(null)).toThrow(OWS_UNAVAILABLE_MESSAGE)
    expect(() => unwrapOwsCoreExports(undefined)).toThrow(OWS_UNAVAILABLE_MESSAGE)
    expect(() => unwrapOwsCoreExports(42)).toThrow(OWS_UNAVAILABLE_MESSAGE)
  })
})

describe('createOWSFromCore', () => {
  function workingLoader() {
    return {
      listWallets: vi.fn().mockReturnValue([]),
      createWallet: vi.fn().mockReturnValue({ accounts: [] }),
      signMessage: vi.fn().mockReturnValue({ signature: '0xsig' }),
      signTransaction: vi.fn().mockReturnValue({ signature: '0xtx' })
    }
  }

  it('forwards calls when the loader returns the canonical CJS shape', async () => {
    const inner = workingLoader()
    const core = await createOWSFromCore(() => inner)
    expect(core.listWallets('/vault')).toEqual([])
    expect(inner.listWallets).toHaveBeenCalledWith('/vault')
  })

  it('unwraps a default-wrapped loader result (electron-vite bundle shape)', async () => {
    const inner = workingLoader()
    const core = await createOWSFromCore(() => ({ default: inner }))
    core.listWallets()
    expect(inner.listWallets).toHaveBeenCalled()
  })

  it('throws the stable sentinel when the loader throws', async () => {
    await expect(
      createOWSFromCore(() => {
        throw new Error('require failed: MODULE_NOT_FOUND')
      })
    ).rejects.toThrow(OWS_UNAVAILABLE_MESSAGE)
  })

  it('throws the stable sentinel when the loader returns a shape missing OWS methods', async () => {
    // Reproduces the post-bundling failure mode where method names exist but
    // resolve to undefined — what produced the original `mod2.listWallets is
    // not a function` page error.
    await expect(
      createOWSFromCore(() => ({
        default: { listWallets: undefined, createWallet: undefined }
      }))
    ).rejects.toThrow(OWS_UNAVAILABLE_MESSAGE)
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
