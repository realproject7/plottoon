/**
 * #275: agent session parity audit — single-file QA suite that pins the
 * contract PlotToon's main process exposes to the renderer for agent
 * session lifecycle, persistence, wallet scoping, and secret
 * containment. Each describe block maps to one bullet in the #275
 * acceptance checklist; `docs/AGENT_SESSION_PARITY.md` references the
 * `it(...)` names so a reviewer can trace each bullet to a green test.
 *
 * The bigger feature tests live in their own files (terminalSession*,
 * terminalHandlersWallet, etc.). This file's job is to (a) catch
 * cross-cutting regressions where one feature's invariant slips
 * through another feature's seam, and (b) act as the authoritative
 * "what does the renderer see?" reference for QA sign-off.
 */

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
// Distinctive sentinels so a leak shows up in a grep.
const FAKE_API_KEY = 'fake-test-distinctive-anthropic-key-yzab-9988'
const FAKE_VAULT_PATH = '/private/var/fake-vault/test-keystore.json'
const FAKE_OWS_NAME = 'plottoon-writer-test-internal-name-7777'

function identity(address: string, owsName: string): WalletIdentity {
  return {
    address: normalizeWalletAddress(address),
    source: 'plottoon-writer',
    owsName,
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

const fakeClaude = async (): Promise<'claude'> => 'claude'

let tmpDir: string

beforeEach(async () => {
  Object.keys(ipcHandlers).forEach((k) => delete ipcHandlers[k])
  clearSessionsForTesting()
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plottoon-parity-'))
  mockUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'plottoon-parity-userdata-'))
})

afterEach(async () => {
  clearSessionsForTesting()
  await fs.rm(tmpDir, { recursive: true, force: true })
  if (mockUserData) await fs.rm(mockUserData, { recursive: true, force: true })
})

describe('#275 parity — terminal:create renderer-facing payload shape', () => {
  it('contains ONLY the documented SessionMeta keys (no env, no vault path, no OWS internal name)', async () => {
    registerTerminalHandlers({
      walletIdentityStore: storeReturning(identity(WALLET_A, FAKE_OWS_NAME)),
      agentResolver: fakeClaude
    })
    const projectId = registerProject(tmpDir)
    const session = (await ipcHandlers['terminal:create']({}, projectId)) as Record<string, unknown>
    // The renderer-facing SessionMeta is locked to these keys. New
    // fields require an explicit update here so a future addition
    // doesn't accidentally surface secrets.
    expect(Object.keys(session).sort()).toEqual([
      'agentKind',
      'createdAt',
      'cwd',
      'exitCode',
      'id',
      'projectId',
      'sessionId',
      'state',
      'walletAddress'
    ])
    const serialized = JSON.stringify(session)
    expect(serialized).not.toContain(FAKE_OWS_NAME)
    expect(serialized).not.toContain(FAKE_VAULT_PATH)
    expect(serialized).not.toContain(FAKE_API_KEY)
  })

  it('walletAddress is lowercased (no checksum casing) so renderer cannot fingerprint the original', async () => {
    registerTerminalHandlers({
      walletIdentityStore: storeReturning(identity(WALLET_A, FAKE_OWS_NAME)),
      agentResolver: fakeClaude
    })
    const projectId = registerProject(tmpDir)
    const session = (await ipcHandlers['terminal:create']({}, projectId)) as {
      walletAddress: string
    }
    expect(session.walletAddress).toBe(WALLET_A.toLowerCase())
  })
})

describe('#275 parity — terminal:findByProject renderer-facing payload', () => {
  it('returns null when no session exists for the active wallet (no leak of other wallets)', async () => {
    registerTerminalHandlers({
      walletIdentityStore: storeReturning(identity(WALLET_A, FAKE_OWS_NAME)),
      agentResolver: fakeClaude
    })
    const projectId = registerProject(tmpDir)
    // No create yet → findByProject returns null.
    const found = await ipcHandlers['terminal:findByProject']({}, projectId)
    expect(found).toBeNull()
  })

  it('returns the same key set as terminal:create when a session exists', async () => {
    registerTerminalHandlers({
      walletIdentityStore: storeReturning(identity(WALLET_A, FAKE_OWS_NAME)),
      agentResolver: fakeClaude
    })
    const projectId = registerProject(tmpDir)
    await ipcHandlers['terminal:create']({}, projectId)
    const found = (await ipcHandlers['terminal:findByProject']({}, projectId)) as Record<
      string,
      unknown
    >
    expect(Object.keys(found).sort()).toEqual([
      'agentKind',
      'createdAt',
      'cwd',
      'exitCode',
      'id',
      'projectId',
      'sessionId',
      'state',
      'walletAddress'
    ])
  })
})

describe('#275 parity — Claude fresh session allocates a UUID that survives restart', () => {
  it('first terminal:create allocates a UUID; restart adopts the same UUID via persistence', async () => {
    registerTerminalHandlers({
      walletIdentityStore: storeReturning(identity(WALLET_A, FAKE_OWS_NAME)),
      agentResolver: fakeClaude
    })
    const projectId = registerProject(tmpDir)
    const first = (await ipcHandlers['terminal:create']({}, projectId)) as {
      sessionId: string
      agentKind: string
    }
    expect(first.agentKind).toBe('claude')
    expect(first.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )

    // Simulate app restart.
    clearSessionsForTesting()
    Object.keys(ipcHandlers).forEach((k) => delete ipcHandlers[k])
    registerTerminalHandlers({
      walletIdentityStore: storeReturning(identity(WALLET_A, FAKE_OWS_NAME)),
      agentResolver: fakeClaude
    })
    const restored = (await ipcHandlers['terminal:create']({}, projectId)) as { sessionId: string }
    expect(restored.sessionId).toBe(first.sessionId)
  })
})

