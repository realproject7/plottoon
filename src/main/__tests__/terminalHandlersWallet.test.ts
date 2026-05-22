import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { registerTerminalHandlers } from '../ipc/terminalHandlers'
import { registerProject } from '../services/projectRegistry'
import { clearSessionsForTesting } from '../services/terminalSession'
import { normalizeWalletAddress, type WalletIdentity } from '../../shared/walletIdentity'
import type { WalletIdentityStore } from '../services/walletIdentityStore'

const ipcHandlers: Record<string, (...args: unknown[]) => unknown> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcHandlers[channel] = handler
    }
  },
  BrowserWindow: { fromWebContents: vi.fn() }
}))

const WALLET_A = '0xaaaa000000000000000000000000000000000001'
const WALLET_B = '0xbbbb000000000000000000000000000000000002'

function identity(address: string): WalletIdentity {
  return {
    address: normalizeWalletAddress(address),
    source: 'plottoon-writer',
    owsName: `plottoon-writer-${address.slice(-4)}`,
    registeredAt: '2026-05-22T00:00:00.000Z'
  }
}

function storeReturning(active: WalletIdentity | null): WalletIdentityStore {
  return {
    list: vi.fn().mockResolvedValue([]),
    getActive: vi.fn().mockResolvedValue(active),
    setActive: vi.fn(),
    clearActive: vi.fn(),
    register: vi.fn(),
    remove: vi.fn()
  }
}

interface MutableStore extends WalletIdentityStore {
  __setActive(identity: WalletIdentity | null): void
}

function mutableStore(initial: WalletIdentity | null): MutableStore {
  let current = initial
  return {
    list: vi.fn().mockResolvedValue([]),
    getActive: vi.fn(async () => current),
    setActive: vi.fn(),
    clearActive: vi.fn(),
    register: vi.fn(),
    remove: vi.fn(),
    __setActive(next) {
      current = next
    }
  }
}

let tmpDir: string

beforeEach(async () => {
  Object.keys(ipcHandlers).forEach((k) => delete ipcHandlers[k])
  clearSessionsForTesting()
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plottoon-term-iwallet-'))
})

afterEach(async () => {
  clearSessionsForTesting()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('terminalHandlers (#221 wallet scoping)', () => {
  it('terminal:create + terminal:findByProject return wallet A’s session under wallet A', async () => {
    registerTerminalHandlers({ walletIdentityStore: storeReturning(identity(WALLET_A)) })
    const projectId = registerProject(tmpDir)

    const created = (await ipcHandlers['terminal:create']({}, projectId)) as { id: string }
    const found = (await ipcHandlers['terminal:findByProject']({}, projectId)) as { id: string }
    expect(found.id).toBe(created.id)
  })

  it('terminal:findByProject returns null after the active wallet switches to B', async () => {
    const store = mutableStore(identity(WALLET_A))
    registerTerminalHandlers({ walletIdentityStore: store })
    const projectId = registerProject(tmpDir)

    await ipcHandlers['terminal:create']({}, projectId)
    // User switches to wallet B in the sidebar — main process active changes.
    store.__setActive(identity(WALLET_B))
    const found = await ipcHandlers['terminal:findByProject']({}, projectId)
    expect(found).toBeNull()
  })

  it('terminal:create under wallet B yields a different session than wallet A’s', async () => {
    const store = mutableStore(identity(WALLET_A))
    registerTerminalHandlers({ walletIdentityStore: store })
    const projectId = registerProject(tmpDir)

    const a = (await ipcHandlers['terminal:create']({}, projectId)) as { id: string }
    store.__setActive(identity(WALLET_B))
    const b = (await ipcHandlers['terminal:create']({}, projectId)) as { id: string }
    expect(b.id).not.toBe(a.id)
  })

  it('with no active wallet, terminal:create still works for legacy / one-wallet users', async () => {
    registerTerminalHandlers({ walletIdentityStore: storeReturning(null) })
    const projectId = registerProject(tmpDir)
    const created = (await ipcHandlers['terminal:create']({}, projectId)) as {
      id: string
      walletAddress: string | null
    }
    expect(created.id).toMatch(/^term_/)
    expect(created.walletAddress).toBeNull()
  })

  it('legacy null-wallet session is reattached to the first wallet that opens it', async () => {
    const store = mutableStore(null)
    registerTerminalHandlers({ walletIdentityStore: store })
    const projectId = registerProject(tmpDir)

    const legacy = (await ipcHandlers['terminal:create']({}, projectId)) as { id: string }
    // User connects a wallet (single-wallet → wallet-keyed migration path).
    store.__setActive(identity(WALLET_A))
    const found = (await ipcHandlers['terminal:findByProject']({}, projectId)) as {
      id: string
      walletAddress: string | null
    }
    expect(found.id).toBe(legacy.id)
    expect(found.walletAddress).toBe(normalizeWalletAddress(WALLET_A))
  })
})
