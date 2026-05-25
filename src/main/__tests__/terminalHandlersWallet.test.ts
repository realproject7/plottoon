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
// #273: the persistence store reads via electron `app.getPath('userData')`.
// Tests stash a fresh temp dir per beforeEach via mockUserData.
let mockUserData = ''

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcHandlers[channel] = handler
    }
  },
  BrowserWindow: { fromWebContents: vi.fn() },
  app: {
    getPath: vi.fn(() => mockUserData)
  }
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
  // #273: each test gets its own userData root so persisted session
  // metadata can't bleed across tests.
  mockUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'plottoon-term-userdata-'))
})

afterEach(async () => {
  clearSessionsForTesting()
  await fs.rm(tmpDir, { recursive: true, force: true })
  if (mockUserData) await fs.rm(mockUserData, { recursive: true, force: true })
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

describe('#273 terminalHandlers — restore persisted session metadata across restarts', () => {
  it('terminal:create returns a session adopted from the persisted store after restart', async () => {
    // First boot: create a wallet-A session for the project. This
    // persists the metadata (sessionId, agentKind, cwd, createdAt) to
    // <userData>/config/terminal-sessions.json under the (walletA,
    // projectId) key.
    registerTerminalHandlers({ walletIdentityStore: storeReturning(identity(WALLET_A)) })
    const projectId = registerProject(tmpDir)
    const first = (await ipcHandlers['terminal:create']({}, projectId)) as {
      id: string
      sessionId: string
      walletAddress: string | null
      agentKind: 'claude' | 'codex' | null
    }
    expect(first.sessionId).toBeTruthy()

    // Simulate app restart: drop the in-memory session table and
    // re-register the IPC handlers. The persisted file survives.
    clearSessionsForTesting()
    Object.keys(ipcHandlers).forEach((k) => delete ipcHandlers[k])
    registerTerminalHandlers({ walletIdentityStore: storeReturning(identity(WALLET_A)) })

    const restored = (await ipcHandlers['terminal:create']({}, projectId)) as {
      sessionId: string
      walletAddress: string | null
      agentKind: 'claude' | 'codex' | null
    }
    expect(restored.sessionId).toBe(first.sessionId)
    expect(restored.walletAddress).toBe(first.walletAddress)
    expect(restored.agentKind).toBe(first.agentKind)
  })

  it('wallet B does NOT receive wallet A’s persisted session for the same project', async () => {
    // Boot 1 under wallet A — persist that wallet's session.
    registerTerminalHandlers({ walletIdentityStore: storeReturning(identity(WALLET_A)) })
    const projectId = registerProject(tmpDir)
    const aSession = (await ipcHandlers['terminal:create']({}, projectId)) as {
      sessionId: string
    }

    // Boot 2 under wallet B — must NOT see A's persisted session.
    clearSessionsForTesting()
    Object.keys(ipcHandlers).forEach((k) => delete ipcHandlers[k])
    registerTerminalHandlers({ walletIdentityStore: storeReturning(identity(WALLET_B)) })

    const bSession = (await ipcHandlers['terminal:create']({}, projectId)) as {
      sessionId: string
      walletAddress: string | null
    }
    expect(bSession.sessionId).not.toBe(aSession.sessionId)
    expect(bSession.walletAddress).toBe(normalizeWalletAddress(WALLET_B))
  })

  it('persisted session file holds no secrets, env vars, or wallet material', async () => {
    const SECRET = 'fake-test-distinctive-atlas-secret-uvwx-9988'
    const ORIGINAL = process.env.ATLASCLOUD_API_KEY
    process.env.ATLASCLOUD_API_KEY = SECRET
    try {
      registerTerminalHandlers({ walletIdentityStore: storeReturning(identity(WALLET_A)) })
      const projectId = registerProject(tmpDir)
      await ipcHandlers['terminal:create']({}, projectId)
      const raw = await fs.readFile(
        path.join(mockUserData, 'config', 'terminal-sessions.json'),
        'utf-8'
      )
      expect(raw).not.toContain(SECRET)
      // No env keys, no OWS internal names, no vault paths leak.
      expect(raw).not.toContain('ATLASCLOUD_API_KEY')
      expect(raw).not.toContain('ANTHROPIC_API_KEY')
      expect(raw).not.toContain('plottoon-writer-')
    } finally {
      if (ORIGINAL === undefined) delete process.env.ATLASCLOUD_API_KEY
      else process.env.ATLASCLOUD_API_KEY = ORIGINAL
    }
  })
})
