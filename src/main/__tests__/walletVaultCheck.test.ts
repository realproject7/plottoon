import { describe, it, expect, vi } from 'vitest'
import { checkActiveWalletInVault } from '../services/walletVaultCheck'
import { OWS_UNAVAILABLE_MESSAGE } from '../services/owsAdapter'

const ACTIVE = { name: 'pw-active', address: '0xaaaa000000000000000000000000000000000001' }

function entry(name: string) {
  return {
    id: `fake-id-${name}`,
    name,
    accounts: [],
    createdAt: '2026-05-22T00:00:00.000Z'
  }
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
