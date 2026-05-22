import { describe, it, expect, vi } from 'vitest'
import { checkActiveWalletInVault } from '../services/walletVaultCheck'
import { OWS_UNAVAILABLE_MESSAGE } from '../services/owsAdapter'

const ACTIVE = { name: 'pw-active', address: '0xaaaa000000000000000000000000000000000001' }

interface VaultAccount {
  chainId: string
  address: string
  derivationPath: string
}

function entry(name: string, accounts: VaultAccount[] = makeMatchingAccounts(ACTIVE.address)) {
  return {
    id: `fake-id-${name}`,
    name,
    accounts,
    createdAt: '2026-05-22T00:00:00.000Z'
  }
}

function makeMatchingAccounts(address: string): VaultAccount[] {
  return [{ chainId: 'eip155:8453', address, derivationPath: "m/44'/60'/0'/0/0" }]
}

describe('checkActiveWalletInVault (#235)', () => {
  it('returns ok when active wallet is null (no-active-wallet case is caller’s)', () => {
    const ows = { listWallets: vi.fn() }
    const result = checkActiveWalletInVault(ows, { vaultPath: undefined }, null)
    expect(result.ok).toBe(true)
    expect(ows.listWallets).not.toHaveBeenCalled()
  })

  it('returns ok when the active wallet name is present in the vault', () => {
    const ows = { listWallets: vi.fn().mockReturnValue([entry('pw-active'), entry('other')]) }
    const result = checkActiveWalletInVault(ows, { vaultPath: undefined }, ACTIVE)
    expect(result.ok).toBe(true)
  })

  it('returns a user-actionable error when the active wallet name is missing', () => {
    const ows = { listWallets: vi.fn().mockReturnValue([entry('other-1'), entry('other-2')]) }
    const result = checkActiveWalletInVault(ows, { vaultPath: undefined }, ACTIVE)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/no longer available|reconnect|switch wallets/i)
  })

  it('returns a user-actionable error when the vault is empty', () => {
    const ows = { listWallets: vi.fn().mockReturnValue([]) }
    const result = checkActiveWalletInVault(ows, { vaultPath: undefined }, ACTIVE)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/no longer available/i)
  })

  it('error message never leaks the vault path, OWS internal name, or wallet address', () => {
    const ows = { listWallets: vi.fn().mockReturnValue([]) }
    const result = checkActiveWalletInVault(
      ows,
      { vaultPath: '/private/var/folders/x/y/plottoon/vault.json' },
      ACTIVE
    )
    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.error).not.toContain('/private/var/folders')
    expect(result.error).not.toContain('vault.json')
    expect(result.error).not.toContain(ACTIVE.name)
    expect(result.error).not.toContain(ACTIVE.address)
  })

  it('forwards the OWS unavailable sentinel when listWallets throws that error', () => {
    const ows = {
      listWallets: vi.fn().mockImplementation(() => {
        throw new Error(OWS_UNAVAILABLE_MESSAGE)
      })
    }
    const result = checkActiveWalletInVault(ows, { vaultPath: undefined }, ACTIVE)
    expect(result.ok).toBe(false)
    expect(result.error).toBe(OWS_UNAVAILABLE_MESSAGE)
  })

  it('falls back to the generic stale-wallet error for any other listWallets failure', () => {
    const ows = {
      listWallets: vi.fn().mockImplementation(() => {
        throw new Error('disk read EACCES /sensitive/path/vault.json')
      })
    }
    const result = checkActiveWalletInVault(ows, { vaultPath: undefined }, ACTIVE)
    expect(result.ok).toBe(false)
    // Underlying error never reaches the user — it could include sensitive
    // paths.
    expect(result.error).not.toContain('/sensitive/path')
    expect(result.error).not.toContain('EACCES')
    expect(result.error).toMatch(/no longer available/i)
  })
})

