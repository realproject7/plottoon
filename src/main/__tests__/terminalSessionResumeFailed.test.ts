import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  createSession,
  connectSession,
  destroySession,
  clearSessionsForTesting,
  getSession,
  RESUME_QUICK_EXIT_MS,
  type PtyHandle
} from '../services/terminalSession'

let tmpDir: string

beforeEach(() => {
  clearSessionsForTesting()
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'plottoon-resume-failed-'))
})

afterEach(() => {
  clearSessionsForTesting()
  rmSync(tmpDir, { recursive: true, force: true })
})

interface FakePty {
  handle: PtyHandle
  fireExit: (code: number | null) => void
}

function fakePty(): FakePty {
  const exitHandlers: Array<(e: { exitCode: number | null }) => void> = []
  const handle: PtyHandle = {
    onData() {},
    onExit(h) {
      exitHandlers.push(h)
    },
    write() {},
    resize() {},
    kill() {}
  }
  return {
    handle,
    fireExit(code) {
      exitHandlers.forEach((h) => h({ exitCode: code }))
    }
  }
}

describe('#274 connectSession — resume-failed classification', () => {
  it('flips state to resume-failed when a resume session exits within RESUME_QUICK_EXIT_MS', async () => {
    const pty = fakePty()
    const session = createSession({
      projectId: 'proj_rf',
      cwd: tmpDir,
      walletAddress: null,
      agentKind: 'claude'
    })
    await connectSession(
      session.id,
      () => {},
      () => {},
      { spawner: () => pty.handle, mode: 'resume' }
    )
    expect(getSession(session.id)?.state).toBe('connected')

    // Simulate a quick agent exit (Claude rejecting --resume <uuid>).
    pty.fireExit(1)
    expect(getSession(session.id)?.state).toBe('resume-failed')
    expect(getSession(session.id)?.exitCode).toBe(1)
  })

  it('flips state to exited (not resume-failed) when a fresh session exits quickly', async () => {
    const pty = fakePty()
    const session = createSession({
      projectId: 'proj_fresh_quick',
      cwd: tmpDir,
      walletAddress: null,
      agentKind: 'claude'
    })
    await connectSession(
      session.id,
      () => {},
      () => {},
      { spawner: () => pty.handle, mode: 'fresh' }
    )
    pty.fireExit(0)
    expect(getSession(session.id)?.state).toBe('exited')
  })

  it('flips state to exited (not resume-failed) when a resume session exits after the threshold', async () => {
    vi.useFakeTimers()
    try {
      const pty = fakePty()
      const session = createSession({
        projectId: 'proj_rf_late',
        cwd: tmpDir,
        walletAddress: null,
        agentKind: 'claude'
      })
      await connectSession(
        session.id,
        () => {},
        () => {},
        { spawner: () => pty.handle, mode: 'resume' }
      )
      // Walk the clock past the threshold so the exit is treated as a
      // normal shutdown.
      vi.advanceTimersByTime(RESUME_QUICK_EXIT_MS + 1)
      pty.fireExit(0)
      expect(getSession(session.id)?.state).toBe('exited')
    } finally {
      vi.useRealTimers()
    }
  })

  it('onExit callback receives the original exit code; renderer uses getSession() to learn the new state', async () => {
    const pty = fakePty()
    let exitCode: number | null | undefined
    const session = createSession({
      projectId: 'proj_rf_cb',
      cwd: tmpDir,
      walletAddress: null,
      agentKind: 'claude'
    })
    await connectSession(
      session.id,
      () => {},
      (code) => {
        exitCode = code
      },
      { spawner: () => pty.handle, mode: 'resume' }
    )
    pty.fireExit(137)
    expect(exitCode).toBe(137)
    // The session meta carries the new state for the IPC handler to
    // forward to the renderer along with the exit event.
    expect(getSession(session.id)?.state).toBe('resume-failed')
  })

  it('does NOT classify a legacy null-agent session as resume-failed (mode normalises to fresh)', async () => {
    const pty = fakePty()
    const session = createSession({
      projectId: 'proj_legacy',
      cwd: tmpDir,
      walletAddress: null,
      agentKind: null
    })
    await connectSession(
      session.id,
      () => {},
      () => {},
      { spawner: () => pty.handle, mode: 'resume' }
    )
    pty.fireExit(0)
    // Legacy shell sessions can't "resume"; we always classify them as
    // exited.
    expect(getSession(session.id)?.state).toBe('exited')
  })

  it('clears launchInfo on disconnect so a later exit on a stale handle does NOT misclassify', async () => {
    const pty = fakePty()
    const session = createSession({
      projectId: 'proj_disconnect',
      cwd: tmpDir,
      walletAddress: null,
      agentKind: 'claude'
    })
    await connectSession(
      session.id,
      () => {},
      () => {},
      { spawner: () => pty.handle, mode: 'resume' }
    )
    destroySession(session.id)
    // Firing exit on a destroyed handle should be a no-op for state
    // updates — but if launchInfo lingered, a later create+connect
    // could pick up the stale resume marker. Re-create + connect to
    // verify the new session is classified independently.
    const fresh = createSession({
      projectId: 'proj_disconnect',
      cwd: tmpDir,
      walletAddress: null,
      agentKind: 'claude'
    })
    const pty2 = fakePty()
    await connectSession(
      fresh.id,
      () => {},
      () => {},
      { spawner: () => pty2.handle, mode: 'fresh' }
    )
    pty2.fireExit(0)
    expect(getSession(fresh.id)?.state).toBe('exited')
  })
})
