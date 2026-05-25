import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  createSession,
  getSession,
  findSessionByProject,
  listSessions,
  connectSession,
  writeToSession,
  disconnectSession,
  restartSession,
  destroySession,
  clearSessionsForTesting,
  type PtyHandle
} from '../services/terminalSession'

let tmpDir: string

/**
 * #290: shared fake spawner so every connect/restart call goes through
 * a deterministic handle instead of `defaultAgentPtySpawner`. Without
 * this, environments where `node-pty` is installed try to spawn a real
 * PTY for the user's shell (or the configured agent), which is
 * fragile in CI (no `claude`/`codex` on PATH) and on developer
 * machines (PTY allocation can refuse with `posix_spawnp failed`).
 *
 * The handle is intentionally inert: data/exit handlers are stored but
 * never fired automatically. Tests that need to assert specific PTY
 * behaviour (input round-trip, exit events) live in
 * `terminalSessionAgent.test.ts` / `terminalSessionResumeFailed.test.ts`
 * and use a more capable fake there.
 */
function makeInertPty(): PtyHandle {
  return {
    onData() {},
    onExit() {},
    write() {},
    resize() {},
    kill() {}
  }
}

const fakeSpawner = (): PtyHandle => makeInertPty()

beforeEach(async () => {
  clearSessionsForTesting()
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plottoon-term-'))
})

