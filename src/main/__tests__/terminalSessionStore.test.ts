import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

let mockUserData = ''

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => mockUserData)
  }
}))

import {
  loadPersistedSessions,
  loadPersistedSession,
  upsertPersistedSession,
  removePersistedSession,
  listPersistedSessionsForWallet,
  buildSessionKey,
  type PersistedSession
} from '../services/terminalSessionStore'

const WALLET_A = '0xaaaa000000000000000000000000000000000001'
const WALLET_B = '0xbbbb000000000000000000000000000000000002'
const WALLET_A_CHECKSUM = '0xAAAA000000000000000000000000000000000001'

function makeRecord(overrides: Partial<PersistedSession> = {}): PersistedSession {
  return {
    walletAddress: WALLET_A,
    projectId: 'proj_1',
    agentKind: 'claude',
    cwd: '/tmp/fake-project',
    sessionId: '00000000-0000-4000-8000-000000000001',
    createdAt: '2026-05-25T00:00:00.000Z',
    lastConnectedAt: null,
    lastState: 'disconnected',
    resumeSupported: true,
    ...overrides
  }
}

beforeEach(() => {
  mockUserData = mkdtempSync(path.join(os.tmpdir(), 'plottoon-term-store-'))
})

afterEach(() => {
  if (mockUserData) rmSync(mockUserData, { recursive: true, force: true })
  mockUserData = ''
})

describe('#273 terminalSessionStore — round trip', () => {
  it('returns empty map on a fresh install (no file)', async () => {
    expect(await loadPersistedSessions()).toEqual({})
  })

  it('round-trips a single record', async () => {
    const record = makeRecord()
    await upsertPersistedSession(record)
    const loaded = await loadPersistedSession(record.walletAddress, record.projectId)
    expect(loaded).toEqual(record)
  })

  it('overwrites an existing record on upsert', async () => {
    await upsertPersistedSession(makeRecord())
    await upsertPersistedSession(
      makeRecord({
        lastConnectedAt: '2026-05-25T01:00:00.000Z',
        lastState: 'connected'
      })
    )
    const loaded = await loadPersistedSession(WALLET_A, 'proj_1')
    expect(loaded?.lastConnectedAt).toBe('2026-05-25T01:00:00.000Z')
    expect(loaded?.lastState).toBe('connected')
  })

  it('removes a record', async () => {
    await upsertPersistedSession(makeRecord())
    await removePersistedSession(WALLET_A, 'proj_1')
    expect(await loadPersistedSession(WALLET_A, 'proj_1')).toBeNull()
  })

  it('removal is a no-op on a missing record', async () => {
    await expect(removePersistedSession(WALLET_A, 'proj_missing')).resolves.toBeUndefined()
  })
})

describe('#273 terminalSessionStore — wallet scoping', () => {
  it('keys records by (walletAddress, projectId) — different wallets do not see each other', async () => {
    await upsertPersistedSession(makeRecord({ walletAddress: WALLET_A, projectId: 'proj_shared' }))
    await upsertPersistedSession(makeRecord({ walletAddress: WALLET_B, projectId: 'proj_shared' }))
    const a = await loadPersistedSession(WALLET_A, 'proj_shared')
    const b = await loadPersistedSession(WALLET_B, 'proj_shared')
    expect(a?.walletAddress).toBe(WALLET_A)
    expect(b?.walletAddress).toBe(WALLET_B)
    expect(a?.walletAddress).not.toBe(b?.walletAddress)
  })

  it('normalizes the wallet address on the lookup key so checksum/case mismatches resolve', async () => {
    await upsertPersistedSession(makeRecord({ walletAddress: WALLET_A_CHECKSUM }))
    const loaded = await loadPersistedSession(WALLET_A, 'proj_1')
    expect(loaded?.walletAddress).toBe(WALLET_A)
  })

  it('listPersistedSessionsForWallet filters to one wallet only', async () => {
    await upsertPersistedSession(makeRecord({ projectId: 'proj_a1' }))
    await upsertPersistedSession(makeRecord({ projectId: 'proj_a2' }))
    await upsertPersistedSession(makeRecord({ walletAddress: WALLET_B, projectId: 'proj_b1' }))
    const aSessions = await listPersistedSessionsForWallet(WALLET_A)
    const bSessions = await listPersistedSessionsForWallet(WALLET_B)
    expect(aSessions).toHaveLength(2)
    expect(bSessions).toHaveLength(1)
    expect(aSessions.every((s) => s.walletAddress === WALLET_A)).toBe(true)
    expect(bSessions[0].walletAddress).toBe(WALLET_B)
  })

  it('buildSessionKey lowercases the wallet address', () => {
    expect(buildSessionKey(WALLET_A_CHECKSUM, 'proj_x')).toBe(`${WALLET_A}:proj_x`)
  })
})

