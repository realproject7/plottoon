import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { registerProjectHandlers } from '../ipc/projectHandlers'
import { normalizeWalletAddress, type WalletIdentity } from '../../shared/walletIdentity'
import type { WalletIdentityStore } from '../services/walletIdentityStore'
import type { PublishConfig } from '../services/plotlinkPublish'

let mockUserData = ''

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcHandlers[channel] = handler
    }
  },
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: {
    fromWebContents: vi.fn(),
    getFocusedWindow: vi.fn()
  },
  app: {
    getPath: vi.fn(() => mockUserData)
  }
}))

const ipcHandlers: Record<string, (...args: unknown[]) => unknown> = {}

const WALLET_A = '0xaaaa000000000000000000000000000000000001'

function makeIdentity(address: string): WalletIdentity {
  return {
    address: normalizeWalletAddress(address),
    source: 'plottoon-writer',
    owsName: 'plottoon-writer-distinctive-internal-selector',
    registeredAt: '2026-05-24T00:00:00.000Z'
  }
}

function fakeStore(active: WalletIdentity | null): WalletIdentityStore {
  return {
    list: vi.fn().mockResolvedValue([]),
    getActive: vi.fn().mockResolvedValue(active),
    setActive: vi.fn(),
    clearActive: vi.fn(),
    register: vi.fn(),
    remove: vi.fn()
  }
}

const PUBLISH_CONFIG_VALID: PublishConfig = {
  rpcUrl: 'https://example-rpc.invalid',
  plotlinkBaseUrl: 'https://example-plotlink.invalid',
  storyFactoryAddress: '0xdead000000000000000000000000000000000001',
  mcv2BondAddress: '0xdead000000000000000000000000000000000002',
  indexRetries: 10,
  indexRetryDelayMs: 30000,
  indexInitialDelayMs: 8000
}

interface Report {
  generatedAt: string
  sections: Array<{
    title: string
    checks: Array<{ id: string; label: string; status: string; detail: string }>
  }>
}

function findCheck(report: Report, id: string) {
  return report.sections.flatMap((s) => s.checks).find((c) => c.id === id)
}

