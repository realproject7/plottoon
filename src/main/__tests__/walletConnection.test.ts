import { describe, it, expect, vi } from 'vitest'
import {
  discoverExistingWallets,
  getConnectionOptions,
  connectWallet,
  walletMetadataIsSafe,
  toPublishSignerAddress,
  createAppOwnedSigner,
  sanitizeWalletErrorMessage,
  isOwsUnavailableError,
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
  it('returns plotlink-writer and plottoon-writer entries from vault', async () => {
    const config = mockConfig([
      { name: 'plotlink-writer-main', address: '0xabc' },
      { name: 'plottoon-writer-123', address: '0xdef' },
      { name: 'other-wallet', address: '0x999' }
    ])

    const options = await discoverExistingWallets(config)

    expect(options).toHaveLength(2)
    expect(options[0].type).toBe('reuse-existing')
    expect(options[0].source).toBe('plotlink-writer')
    expect(options[0].address).toBe('0xabc')
    expect(options[1].type).toBe('reuse-existing')
    expect(options[1].source).toBe('plottoon-writer')
    expect(options[1].address).toBe('0xdef')
  })

  it('returns empty array when no recognized wallets exist', async () => {
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

  it('appends discovered reusable wallets', async () => {
    const config = mockConfig([
      { name: 'plotlink-writer-1', address: '0xaaa' },
      { name: 'plottoon-writer-2', address: '0xbbb' }
    ])

    const options = await getConnectionOptions(config)

    expect(options).toHaveLength(3)
    expect(options[1].source).toBe('plotlink-writer')
    expect(options[2].source).toBe('plottoon-writer')
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

describe('connectWallet failure propagation', () => {
  it('lets createWallet errors propagate so the IPC layer can handle them', async () => {
    const config: WalletConnectionConfig = {
      discoverVault: vi.fn().mockResolvedValue([]),
      createWallet: vi.fn().mockRejectedValue(new Error('OWS native module is not available'))
    }
    const option: WalletConnectionOption = { type: 'create-new', source: 'plottoon-writer' }
    await expect(connectWallet(option, config)).rejects.toThrow(
      'OWS native module is not available'
    )
  })
})

describe('sanitizeWalletErrorMessage', () => {
  it('passes through messages without secret-like terms', () => {
    expect(sanitizeWalletErrorMessage('OWS native module is not available')).toBe(
      'OWS native module is not available'
    )
    expect(sanitizeWalletErrorMessage('Created wallet has no EVM account')).toBe(
      'Created wallet has no EVM account'
    )
  })

  it('redacts messages that contain wallet-material terms', () => {
    expect(sanitizeWalletErrorMessage('failed to decode mnemonic phrase')).toBe(
      'Wallet operation failed'
    )
    expect(sanitizeWalletErrorMessage('bad passphrase supplied')).toBe('Wallet operation failed')
    expect(sanitizeWalletErrorMessage('private key invalid')).toBe('Wallet operation failed')
    expect(sanitizeWalletErrorMessage('seed corrupt')).toBe('Wallet operation failed')
    expect(sanitizeWalletErrorMessage('secret store locked')).toBe('Wallet operation failed')
  })

  it('strips credential-shaped substrings from otherwise-passable messages', () => {
    const cases: Array<[string, RegExp]> = [
      ['OWS call failed: api_key=abcdef-1234', /api_key=abcdef-1234/i],
      ['rejected token=eyJhbGciOiJIUzI1', /token=eyJhbGciOiJIUzI1/i],
      ['Login failed password=hunter2', /password=hunter2/],
      ['Authorization: Bearer eyJhbGciOi.payload.sig', /Bearer\s+eyJ/i],
      ['OpenAI returned sk-abcdefghijklmnopqrstuvwxyz', /sk-abcdef/i],
      ['Slack rejected xoxb-1234-abcd-token-value', /xoxb-1234-abcd-token-value/i]
    ]
    for (const [input, leakedPattern] of cases) {
      const out = sanitizeWalletErrorMessage(input)
      expect(out, `input: ${input}`).toContain('[REDACTED]')
      expect(out, `input: ${input}`).not.toMatch(leakedPattern)
    }
  })
})

describe('isOwsUnavailableError', () => {
  it('detects the canonical OWS unavailable sentinel string', () => {
    expect(isOwsUnavailableError(new Error('OWS wallet module is unavailable'))).toBe(true)
    expect(
      isOwsUnavailableError(new Error('outer wrap: OWS wallet module is unavailable (cause)'))
    ).toBe(true)
  })

  it('still detects the legacy OWS unavailable wording for backward compatibility', () => {
    expect(isOwsUnavailableError(new Error('OWS native module is not available'))).toBe(true)
  })

  it('detects bundler-internal "is not a function" leaks against OWS method names', () => {
    expect(isOwsUnavailableError(new Error('mod2.listWallets is not a function'))).toBe(true)
    expect(isOwsUnavailableError(new Error('mod.createWallet is not a function'))).toBe(true)
    expect(isOwsUnavailableError(new Error('listWallets is not a function'))).toBe(true)
    expect(isOwsUnavailableError(new Error('signMessage is not a function'))).toBe(true)
  })

  it('returns false for unrelated errors', () => {
    expect(isOwsUnavailableError(new Error('vault locked'))).toBe(false)
    expect(isOwsUnavailableError(new Error('something.unrelated is not a function'))).toBe(false)
    expect(isOwsUnavailableError(null)).toBe(false)
    expect(isOwsUnavailableError(undefined)).toBe(false)
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
  const validContentHash = '0x' + 'ab'.repeat(32)

  it('passes create-storyline payload with creationFeeWei and hasDeadline', async () => {
    const wallet: WalletMetadata = {
      address: '0xsigner-addr',
      source: 'plottoon-writer',
      name: 'plottoon-writer-123',
      createdAt: '2026-05-18T00:00:00.000Z'
    }
    const signFn = vi.fn().mockResolvedValue('sig-abc')
    const txFn = vi.fn().mockResolvedValue({
      txHash: 'tx-xyz',
      confirmed: true,
      storylineId: 'sl-new',
      plotIndex: 0
    })

    const signer = createAppOwnedSigner(wallet, signFn, txFn)

    expect(signer.getAddress()).toBe('0xsigner-addr')

    const sig = await signer.sign('test message')
    expect(sig).toBe('sig-abc')
    expect(signFn).toHaveBeenCalledWith('test message')

    const txResult = await signer.sendTransaction({
      action: 'create-storyline',
      title: 'My Story',
      contentCid: 'bafy123',
      contentHash: validContentHash,
      creationFeeWei: '1000000000000000',
      hasDeadline: true
    })
    expect(txResult.txHash).toBe('tx-xyz')
    expect(txResult.confirmed).toBe(true)
    expect(txResult.storylineId).toBe('sl-new')
    expect(txResult.plotIndex).toBe(0)
    expect(txFn).toHaveBeenCalledWith({
      action: 'create-storyline',
      title: 'My Story',
      contentCid: 'bafy123',
      contentHash: validContentHash,
      creationFeeWei: '1000000000000000',
      hasDeadline: true
    })
  })

  it('passes chain-plot payload without create-storyline fields', async () => {
    const wallet: WalletMetadata = {
      address: '0xaddr',
      source: 'plotlink-writer',
      name: 'plotlink-writer-main',
      createdAt: '2026-05-18T00:00:00.000Z'
    }
    const txFn = vi.fn().mockResolvedValue({
      txHash: 'tx-chain',
      confirmed: true,
      plotIndex: 3
    })
    const signer = createAppOwnedSigner(wallet, async (msg) => `signed:${msg}`, txFn)

    const txResult = await signer.sendTransaction({
      action: 'chain-plot',
      storylineId: 'sl-existing',
      title: 'Episode 4',
      contentCid: 'bafychained',
      contentHash: validContentHash
    })
    expect(txResult.txHash).toBe('tx-chain')
    expect(txResult.plotIndex).toBe(3)
    expect(txFn.mock.calls[0][0].creationFeeWei).toBeUndefined()
    expect(txFn.mock.calls[0][0].hasDeadline).toBeUndefined()
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