afterEach(async () => {
  clearSessionsForTesting()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('createSession', () => {
  it('creates a session with correct metadata', () => {
    const session = createSession('proj_1', tmpDir, null)
    expect(session.id).toMatch(/^term_\d+$/)
    expect(session.projectId).toBe('proj_1')
    expect(session.cwd).toBe(tmpDir)
    expect(session.state).toBe('disconnected')
    expect(session.exitCode).toBeNull()
    expect(session.createdAt).toBeTruthy()
  })

  it('returns existing connected session for same project', async () => {
    const session = createSession('proj_1', tmpDir, null)
    await connectSession(
      session.id,
      () => {},
      () => {},
      { spawner: fakeSpawner }
    )
    const second = createSession('proj_1', tmpDir, null)
    expect(second.id).toBe(session.id)
    disconnectSession(session.id)
  })

  it('creates new session if existing is exited', async () => {
    const session = createSession('proj_1', tmpDir, null)
    await connectSession(
      session.id,
      () => {},
      () => {},
      { spawner: fakeSpawner }
    )
    disconnectSession(session.id)
    destroySession(session.id)
    const second = createSession('proj_1', tmpDir, null)
    expect(second.id).not.toBe(session.id)
  })
})

describe('getSession / findSessionByProject', () => {
  it('getSession returns null for unknown id', () => {
    expect(getSession('nonexistent')).toBeNull()
  })

  it('getSession returns the session', () => {
    const session = createSession('proj_1', tmpDir, null)
    expect(getSession(session.id)).toEqual(session)
  })

  it('findSessionByProject returns null when no sessions exist', () => {
    expect(findSessionByProject('proj_1')).toBeNull()
  })

  it('findSessionByProject returns the active session', () => {
    const session = createSession('proj_1', tmpDir, null)
    expect(findSessionByProject('proj_1')?.id).toBe(session.id)
  })
})

describe('listSessions', () => {
  it('returns empty array initially', () => {
    expect(listSessions()).toEqual([])
  })

  it('returns all sessions', () => {
    createSession('proj_1', tmpDir, null)
    createSession('proj_2', tmpDir, null)
    expect(listSessions()).toHaveLength(2)
  })
})

describe('connectSession / disconnectSession', () => {
  it('connects and transitions to connected state', async () => {
    const session = createSession('proj_1', tmpDir, null)
    const ok = await connectSession(
      session.id,
      () => {},
      () => {},
      { spawner: fakeSpawner }
    )
    expect(ok).toBe(true)
    expect(getSession(session.id)?.state).toBe('connected')
    disconnectSession(session.id)
  })

  it('returns false for unknown session', async () => {
    const result = await connectSession(
      'bad',
      () => {},
      () => {},
      { spawner: fakeSpawner }
    )
    expect(result).toBe(false)
  })

  it('returns false if already connected', async () => {
    const session = createSession('proj_1', tmpDir, null)
    await connectSession(
      session.id,
      () => {},
      () => {},
      { spawner: fakeSpawner }
    )
    const second = await connectSession(
      session.id,
      () => {},
      () => {},
      { spawner: fakeSpawner }
    )
    expect(second).toBe(false)
    disconnectSession(session.id)
  })

  it('disconnectSession transitions to disconnected', async () => {
    const session = createSession('proj_1', tmpDir, null)
    await connectSession(
      session.id,
      () => {},
      () => {},
      { spawner: fakeSpawner }
    )
    const ok = disconnectSession(session.id)
    expect(ok).toBe(true)
    expect(getSession(session.id)?.state).toBe('disconnected')
  })
})

describe('writeToSession', () => {
  it('returns false for disconnected session', () => {
    const session = createSession('proj_1', tmpDir, null)
    expect(writeToSession(session.id, 'test')).toBe(false)
  })

  it('returns true for connected session', async () => {
    const session = createSession('proj_1', tmpDir, null)
    await connectSession(
      session.id,
      () => {},
      () => {},
      { spawner: fakeSpawner }
    )
    expect(writeToSession(session.id, 'echo hi\n')).toBe(true)
    disconnectSession(session.id)
  })
})

describe('restartSession', () => {
  it('restarts a disconnected session', async () => {
    const session = createSession('proj_1', tmpDir, null)
    const ok = await restartSession(
      session.id,
      () => {},
      () => {},
      { spawner: fakeSpawner }
    )
    expect(ok).toBe(true)
    expect(getSession(session.id)?.state).toBe('connected')
    disconnectSession(session.id)
  })

  it('restarts a connected session', async () => {
    const session = createSession('proj_1', tmpDir, null)
    await connectSession(
      session.id,
      () => {},
      () => {},
      { spawner: fakeSpawner }
    )
    const ok = await restartSession(
      session.id,
      () => {},
      () => {},
      { spawner: fakeSpawner }
    )
    expect(ok).toBe(true)
    expect(getSession(session.id)?.state).toBe('connected')
    disconnectSession(session.id)
  })

  it('returns false for unknown session', async () => {
    const result = await restartSession(
      'bad',
      () => {},
      () => {},
      { spawner: fakeSpawner }
    )
    expect(result).toBe(false)
  })
})

describe('destroySession', () => {
  it('removes the session', () => {
    const session = createSession('proj_1', tmpDir, null)
    expect(destroySession(session.id)).toBe(true)
    expect(getSession(session.id)).toBeNull()
  })

  it('kills connected process', async () => {
    const session = createSession('proj_1', tmpDir, null)
    await connectSession(
      session.id,
      () => {},
      () => {},
      { spawner: fakeSpawner }
    )
    expect(destroySession(session.id)).toBe(true)
    expect(getSession(session.id)).toBeNull()
  })

  it('returns false for unknown session', () => {
    expect(destroySession('nonexistent')).toBe(false)
  })
})

describe('session metadata persists across navigation', () => {
  it('session survives after creation and can be found again', () => {
    const session = createSession('proj_1', tmpDir, null)
    const found = findSessionByProject('proj_1')
    expect(found?.id).toBe(session.id)
    expect(found?.cwd).toBe(tmpDir)
    expect(found?.projectId).toBe('proj_1')
  })
})

/**
 * #290: degrade-predictably guarantee. When the configured spawner
 * throws (e.g. node-pty's `pty.spawn(...)` rejecting the command with
 * `posix_spawnp failed`), `connectSession` must not bubble the error
 * out — the renderer relies on it returning a bool so it can show the
 * "couldn't connect" lifecycle state instead of crashing the panel.
 */
describe('#290 connectSession — spawner failure surfaces as a controlled false return', () => {
  it('returns false when the spawner throws synchronously, leaving the session in disconnected state', async () => {
    const session = createSession('proj_1', tmpDir, null)
    const throwingSpawner = (): PtyHandle => {
      throw new Error('posix_spawnp failed: ENOENT (test fixture)')
    }
    const ok = await connectSession(
      session.id,
      () => {},
      () => {},
      { spawner: throwingSpawner }
    )
    expect(ok).toBe(false)
    // Session state stays disconnected — no half-connected zombie that
    // a later disconnect would try to clean up.
    expect(getSession(session.id)?.state).toBe('disconnected')
  })

  it('returns false when the async spawner rejects, leaving the session in disconnected state', async () => {
    const session = createSession('proj_2', tmpDir, null)
    const asyncRejector = async (): Promise<PtyHandle> => {
      throw new Error('node-pty allocation refused (test fixture)')
    }
    const ok = await connectSession(
      session.id,
      () => {},
      () => {},
      { spawner: asyncRejector }
    )
    expect(ok).toBe(false)
    expect(getSession(session.id)?.state).toBe('disconnected')
  })

  it('a failed connect does not block a subsequent successful connect on the same session', async () => {
    // Proves the gen-rollback above keeps the session usable: a later
    // connect with a working spawner must still transition to connected.
    const session = createSession('proj_3', tmpDir, null)
    const fail = (): PtyHandle => {
      throw new Error('first attempt fails')
    }
    const firstOk = await connectSession(
      session.id,
      () => {},
      () => {},
      { spawner: fail }
    )
    expect(firstOk).toBe(false)
    const secondOk = await connectSession(
      session.id,
      () => {},
      () => {},
      { spawner: fakeSpawner }
    )
    expect(secondOk).toBe(true)
    expect(getSession(session.id)?.state).toBe('connected')
    disconnectSession(session.id)
  })
})
