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
  clearSessionsForTesting
} from '../services/terminalSession'

let tmpDir: string

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
    connectSession(
      session.id,
      () => {},
      () => {}
    )
    const second = createSession('proj_1', tmpDir, null)
    expect(second.id).toBe(session.id)
    disconnectSession(session.id)
  })

  it('creates new session if existing is exited', async () => {
    const session = createSession('proj_1', tmpDir, null)
    connectSession(
      session.id,
      () => {},
      () => {}
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
  it('connects and transitions to connected state', () => {
    const session = createSession('proj_1', tmpDir, null)
    const ok = connectSession(
      session.id,
      () => {},
      () => {}
    )
    expect(ok).toBe(true)
    expect(getSession(session.id)?.state).toBe('connected')
    disconnectSession(session.id)
  })

  it('returns false for unknown session', () => {
    expect(
      connectSession(
        'bad',
        () => {},
        () => {}
      )
    ).toBe(false)
  })

  it('returns false if already connected', () => {
    const session = createSession('proj_1', tmpDir, null)
    connectSession(
      session.id,
      () => {},
      () => {}
    )
    expect(
      connectSession(
        session.id,
        () => {},
        () => {}
      )
    ).toBe(false)
    disconnectSession(session.id)
  })

  it('disconnectSession transitions to disconnected', () => {
    const session = createSession('proj_1', tmpDir, null)
    connectSession(
      session.id,
      () => {},
      () => {}
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

  it('returns true for connected session', () => {
    const session = createSession('proj_1', tmpDir, null)
    connectSession(
      session.id,
      () => {},
      () => {}
    )
    expect(writeToSession(session.id, 'echo hi\n')).toBe(true)
    disconnectSession(session.id)
  })
})

describe('restartSession', () => {
  it('restarts a disconnected session', () => {
    const session = createSession('proj_1', tmpDir, null)
    const ok = restartSession(
      session.id,
      () => {},
      () => {}
    )
    expect(ok).toBe(true)
    expect(getSession(session.id)?.state).toBe('connected')
    disconnectSession(session.id)
  })

  it('restarts a connected session', () => {
    const session = createSession('proj_1', tmpDir, null)
    connectSession(
      session.id,
      () => {},
      () => {}
    )
    const ok = restartSession(
      session.id,
      () => {},
      () => {}
    )
    expect(ok).toBe(true)
    expect(getSession(session.id)?.state).toBe('connected')
    disconnectSession(session.id)
  })

  it('returns false for unknown session', () => {
    expect(
      restartSession(
        'bad',
        () => {},
        () => {}
      )
    ).toBe(false)
  })
})

describe('destroySession', () => {
  it('removes the session', () => {
    const session = createSession('proj_1', tmpDir, null)
    expect(destroySession(session.id)).toBe(true)
    expect(getSession(session.id)).toBeNull()
  })

  it('kills connected process', () => {
    const session = createSession('proj_1', tmpDir, null)
    connectSession(
      session.id,
      () => {},
      () => {}
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