describe('#253 capability:getReport handler wiring', () => {
  beforeEach(() => {
    Object.keys(ipcHandlers).forEach((k) => delete ipcHandlers[k])
    mockUserData = mkdtempSync(path.join(os.tmpdir(), 'plottoon-cap-userdata-'))
  })

  afterEach(() => {
    rmSync(mockUserData, { recursive: true, force: true })
  })

  it('passes the active wallet from the identity store into the wallet check', async () => {
    registerProjectHandlers({
      walletIdentityStore: fakeStore(makeIdentity(WALLET_A)),
      capabilityContext: { publishConfig: PUBLISH_CONFIG_VALID, signerMode: 'live' }
    })
    const report = (await ipcHandlers['capability:getReport']()) as Report
    const wallet = findCheck(report, 'wallet')
    expect(wallet?.status).toBe('pass')
    expect(wallet?.detail).toContain('0xaaaa')
    expect(wallet?.detail).toContain('plottoon-writer')
  })

  it('reports wallet fail when no active wallet is selected', async () => {
    registerProjectHandlers({
      walletIdentityStore: fakeStore(null),
      capabilityContext: { publishConfig: PUBLISH_CONFIG_VALID, signerMode: 'live' }
    })
    const report = (await ipcHandlers['capability:getReport']()) as Report
    const wallet = findCheck(report, 'wallet')
    expect(wallet?.status).toBe('fail')
    expect(wallet?.detail).toMatch(/no active wallet/i)
  })

  it('passes the publish config + signer mode through to the PlotLink check', async () => {
    registerProjectHandlers({
      walletIdentityStore: fakeStore(makeIdentity(WALLET_A)),
      capabilityContext: { publishConfig: PUBLISH_CONFIG_VALID, signerMode: 'live' }
    })
    const report = (await ipcHandlers['capability:getReport']()) as Report
    const plotLink = findCheck(report, 'plotlink-endpoint')
    expect(plotLink?.status).toBe('pass')
    expect(plotLink?.detail).toContain('example-plotlink.invalid')
    expect(plotLink?.detail).not.toMatch(/placeholder/i)
  })

  it('surfaces signer-mode as info', async () => {
    registerProjectHandlers({
      walletIdentityStore: fakeStore(makeIdentity(WALLET_A)),
      capabilityContext: { publishConfig: PUBLISH_CONFIG_VALID, signerMode: 'mock' }
    })
    const report = (await ipcHandlers['capability:getReport']()) as Report
    const signer = findCheck(report, 'signer-mode')
    expect(signer?.status).toBe('info')
    expect(signer?.detail).toMatch(/Mock/i)
  })

  it('write-access fail surfaces CTA pointing to the Projects screen when no projects dir is configured', async () => {
    // Fresh userData with no projectsDir config file → write-access fails
    // with the new actionable detail.
    registerProjectHandlers({
      walletIdentityStore: fakeStore(makeIdentity(WALLET_A)),
      capabilityContext: { publishConfig: PUBLISH_CONFIG_VALID, signerMode: 'live' }
    })
    const report = (await ipcHandlers['capability:getReport']()) as Report
    const write = findCheck(report, 'write-access')
    expect(write?.status).toBe('fail')
    expect(write?.detail).toMatch(/No projects directory configured/)
    expect(write?.detail).toMatch(/Projects screen/)
  })

  it('write-access passes when a projects dir is configured and writable', async () => {
    const projectsDir = mkdtempSync(path.join(os.tmpdir(), 'plottoon-cap-projects-'))
    try {
      const configDir = path.join(mockUserData, 'config')
      mkdirSync(configDir, { recursive: true })
      writeFileSync(path.join(configDir, 'projectsDir'), projectsDir, 'utf-8')

      registerProjectHandlers({
        walletIdentityStore: fakeStore(makeIdentity(WALLET_A)),
        capabilityContext: { publishConfig: PUBLISH_CONFIG_VALID, signerMode: 'live' }
      })
      const report = (await ipcHandlers['capability:getReport']()) as Report
      const write = findCheck(report, 'write-access')
      expect(write?.status).toBe('pass')
    } finally {
      rmSync(projectsDir, { recursive: true, force: true })
    }
  })

  it('renderer-safe view projection — capability report does not leak OWS internal name', async () => {
    // The active identity carries `owsName: 'plottoon-writer-distinctive-internal-selector'`.
    // That selector must never appear in the report payload — the handler
    // projects through `{address, source}` only, mirroring the #234 boundary
    // for wallet IPC.
    registerProjectHandlers({
      walletIdentityStore: fakeStore(makeIdentity(WALLET_A)),
      capabilityContext: { publishConfig: PUBLISH_CONFIG_VALID, signerMode: 'live' }
    })
    const report = (await ipcHandlers['capability:getReport']()) as Report
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('plottoon-writer-distinctive-internal-selector')
    expect(serialized).not.toContain('owsName')
  })

  describe('#253 RE1 — vault freshness gate', () => {
    const VAULT_PATH = '/private/var/folders/SENSITIVE/vault.json'

    function vaultConfig() {
      return { vaultPath: VAULT_PATH }
    }

    function owsModuleWithEntries(
      entries: Array<{
        name: string
        id?: number
        accounts: Array<{ chainId: string; address: string }>
      }>
    ) {
      return {
        listWallets: vi.fn().mockReturnValue(
          entries.map((entry, i) => ({
            id: entry.id ?? i + 1,
            name: entry.name,
            accounts: entry.accounts
          }))
        )
      }
    }

    it('wallet fails when active identity is not in the vault (helper returns stale)', async () => {
      // Active identity points at a wallet that no longer exists in the
      // vault. Before #253 RE1 the Status page would still report
      // Wallet:pass — now the helper makes it fail with the generic
      // stale message.
      registerProjectHandlers({
        walletIdentityStore: fakeStore(makeIdentity(WALLET_A)),
        capabilityContext: {
          publishConfig: PUBLISH_CONFIG_VALID,
          signerMode: 'live',
          owsModule: owsModuleWithEntries([]),
          vaultConfig: vaultConfig()
        }
      })
      const report = (await ipcHandlers['capability:getReport']()) as Report
      const wallet = findCheck(report, 'wallet')
      expect(wallet?.status).toBe('fail')
      expect(wallet?.detail).toMatch(/no longer available/i)
    })

    it('publish-ready fails when freshness fails even with valid wallet + plotlink + CLI', async () => {
      registerProjectHandlers({
        walletIdentityStore: fakeStore(makeIdentity(WALLET_A)),
        capabilityContext: {
          publishConfig: PUBLISH_CONFIG_VALID,
          signerMode: 'live',
          owsModule: owsModuleWithEntries([]),
          vaultConfig: vaultConfig()
        }
      })
      const report = (await ipcHandlers['capability:getReport']()) as Report
      const publish = findCheck(report, 'publish-ready')
      expect(publish?.status).toBe('fail')
    })

    it('wallet fails when vault has a same-name entry on a non-EVM chain (mismatch caught by helper)', async () => {
      // The identity carries owsName `plottoon-writer-distinctive-internal-selector`
      // and a real EVM address. The vault has the same name + a Solana
      // account at that address but no EVM account. #240 RE1 rejects
      // this; the Status row must reflect that rejection.
      registerProjectHandlers({
        walletIdentityStore: fakeStore(makeIdentity(WALLET_A)),
        capabilityContext: {
          publishConfig: PUBLISH_CONFIG_VALID,
          signerMode: 'live',
          owsModule: owsModuleWithEntries([
            {
              name: 'plottoon-writer-distinctive-internal-selector',
              accounts: [{ chainId: 'solana:mainnet', address: WALLET_A }]
            }
          ]),
          vaultConfig: vaultConfig()
        }
      })
      const report = (await ipcHandlers['capability:getReport']()) as Report
      const wallet = findCheck(report, 'wallet')
      expect(wallet?.status).toBe('fail')
    })

    it('wallet passes when the vault has a matching name + EVM account at the active address', async () => {
      registerProjectHandlers({
        walletIdentityStore: fakeStore(makeIdentity(WALLET_A)),
        capabilityContext: {
          publishConfig: PUBLISH_CONFIG_VALID,
          signerMode: 'live',
          owsModule: owsModuleWithEntries([
            {
              name: 'plottoon-writer-distinctive-internal-selector',
              accounts: [{ chainId: 'eip155:8453', address: WALLET_A }]
            }
          ]),
          vaultConfig: vaultConfig()
        }
      })
      const report = (await ipcHandlers['capability:getReport']()) as Report
      const wallet = findCheck(report, 'wallet')
      expect(wallet?.status).toBe('pass')
      expect(wallet?.detail).toContain('0xaaaa')
    })

    it('mock signer mode skips the freshness check', async () => {
      // Mock mode: signing flows don't dispatch to OWS, so the Status
      // wallet row only requires identity presence (a missing vault
      // entry is acceptable while the user is iterating locally).
      registerProjectHandlers({
        walletIdentityStore: fakeStore(makeIdentity(WALLET_A)),
        capabilityContext: {
          publishConfig: PUBLISH_CONFIG_VALID,
          signerMode: 'mock',
          owsModule: owsModuleWithEntries([]),
          vaultConfig: vaultConfig()
        }
      })
      const report = (await ipcHandlers['capability:getReport']()) as Report
      const wallet = findCheck(report, 'wallet')
      expect(wallet?.status).toBe('pass')
    })

    it('freshness leak proof — vault path and OWS internals do not appear in the report payload', async () => {
      // Inject a vault entry whose accounts list throws when listWallets
      // is called, with an error referencing the sensitive vault path.
      // The helper collapses to the generic stale message; the report
      // must NOT carry the vault path string, the OWS internal name, or
      // a distinct vault-key fragment.
      const leakyOws = {
        listWallets: vi.fn(() => {
          throw new Error(`disk read EACCES ${VAULT_PATH}`)
        })
      }
      registerProjectHandlers({
        walletIdentityStore: fakeStore(makeIdentity(WALLET_A)),
        capabilityContext: {
          publishConfig: PUBLISH_CONFIG_VALID,
          signerMode: 'live',
          owsModule: leakyOws,
          vaultConfig: vaultConfig()
        }
      })
      const report = (await ipcHandlers['capability:getReport']()) as Report
      const wallet = findCheck(report, 'wallet')
      expect(wallet?.status).toBe('fail')
      // Generic message; specifically, the vault path and OWS internal
      // selector must not appear anywhere in the report.
      const serialized = JSON.stringify(report)
      expect(serialized).not.toContain(VAULT_PATH)
      expect(serialized).not.toContain('/private/var/folders')
      expect(serialized).not.toContain('plottoon-writer-distinctive-internal-selector')
      expect(serialized).not.toContain('owsName')
      expect(serialized).not.toContain('EACCES')
    })

    it('falls back to a generic stale-wallet message when the helper itself throws synchronously', async () => {
      // Defense in depth: if a future code path makes the helper throw
      // (not return ok:false), the handler must still surface a generic
      // message and never crash the IPC.
      const throwingOws = {
        listWallets: vi.fn(() => {
          // Cast through unknown so the throw type doesn't accidentally
          // satisfy the helper's catch — we want a hard throw.
          throw 'unexpected non-Error throw'
        })
      }
      registerProjectHandlers({
        walletIdentityStore: fakeStore(makeIdentity(WALLET_A)),
        capabilityContext: {
          publishConfig: PUBLISH_CONFIG_VALID,
          signerMode: 'live',
          owsModule: throwingOws,
          vaultConfig: vaultConfig()
        }
      })
      // Should not throw.
      const report = (await ipcHandlers['capability:getReport']()) as Report
      const wallet = findCheck(report, 'wallet')
      expect(wallet?.status).toBe('fail')
      expect(wallet?.detail).toMatch(/no longer available/i)
    })
  })
})
