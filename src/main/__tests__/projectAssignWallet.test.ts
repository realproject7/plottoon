import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { registerProjectHandlers } from '../ipc/projectHandlers'
import { registerProject } from '../services/projectRegistry'
import { normalizeWalletAddress, type WalletIdentity } from '../../shared/walletIdentity'
import type { WalletIdentityStore } from '../services/walletIdentityStore'

const ipcHandlers: Record<string, (...args: unknown[]) => unknown> = {}

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
  }
}))

const WALLET_A = '0xaaaa000000000000000000000000000000000001'
const WALLET_B = '0xbbbb000000000000000000000000000000000002'

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

function makeProjectOnDisk(parent: string, name: string, meta: Record<string, unknown>): string {
  const projectPath = path.join(parent, name)
  mkdirSync(projectPath, { recursive: true })
  writeFileSync(path.join(projectPath, 'project.json'), JSON.stringify(meta), 'utf-8')
  return projectPath
}

describe('project:assignWallet handler — RE1 strict legacy-only guard', () => {
  let tmp: string
  let projectAPath: string
  let projectLegacyPath: string

  beforeEach(() => {
    Object.keys(ipcHandlers).forEach((k) => delete ipcHandlers[k])
    tmp = mkdtempSync(path.join(os.tmpdir(), 'plottoon-assignguard-'))
    const now = '2026-05-22T00:00:00.000Z'
    projectAPath = makeProjectOnDisk(tmp, 'belongs-to-a', {
      name: 'A Story',
      version: 1,
      createdAt: now,
      updatedAt: now,
      wallet: { address: normalizeWalletAddress(WALLET_A), source: 'plottoon-writer' }
    })
    projectLegacyPath = makeProjectOnDisk(tmp, 'legacy-story', {
      name: 'Legacy Story',
      version: 1,
      createdAt: now,
      updatedAt: now
    })
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('rejects assigning when the project is already owned by a different wallet', async () => {
    registerProjectHandlers({ walletIdentityStore: fakeStore(makeIdentity(WALLET_B)) })
    const id = registerProject(projectAPath)

    // The project is stamped to wallet A; the active wallet is B. The handler
    // must refuse to reassign — otherwise a known projectId could move A's
    // project into B's view without a real transfer flow.
    await expect(ipcHandlers['project:assignWallet']({}, id)).rejects.toThrow(
      /already assigned to a different wallet/i
    )
  })

  it('stamps a legacy (unassigned) project onto the active wallet', async () => {
    registerProjectHandlers({ walletIdentityStore: fakeStore(makeIdentity(WALLET_B)) })
    const id = registerProject(projectLegacyPath)

    const result = (await ipcHandlers['project:assignWallet']({}, id)) as {
      ok: boolean
      meta: { wallet?: { address: string; source: string } }
    }
    expect(result.ok).toBe(true)
    expect(result.meta.wallet?.address).toBe(normalizeWalletAddress(WALLET_B))
    expect(result.meta.wallet?.source).toBe('plottoon-writer')
  })

  it('is a no-op when the project is already attached to the active wallet', async () => {
    registerProjectHandlers({ walletIdentityStore: fakeStore(makeIdentity(WALLET_A)) })
    const id = registerProject(projectAPath)

    const result = (await ipcHandlers['project:assignWallet']({}, id)) as {
      ok: boolean
      meta: { wallet?: { address: string } }
    }
    expect(result.ok).toBe(true)
    expect(result.meta.wallet?.address).toBe(normalizeWalletAddress(WALLET_A))
  })

  it('refuses to assign when there is no active wallet', async () => {
    registerProjectHandlers({ walletIdentityStore: fakeStore(null) })
    const id = registerProject(projectLegacyPath)
    await expect(ipcHandlers['project:assignWallet']({}, id)).rejects.toThrow(/no active wallet/i)
  })
})