describe('checkActiveWalletInVault — address match (#240)', () => {
  const OTHER_ADDRESS = '0xbbbb000000000000000000000000000000000002'

  it('passes when the matching-name vault entry has an EVM account with the same address', () => {
    const ows = {
      listWallets: vi
        .fn()
        .mockReturnValue([entry('pw-active', makeMatchingAccounts(ACTIVE.address))])
    }
    const result = checkActiveWalletInVault(ows, { vaultPath: undefined }, ACTIVE)
    expect(result.ok).toBe(true)
  })

  it('fails when the vault entry name matches but every EVM account address differs', () => {
    // Same-name/different-address scenario: a wallet was renamed or
    // restored from a different key. Signing would use a different
    // private key than the metadata shown to the user.
    const ows = {
      listWallets: vi
        .fn()
        .mockReturnValue([entry('pw-active', makeMatchingAccounts(OTHER_ADDRESS))])
    }
    const result = checkActiveWalletInVault(ows, { vaultPath: undefined }, ACTIVE)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/no longer available|reconnect|switch wallets/i)
  })

  it('fails when the vault entry name matches but has no EVM accounts at all', () => {
    const ows = {
      listWallets: vi.fn().mockReturnValue([entry('pw-active', [])])
    }
    const result = checkActiveWalletInVault(ows, { vaultPath: undefined }, ACTIVE)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/no longer available/i)
  })

  it('normalizes case when matching the EVM account address against the active wallet', () => {
    const upperAddress = ACTIVE.address.toUpperCase()
    const ows = {
      listWallets: vi.fn().mockReturnValue([entry('pw-active', makeMatchingAccounts(upperAddress))])
    }
    const result = checkActiveWalletInVault(ows, { vaultPath: undefined }, ACTIVE)
    expect(result.ok).toBe(true)
  })

  it('passes when at least one account in the list matches (other accounts ignored)', () => {
    const ows = {
      listWallets: vi.fn().mockReturnValue([
        entry('pw-active', [
          { chainId: 'eip155:1', address: OTHER_ADDRESS, derivationPath: "m/44'/60'/0'/0/0" },
          {
            chainId: 'eip155:8453',
            address: ACTIVE.address,
            derivationPath: "m/44'/60'/0'/0/1"
          }
        ])
      ])
    }
    const result = checkActiveWalletInVault(ows, { vaultPath: undefined }, ACTIVE)
    expect(result.ok).toBe(true)
  })

  it('#240 RE1 — fails when the address matches but the account is on a non-EVM chain', () => {
    // CAIP-2 identifies the chain family. A non-EVM chain like Solana
    // could in principle carry the same address string in a vault, but
    // signing would dispatch to a chain family the user never intended.
    // The guard must only accept `eip155:*` accounts.
    const ows = {
      listWallets: vi.fn().mockReturnValue([
        entry('pw-active', [
          {
            chainId: 'solana:mainnet',
            address: ACTIVE.address,
            derivationPath: "m/44'/501'/0'/0'"
          }
        ])
      ])
    }
    const result = checkActiveWalletInVault(ows, { vaultPath: undefined }, ACTIVE)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/no longer available/i)
  })

  it('#240 RE1 — passes when a non-EVM account is present alongside a matching EVM account', () => {
    // The non-EVM account exists in the same wallet entry, but as long
    // as ONE eip155 account matches the active address, freshness is OK.
    const ows = {
      listWallets: vi.fn().mockReturnValue([
        entry('pw-active', [
          {
            chainId: 'solana:mainnet',
            address: ACTIVE.address,
            derivationPath: "m/44'/501'/0'/0'"
          },
          {
            chainId: 'eip155:8453',
            address: ACTIVE.address,
            derivationPath: "m/44'/60'/0'/0/0"
          }
        ])
      ])
    }
    const result = checkActiveWalletInVault(ows, { vaultPath: undefined }, ACTIVE)
    expect(result.ok).toBe(true)
  })

  it('address-mismatch error never leaks the vault path, active OWS name, or wallet address', () => {
    const ows = {
      listWallets: vi
        .fn()
        .mockReturnValue([entry('pw-active', makeMatchingAccounts(OTHER_ADDRESS))])
    }
    const result = checkActiveWalletInVault(
      ows,
      { vaultPath: '/private/var/folders/x/y/plottoon/vault.json' },
      ACTIVE
    )
    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.error).not.toContain('/private/var/folders')
    expect(result.error).not.toContain('vault.json')
    expect(result.error).not.toContain(ACTIVE.name)
    expect(result.error).not.toContain(ACTIVE.address)
    expect(result.error).not.toContain(OTHER_ADDRESS)
  })
})