describe('#273 terminalSessionStore — sanitization (no secrets persisted)', () => {
  it('drops unknown fields the renderer might try to inject', async () => {
    const record = makeRecord({
      ANTHROPIC_API_KEY: 'fake-test-api-key-injected'
    } as unknown as PersistedSession)
    await upsertPersistedSession(record)
    const raw = await fs.readFile(
      path.join(mockUserData, 'config', 'terminal-sessions.json'),
      'utf-8'
    )
    expect(raw).not.toContain('fake-test-api-key-injected')
    expect(raw).not.toContain('ANTHROPIC_API_KEY')
  })

  it('rejects records with invalid agentKind (defense in depth on hand-edit)', async () => {
    // Hand-write a file with a bogus agentKind and assert the loader
    // drops it silently (does not surface a broken record).
    const file = {
      version: 1,
      sessions: {
        [`${WALLET_A}:proj_evil`]: {
          walletAddress: WALLET_A,
          projectId: 'proj_evil',
          agentKind: 'malicious',
          cwd: '/tmp/x',
          sessionId: 'x',
          createdAt: '2026-05-25T00:00:00.000Z',
          lastConnectedAt: null,
          lastState: 'disconnected',
          resumeSupported: true
        }
      }
    }
    await fs.mkdir(path.join(mockUserData, 'config'), { recursive: true })
    await fs.writeFile(
      path.join(mockUserData, 'config', 'terminal-sessions.json'),
      JSON.stringify(file),
      'utf-8'
    )
    const loaded = await loadPersistedSession(WALLET_A, 'proj_evil')
    expect(loaded).toBeNull()
  })

  it('resumeSupported only true when === true (defensive boolean coercion)', async () => {
    // Hand-write resumeSupported as a truthy non-boolean; reader
    // coerces to false.
    const file = {
      version: 1,
      sessions: {
        [`${WALLET_A}:proj_coerce`]: {
          walletAddress: WALLET_A,
          projectId: 'proj_coerce',
          agentKind: 'claude',
          cwd: '/tmp/x',
          sessionId: 'x',
          createdAt: '2026-05-25T00:00:00.000Z',
          lastConnectedAt: null,
          lastState: 'disconnected',
          resumeSupported: 'yes'
        }
      }
    }
    await fs.mkdir(path.join(mockUserData, 'config'), { recursive: true })
    await fs.writeFile(
      path.join(mockUserData, 'config', 'terminal-sessions.json'),
      JSON.stringify(file),
      'utf-8'
    )
    const loaded = await loadPersistedSession(WALLET_A, 'proj_coerce')
    expect(loaded?.resumeSupported).toBe(false)
  })
})

describe('#273 terminalSessionStore — no key/secret leakage on disk', () => {
  it('persisted file contains only the documented PersistedSession keys', async () => {
    await upsertPersistedSession(makeRecord())
    const raw = await fs.readFile(
      path.join(mockUserData, 'config', 'terminal-sessions.json'),
      'utf-8'
    )
    const parsed = JSON.parse(raw) as { sessions: Record<string, Record<string, unknown>> }
    const recordKeys = Object.keys(Object.values(parsed.sessions)[0]).sort()
    expect(recordKeys).toEqual([
      'agentKind',
      'createdAt',
      'cwd',
      'lastConnectedAt',
      'lastState',
      'projectId',
      'resumeSupported',
      'sessionId',
      'walletAddress'
    ])
  })

  it('persisted file never carries an env value even if the host has one set', async () => {
    const ORIGINAL = process.env.ATLASCLOUD_API_KEY
    const SECRET = 'fake-test-distinctive-atlas-key-9988-store'
    process.env.ATLASCLOUD_API_KEY = SECRET
    try {
      await upsertPersistedSession(makeRecord())
      const raw = await fs.readFile(
        path.join(mockUserData, 'config', 'terminal-sessions.json'),
        'utf-8'
      )
      expect(raw).not.toContain(SECRET)
    } finally {
      if (ORIGINAL === undefined) delete process.env.ATLASCLOUD_API_KEY
      else process.env.ATLASCLOUD_API_KEY = ORIGINAL
    }
  })
})
