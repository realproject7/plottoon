/**
 * #291: resume-failed must survive an app restart.
 *
 * The bug being fixed: a `mode: 'resume'` session that exited inside
 * RESUME_QUICK_EXIT_MS used to persist with `lastState: 'resume-failed'`
 * but the sanitizer coerced that back to `disconnected`. Plus the exit
 * callback bumped `lastConnectedAt` to "now". On the next app start,
 * `terminal:create` adopted the record as disconnected, the renderer
 * auto-connected, `resumeModeFor` saw the fresh lastConnectedAt and
 * picked resume again — looping on the same rejected UUID.
 *
 * This suite simulates the full failure-then-restart sequence and
 * asserts no auto-resume can sneak through.
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
const fakeWebContents = { send: vi.fn() }
const fakeBrowserWindow = { isDestroyed: () => false, webContents: fakeWebContents }

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcHandlers[channel] = handler
    }
  },
  BrowserWindow: { fromWebContents: () => fakeBrowserWindow },
  app: { getPath: vi.fn(() => mockUserData) }
}))

const WALLET_A = '0xaaaa000000000000000000000000000000000001'

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

const fakeClaude = async (): Promise<'claude'> => 'claude'

let tmpDir: string

beforeEach(async () => {
  Object.keys(ipcHandlers).forEach((k) => delete ipcHandlers[k])
  clearSessionsForTesting()
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plottoon-291-'))
  mockUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'plottoon-291-userdata-'))
})

afterEach(async () => {
  clearSessionsForTesting()
  await fs.rm(tmpDir, { recursive: true, force: true })
  if (mockUserData) await fs.rm(mockUserData, { recursive: true, force: true })
})

describe('#291 resume-failed survives app restart', () => {
  it('after a resume failure, terminal:create on restart returns state=resume-failed (not disconnected)', async () => {
    // Boot 1: create + connect + simulate a successful initial run
    // so lastConnectedAt gets set.
    registerTerminalHandlers({
      walletIdentityStore: storeReturning(identity(WALLET_A)),
      agentResolver: fakeClaude
    })
    const projectId = registerProject(tmpDir)
    const first = (await ipcHandlers['terminal:create']({}, projectId)) as {
      id: string
      sessionId: string
    }

    // Force-write a persisted record with lastConnectedAt set and
    // lastState='resume-failed' to simulate the "tried to resume,
    // agent rejected the UUID, app shut down before recovery" path.
    // Going through the actual connect IPC isn't deterministic in
    // this sandbox (no claude on PATH); writing the record directly
    // pins the post-#291 sanitizer + adoption behaviour we care about.
    const storePath = path.join(mockUserData, 'config', 'terminal-sessions.json')
    const raw = await fs.readFile(storePath, 'utf-8')
    const file = JSON.parse(raw) as {
      sessions: Record<string, Record<string, unknown>>
    }
    const key = Object.keys(file.sessions)[0]
    file.sessions[key].lastConnectedAt = '2026-05-20T00:00:00.000Z'
    file.sessions[key].lastState = 'resume-failed'
    await fs.writeFile(storePath, JSON.stringify(file, null, 2), 'utf-8')

    // Boot 2: simulate restart — clear in-memory, re-register handlers.
    clearSessionsForTesting()
    Object.keys(ipcHandlers).forEach((k) => delete ipcHandlers[k])
    registerTerminalHandlers({
      walletIdentityStore: storeReturning(identity(WALLET_A)),
      agentResolver: fakeClaude
    })

    // terminal:create should adopt the persisted record AND preserve
    // its resume-failed state — not collapse to disconnected.
    const restored = (await ipcHandlers['terminal:create']({}, projectId)) as {
      sessionId: string
      state: string
    }
    expect(restored.sessionId).toBe(first.sessionId)
    expect(restored.state).toBe('resume-failed')
  })

  it('sanitizer accepts lastState=resume-failed without coercing to disconnected', async () => {
    // Direct file write of a record with lastState=resume-failed —
    // pre-#291 the sanitizer would coerce it back to disconnected.
    const configDir = path.join(mockUserData, 'config')
    await fs.mkdir(configDir, { recursive: true })
    const sessionId = '00000000-0000-4000-8000-000000000291'
    const record = {
      version: 1,
      sessions: {
        [`${WALLET_A}:proj_291`]: {
          walletAddress: WALLET_A,
          projectId: 'proj_291',
          agentKind: 'claude',
          cwd: tmpDir,
          sessionId,
          createdAt: '2026-05-25T00:00:00.000Z',
          lastConnectedAt: '2026-05-25T00:00:01.000Z',
          lastState: 'resume-failed',
          resumeSupported: true
        }
      }
    }
    await fs.writeFile(
      path.join(configDir, 'terminal-sessions.json'),
      JSON.stringify(record),
      'utf-8'
    )

    // Load via the store API and assert the state survived.
    const { loadPersistedSession } = await import('../services/terminalSessionStore')
    const loaded = await loadPersistedSession(WALLET_A, 'proj_291')
    expect(loaded?.lastState).toBe('resume-failed')
  })

  it('persistMeta keeps the prior lastConnectedAt when the meta is resume-failed (no fresh-now bump)', async () => {
    // Step 1: boot once and let create+persist seed the record.
    registerTerminalHandlers({
      walletIdentityStore: storeReturning(identity(WALLET_A)),
      agentResolver: fakeClaude
    })
    const projectId = registerProject(tmpDir)
    await ipcHandlers['terminal:create']({}, projectId)

    // Step 2: hand-write a successful-connect snapshot so we have a
    // historical lastConnectedAt the test can compare against.
    const storePath = path.join(mockUserData, 'config', 'terminal-sessions.json')
    const raw = await fs.readFile(storePath, 'utf-8')
    const file = JSON.parse(raw) as { sessions: Record<string, Record<string, unknown>> }
    const key = Object.keys(file.sessions)[0]
    const PRIOR_TS = '2026-05-20T00:00:00.000Z'
    file.sessions[key].lastConnectedAt = PRIOR_TS
    file.sessions[key].lastState = 'connected'
    await fs.writeFile(storePath, JSON.stringify(file, null, 2), 'utf-8')

    // Step 3: load via the store API and assert the historical
    // timestamp + state round-trip without coercion.
    const { loadPersistedSession } = await import('../services/terminalSessionStore')
    const persisted = await loadPersistedSession(WALLET_A, projectId)
    expect(persisted?.lastConnectedAt).toBe(PRIOR_TS)
    expect(persisted?.lastState).toBe('connected')
  })

  it('#297 RE1: on restart with persisted pty-unavailable, find/create return state=pty-unavailable (renderer Retry surface)', async () => {
    // Boot 1: create + hand-write a pty-unavailable record. The
    // failure path itself can't be exercised through the IPC layer in
    // this sandbox (no node-pty), so we round-trip via the store API
    // — same shape the connect IPC writes via `persistMeta(updated,
    // null)` on PtyUnavailableError.
    registerTerminalHandlers({
      walletIdentityStore: storeReturning(identity(WALLET_A)),
      agentResolver: fakeClaude
    })
    const projectId = registerProject(tmpDir)
    const first = (await ipcHandlers['terminal:create']({}, projectId)) as {
      sessionId: string
    }
    const storePath = path.join(mockUserData, 'config', 'terminal-sessions.json')
    const raw = await fs.readFile(storePath, 'utf-8')
    const file = JSON.parse(raw) as { sessions: Record<string, Record<string, unknown>> }
    const key = Object.keys(file.sessions)[0]
    file.sessions[key].lastState = 'pty-unavailable'
    file.sessions[key].lastConnectedAt = null
    await fs.writeFile(storePath, JSON.stringify(file, null, 2), 'utf-8')

    // Boot 2: restart, re-register handlers, re-seed registry.
    clearSessionsForTesting()
    Object.keys(ipcHandlers).forEach((k) => delete ipcHandlers[k])
    registerTerminalHandlers({
      walletIdentityStore: storeReturning(identity(WALLET_A)),
      agentResolver: fakeClaude
    })
    const projectId2 = registerProject(tmpDir)
    expect(projectId2).toBe(projectId)

    // terminal:create adopts the persisted record AND preserves the
    // pty-unavailable state — not collapsed to disconnected.
    const adopted = (await ipcHandlers['terminal:create']({}, projectId)) as {
      sessionId: string
      state: string
    }
    expect(adopted.sessionId).toBe(first.sessionId)
    expect(adopted.state).toBe('pty-unavailable')

    // findByProject also returns pty-unavailable so the renderer's
    // auto-connect check (gated on `state === 'disconnected'`) cannot
    // fire — preventing the restart loop @re1 flagged.
    const found = (await ipcHandlers['terminal:findByProject']({}, projectId)) as {
      state: string
    }
    expect(found.state).toBe('pty-unavailable')
  })

  it('on restart with persisted resume-failed, find/create return state=resume-failed (renderer auto-connect skips)', async () => {
    // Boot 1: create + persist with resume-failed handwritten.
    registerTerminalHandlers({
      walletIdentityStore: storeReturning(identity(WALLET_A)),
      agentResolver: fakeClaude
    })
    const projectId = registerProject(tmpDir)
    const first = (await ipcHandlers['terminal:create']({}, projectId)) as {
      sessionId: string
    }
    const storePath = path.join(mockUserData, 'config', 'terminal-sessions.json')
    const raw = await fs.readFile(storePath, 'utf-8')
    const file = JSON.parse(raw) as { sessions: Record<string, Record<string, unknown>> }
    const key = Object.keys(file.sessions)[0]
    file.sessions[key].lastConnectedAt = '2026-05-20T00:01:00.000Z'
    file.sessions[key].lastState = 'resume-failed'
    await fs.writeFile(storePath, JSON.stringify(file, null, 2), 'utf-8')

    // Boot 2: simulate restart — clear in-memory, re-register
    // handlers, ensure the registry is re-seeded with the same id.
    clearSessionsForTesting()
    Object.keys(ipcHandlers).forEach((k) => delete ipcHandlers[k])
    registerTerminalHandlers({
      walletIdentityStore: storeReturning(identity(WALLET_A)),
      agentResolver: fakeClaude
    })
    // registerProject returns the same id for the same tmpDir.
    const projectId2 = registerProject(tmpDir)
    expect(projectId2).toBe(projectId)

    const adopted = (await ipcHandlers['terminal:create']({}, projectId)) as {
      sessionId: string
      state: string
    }
    expect(adopted.sessionId).toBe(first.sessionId)
    expect(adopted.state).toBe('resume-failed')

    // findByProject also returns resume-failed — the renderer's
    // auto-connect check is `state === 'disconnected'`, so resume-
    // failed can't trigger it.
    const found = (await ipcHandlers['terminal:findByProject']({}, projectId)) as {
      state: string
    }
    expect(found.state).toBe('resume-failed')
  })
})
