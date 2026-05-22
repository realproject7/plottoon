import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { registerProjectHandlers } from '../ipc/projectHandlers'
import { normalizeWalletAddress, type WalletIdentity } from '../../shared/walletIdentity'
import type { WalletIdentityStore } from '../services/walletIdentityStore'

// Each test sets `mockUserData` and the mocked `app.getPath` reads it. This
// lets us simulate "no projects directory configured" (the config file is
// simply absent under a fresh userData root) without writing to a real
// userData path.
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
    owsName: `plottoon-writer-${address.slice(-4)}`,
    registeredAt: '2026-05-22T00:00:00.000Z'
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

interface DiscoverResult {
  owned: unknown[]
  legacy: unknown[]
  otherWallets: unknown[]
  errors: unknown[]
  activeAddress: string | null
}

describe('#243 project:discover — active wallet survives before projects directory is configured', () => {
  beforeEach(() => {
    Object.keys(ipcHandlers).forEach((k) => delete ipcHandlers[k])
    mockUserData = mkdtempSync(path.join(os.tmpdir(), 'plottoon-discover-userdata-'))
  })

  afterEach(() => {
    rmSync(mockUserData, { recursive: true, force: true })
  })

  it('returns the active wallet address even when no projects directory is configured', async () => {
    // First-run shape: a fresh userData root contains no `projectsDir` config
    // file, but the user has already connected/selected an OWS wallet so
    // `walletStore.getActive()` returns a real identity. The handler must
    // surface that address so the Projects screen can render the
    // active-wallet empty state instead of "No active wallet".
    registerProjectHandlers({ walletIdentityStore: fakeStore(makeIdentity(WALLET_A)) })

    const result = (await ipcHandlers['project:discover']()) as DiscoverResult

    expect(result.activeAddress).toBe(normalizeWalletAddress(WALLET_A))
    expect(result.owned).toEqual([])
    expect(result.legacy).toEqual([])
    expect(result.otherWallets).toEqual([])
    expect(result.errors).toEqual([])
  })

  it('still returns null activeAddress when there is genuinely no active wallet', async () => {
    // Guard the inverse: "No active wallet" must keep working when no wallet
    // has been selected, regardless of whether the projects directory has
    // been configured.
    registerProjectHandlers({ walletIdentityStore: fakeStore(null) })

    const result = (await ipcHandlers['project:discover']()) as DiscoverResult

    expect(result.activeAddress).toBeNull()
    expect(result.owned).toEqual([])
    expect(result.legacy).toEqual([])
  })

  it('partitions existing projects when projects directory IS configured and a wallet is active', async () => {
    // Sanity check that the existing happy path is untouched by the
    // pre-resolved-address change.
    const projectsDir = mkdtempSync(path.join(os.tmpdir(), 'plottoon-discover-projects-'))
    try {
      // Write the projectsDir config under the mocked userData so
      // getProjectsDir() picks it up.
      const configDir = path.join(mockUserData, 'config')
      mkdirSync(configDir, { recursive: true })
      writeFileSync(path.join(configDir, 'projectsDir'), projectsDir, 'utf-8')

      // Drop one project owned by WALLET_A onto disk.
      const ownedPath = path.join(projectsDir, 'owned-story')
      mkdirSync(ownedPath, { recursive: true })
      writeFileSync(
        path.join(ownedPath, 'project.json'),
        JSON.stringify({
          name: 'Owned Story',
          version: 1,
          createdAt: '2026-05-22T00:00:00.000Z',
          updatedAt: '2026-05-22T00:00:00.000Z',
          wallet: { address: normalizeWalletAddress(WALLET_A), source: 'plottoon-writer' }
        }),
        'utf-8'
      )

      registerProjectHandlers({ walletIdentityStore: fakeStore(makeIdentity(WALLET_A)) })
      const result = (await ipcHandlers['project:discover']()) as DiscoverResult

      expect(result.activeAddress).toBe(normalizeWalletAddress(WALLET_A))
      expect(result.owned).toHaveLength(1)
      expect(result.otherWallets).toHaveLength(0)
    } finally {
      rmSync(projectsDir, { recursive: true, force: true })
    }
  })

  it('does not leak the projects directory path or wallet metadata into the discover payload when no directory is configured', async () => {
    // The early-return path returns synthetic empty buckets — make sure it
    // never accidentally includes the projects directory, OWS internal
    // wallet name, or any other field beyond the public partition shape.
    registerProjectHandlers({ walletIdentityStore: fakeStore(makeIdentity(WALLET_A)) })
    const result = (await ipcHandlers['project:discover']()) as DiscoverResult

    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('owsName')
    expect(serialized).not.toContain('plottoon-writer-0001')
    expect(serialized).not.toContain(mockUserData)
    expect(serialized).not.toContain('projectsDir')
    // Only the documented PartitionedDiscovery keys are present.
    expect(Object.keys(result).sort()).toEqual([
      'activeAddress',
      'errors',
      'legacy',
      'otherWallets',
      'owned'
    ])
  })
})
