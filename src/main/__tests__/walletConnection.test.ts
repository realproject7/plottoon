import { describe, it, expect, vi } from 'vitest'
import {
  discoverExistingWallets,
  getConnectionOptions,
  connectWallet,
  walletMetadataIsSafe,
  toPublishSignerAddress,
  createAppOwnedSigner,
  type WalletConnectionConfig,
  type WalletConnectionOption,
  type WalletMetadata
} from '../services/walletConnection'

function mockConfig(
  vaultEntries: Array<{ name: string; address: string }> = []
): WalletConnectionConfig {
  return {
    discoverVault: vi.fn().mockResolvedValue(vaultEntries),
    createWallet: vi.fn().mockResolvedValue({ address: '0xnew-wallet-address' })
  }
}

describe('discoverExistingWallets', () => {
  it('returns only plotlink-writer entries from vault', async () => {
    const config = mockConfig([
      { name: 'plotlink-writer-main', address: '0xabc' },
      { name: 'plottoon-writer-123', address: '0xdef' },
      { name: 'other-wallet', address: '0x999' }
    ])

    const options = await discoverExistingWallets(config)

    expect(options).toHaveLength(1)
    expect(options[0].type).toBe('reuse-existing')
    expect(options[0].source).toBe('plotlink-writer')
    expect(options[0].address).toBe('0xabc')
    expect(options[0].name).toBe('plotlink-writer-main')
  })

  it('returns empty array when no plotlink-writer wallets exist', async () => {
    const config = mockConfig([{ name: 'random-wallet', address: '0x111' }])

    const options = await discoverExistingWallets(config)

    expect(options).toEqual([])
  })
})

describe('getConnectionOptions', () => {
  it('always includes create-new as first option', async () => {
    const config = mockConfig([])

    const options = await getConnectionOptions(config)

    expect(options[0].type).toBe('create-new')
    expect(options[0].source).toBe('plottoon-writer')
  })

  it('appends discovered plotlink-writer wallets', async () => {
    const config = mockConfig([
      { name: 'plotlink-writer-1', address: '0xaaa' },
      { name: 'plotlink-writer-2', address: '0xbbb' }
    ])

    const options = await getConnectionOptions(config)

    expect(options).toHaveLength(3)
    expect(options[1].type).toBe('reuse-existing')
    expect(options[2].type).toBe('reuse-existing')
  })
})

describe('connectWallet', () => {
  it('creates a new plottoon-writer wallet', async () => {
    const config = mockConfig()

    const option: WalletConnectionOption = { type: 'create-new', source: 'plottoon-writer' }
    const result = await connectWallet(option, config)

    expect(result.success).toBe(true)
    expect(result.wallet!.address).toBe('0xnew-wallet-address')
    expect(result.wallet!.source).toBe('plottoon-writer')
    expect(result.wallet!.name).toMatch(/^plottoon-writer-\d+$/)
    expect(result.wallet!.createdAt).toBeTruthy()
    expect(config.createWallet).toHaveBeenCalledWith(result.wallet!.name)
  })

  it('reuses an existing plotlink-writer wallet', async () => {
    const config = mockConfig()

    const option: WalletConnectionOption = {
      type: 'reuse-existing',
      source: 'plotlink-writer',
      address: '0xexisting',
      name: 'plotlink-writer-main'
    }
    const result = await connectWallet(option, config)

    expect(result.success).toBe(true)
    expect(result.wallet!.address).toBe('0xexisting')
    expect(result.wallet!.source).toBe('plotlink-writer')
    expect(result.wallet!.name).toBe('plotlink-writer-main')
    expect(config.createWallet).not.toHaveBeenCalled()
  })

  it('fails when reuse-existing is missing address', async () => {
    const config = mockConfig()

    const option: WalletConnectionOption = {
      type: 'reuse-existing',
      source: 'plotlink-writer'
    }
    const result = await connectWallet(option, config)

    expect(result.success).toBe(false)
    expect(result.error).toContain('requires address and name')
  })
})

describe('walletMetadataIsSafe', () => {
  it('returns true for clean metadata', () => {
    const wallet: WalletMetadata = {
      address: '0xabc123',
      source: 'plottoon-writer',
      name: 'plottoon-writer-1716000000',
      createdAt: '2026-05-18T00:00:00.000Z'
    }
    expect(walletMetadataIsSafe(wallet)).toBe(true)
  })

  it('returns false if metadata contains secret-like content', () => {
    const wallet: WalletMetadata = {
      address: '0xabc123',
      source: 'plottoon-writer',
      name: 'private-key-wallet',
      createdAt: '2026-05-18T00:00:00.000Z'
    }
    expect(walletMetadataIsSafe(wallet)).toBe(false)
  })
})

describe('toPublishSignerAddress', () => {
  it('returns the wallet address for use in publish adapter', () => {
    const wallet: WalletMetadata = {
      address: '0xdeadbeef',
      source: 'plotlink-writer',
      name: 'plotlink-writer-main',
      createdAt: '2026-05-18T00:00:00.000Z'
    }
    expect(toPublishSignerAddress(wallet)).toBe('0xdeadbeef')
  })
})

describe('createAppOwnedSigner', () => {
  it('creates a signer with sign, sendTransaction, and getAddress', async () => {
    const wallet: WalletMetadata = {
      address: '0xsigner-addr',
      source: 'plottoon-writer',
      name: 'plottoon-writer-123',
      createdAt: '2026-05-18T00:00:00.000Z'
    }
    const signFn = vi.fn().mockResolvedValue('sig-abc')
    const txFn = vi.fn().mockResolvedValue({ txHash: 'tx-xyz', confirmed: true })

    const signer = createAppOwnedSigner(wallet, signFn, txFn)

    expect(signer.getAddress()).toBe('0xsigner-addr')

    const sig = await signer.sign('test message')
    expect(sig).toBe('sig-abc')
    expect(signFn).toHaveBeenCalledWith('test message')

    const txResult = await signer.sendTransaction({
      action: 'create-storyline',
      title: 'My Story',
      contentCid: 'bafy123',
      contentHash: 'sha256-abc'
    })
    expect(txResult.txHash).toBe('tx-xyz')
    expect(txResult.confirmed).toBe(true)
  })

  it('signer interface is compatible with PlotLinkSigner', async () => {
    const wallet: WalletMetadata = {
      address: '0xaddr',
      source: 'plotlink-writer',
      name: 'plotlink-writer-main',
      createdAt: '2026-05-18T00:00:00.000Z'
    }
    const signer = createAppOwnedSigner(
      wallet,
      async (msg) => `signed:${msg}`,
      async () => ({ txHash: 'tx-1', confirmed: true })
    )

    expect(typeof signer.sign).toBe('function')
    expect(typeof signer.sendTransaction).toBe('function')
    const result = await signer.sign('hello')
    expect(result).toBe('signed:hello')
  })
})