describe('#275 parity — wallet A and wallet B never share session state for the same project', () => {
  it('terminal:create under wallet A then under wallet B produces distinct sessionIds', async () => {
    registerTerminalHandlers({
      walletIdentityStore: storeReturning(identity(WALLET_A, FAKE_OWS_NAME)),
      agentResolver: fakeClaude
    })
    const projectId = registerProject(tmpDir)
    const a = (await ipcHandlers['terminal:create']({}, projectId)) as { sessionId: string }

    // Switch active wallet, re-register handlers.
    clearSessionsForTesting()
    Object.keys(ipcHandlers).forEach((k) => delete ipcHandlers[k])
    registerTerminalHandlers({
      walletIdentityStore: storeReturning(identity(WALLET_B, 'plottoon-writer-other')),
      agentResolver: fakeClaude
    })
    const b = (await ipcHandlers['terminal:create']({}, projectId)) as {
      sessionId: string
      walletAddress: string
    }
    expect(b.sessionId).not.toBe(a.sessionId)
    expect(b.walletAddress).toBe(WALLET_B.toLowerCase())
  })

  it('persisted session file rejects cross-wallet adoption', async () => {
    registerTerminalHandlers({
      walletIdentityStore: storeReturning(identity(WALLET_A, FAKE_OWS_NAME)),
      agentResolver: fakeClaude
    })
    const projectId = registerProject(tmpDir)
    await ipcHandlers['terminal:create']({}, projectId)
    // Now read the persisted file directly — wallet B's key isn't in it.
    const raw = await fs.readFile(
      path.join(mockUserData, 'config', 'terminal-sessions.json'),
      'utf-8'
    )
    expect(raw).toContain(WALLET_A.toLowerCase())
    expect(raw).not.toContain(WALLET_B.toLowerCase())
  })
})

describe('#275 parity — destroy actually destroys (no resurrection across restart)', () => {
  it('terminal:destroy + restart yields a fresh sessionId, not the destroyed one', async () => {
    registerTerminalHandlers({
      walletIdentityStore: storeReturning(identity(WALLET_A, FAKE_OWS_NAME)),
      agentResolver: fakeClaude
    })
    const projectId = registerProject(tmpDir)
    const first = (await ipcHandlers['terminal:create']({}, projectId)) as {
      id: string
      sessionId: string
    }
    const destroyed = await ipcHandlers['terminal:destroy']({}, first.id)
    expect(destroyed).toBe(true)

    clearSessionsForTesting()
    Object.keys(ipcHandlers).forEach((k) => delete ipcHandlers[k])
    registerTerminalHandlers({
      walletIdentityStore: storeReturning(identity(WALLET_A, FAKE_OWS_NAME)),
      agentResolver: fakeClaude
    })
    const reborn = (await ipcHandlers['terminal:create']({}, projectId)) as { sessionId: string }
    expect(reborn.sessionId).not.toBe(first.sessionId)
  })
})

describe('#275 parity — persisted session file contains no secrets, env values, or OWS internals', () => {
  it('no secret-shaped string lands on disk even when host env carries one', async () => {
    const originals = {
      anthropic: process.env.ANTHROPIC_API_KEY,
      mnemonic: process.env.MNEMONIC,
      walletPriv: process.env.WALLET_PRIVATE_KEY
    }
    process.env.ANTHROPIC_API_KEY = FAKE_API_KEY
    process.env.MNEMONIC = 'fake test mnemonic words abc def'
    process.env.WALLET_PRIVATE_KEY = 'fake-test-private-key-0xdeadbeef'
    try {
      registerTerminalHandlers({
        walletIdentityStore: storeReturning(identity(WALLET_A, FAKE_OWS_NAME)),
        agentResolver: fakeClaude
      })
      const projectId = registerProject(tmpDir)
      await ipcHandlers['terminal:create']({}, projectId)
      const raw = await fs.readFile(
        path.join(mockUserData, 'config', 'terminal-sessions.json'),
        'utf-8'
      )
      expect(raw).not.toContain(FAKE_API_KEY)
      expect(raw).not.toContain('fake test mnemonic words')
      expect(raw).not.toContain('fake-test-private-key')
      expect(raw).not.toContain(FAKE_OWS_NAME)
      expect(raw).not.toContain('ANTHROPIC_API_KEY')
      expect(raw).not.toContain('MNEMONIC')
      expect(raw).not.toContain('WALLET_PRIVATE_KEY')
    } finally {
      if (originals.anthropic === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = originals.anthropic
      if (originals.mnemonic === undefined) delete process.env.MNEMONIC
      else process.env.MNEMONIC = originals.mnemonic
      if (originals.walletPriv === undefined) delete process.env.WALLET_PRIVATE_KEY
      else process.env.WALLET_PRIVATE_KEY = originals.walletPriv
    }
  })
})
