/**
 * #297: agent sessions MUST run under a real PTY. When the spawner
 * can't allocate one, the renderer surfaces a recoverable error
 * instead of silently degrading to a pipe-based child_process — which
 * was the proximate cause of Claude exiting with a `--print` / `-p`
 * error in the workspace.
 *
 * This suite pins:
 *   - the spawner receives `requirePty: true` for any non-null
 *     agentKind session;
 *   - a `PtyUnavailableError` from the spawner flips the session to
 *     `pty-unavailable` state instead of leaving it disconnected;
 *   - generic spawner errors (the #290 path) still surface as
 *     disconnected;
 *   - legacy null-agent sessions are NOT promoted to pty-unavailable —
 *     they keep the pre-#297 pipe-fallback behaviour so existing tests
 *     and one-off recoveries still work.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  createSession,
  connectSession,
  destroySession,
  clearSessionsForTesting,
  getSession,
  PtyUnavailableError,
  type PtyHandle,
  type PtySpawnOptions
} from '../services/terminalSession'

let tmpDir: string

beforeEach(() => {
  clearSessionsForTesting()
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'plottoon-297-'))
})

afterEach(() => {
  clearSessionsForTesting()
  rmSync(tmpDir, { recursive: true, force: true })
})

function inertPty(): PtyHandle {
  return {
    onData() {},
    onExit() {},
    write() {},
    resize() {},
    kill() {}
  }
}

describe('#297 connectSession — agent sessions require a real PTY', () => {
  it('passes requirePty:true to the spawner for an agentKind=claude session', async () => {
    const calls: PtySpawnOptions[] = []
    const session = createSession({
      projectId: 'proj_req_claude',
      cwd: tmpDir,
      walletAddress: null,
      agentKind: 'claude'
    })
    await connectSession(
      session.id,
      () => {},
      () => {},
      {
        spawner: (options) => {
          calls.push(options)
          return inertPty()
        }
      }
    )
    expect(calls[0].requirePty).toBe(true)
    destroySession(session.id)
  })

  it('passes requirePty:true to the spawner for an agentKind=codex session', async () => {
    const calls: PtySpawnOptions[] = []
    const session = createSession({
      projectId: 'proj_req_codex',
      cwd: tmpDir,
      walletAddress: null,
      agentKind: 'codex'
    })
    await connectSession(
      session.id,
      () => {},
      () => {},
      {
        spawner: (options) => {
          calls.push(options)
          return inertPty()
        }
      }
    )
    expect(calls[0].requirePty).toBe(true)
    destroySession(session.id)
  })

  it('passes requirePty:false for a legacy null-agent session (pipe fallback still allowed)', async () => {
    const calls: PtySpawnOptions[] = []
    const session = createSession({
      projectId: 'proj_req_legacy',
      cwd: tmpDir,
      walletAddress: null,
      agentKind: null
    })
    await connectSession(
      session.id,
      () => {},
      () => {},
      {
        spawner: (options) => {
          calls.push(options)
          return inertPty()
        }
      }
    )
    expect(calls[0].requirePty).toBe(false)
    destroySession(session.id)
  })

  it('PtyUnavailableError flips the session to state=pty-unavailable (recoverable)', async () => {
    const session = createSession({
      projectId: 'proj_pty_fail',
      cwd: tmpDir,
      walletAddress: null,
      agentKind: 'claude'
    })
    const ok = await connectSession(
      session.id,
      () => {},
      () => {},
      {
        spawner: () => {
          throw new PtyUnavailableError('Could not allocate a PTY (test fixture)')
        }
      }
    )
    expect(ok).toBe(false)
    expect(getSession(session.id)?.state).toBe('pty-unavailable')
  })

  it('a generic spawner error (NOT PtyUnavailableError) leaves the session in disconnected state', async () => {
    // #290 path — preserved unchanged. The pty-unavailable state is
    // reserved for the specific "no real TTY available" failure mode.
    const session = createSession({
      projectId: 'proj_pty_generic',
      cwd: tmpDir,
      walletAddress: null,
      agentKind: 'claude'
    })
    const ok = await connectSession(
      session.id,
      () => {},
      () => {},
      {
        spawner: () => {
          throw new Error('generic spawn failure unrelated to PTY (test fixture)')
        }
      }
    )
    expect(ok).toBe(false)
    expect(getSession(session.id)?.state).toBe('disconnected')
  })

  it('legacy null-agent session: PtyUnavailableError does NOT flip to pty-unavailable (only agent sessions surface it)', async () => {
    // Defense in depth: the renderer treats `pty-unavailable` as an
    // agent-specific recovery state. Legacy null-agent paths never
    // require PTY in the first place, so they shouldn't be promoted
    // into this state even if a spawner throws PtyUnavailableError.
    const session = createSession({
      projectId: 'proj_pty_legacy',
      cwd: tmpDir,
      walletAddress: null,
      agentKind: null
    })
    const ok = await connectSession(
      session.id,
      () => {},
      () => {},
      {
        spawner: () => {
          throw new PtyUnavailableError('test fixture')
        }
      }
    )
    expect(ok).toBe(false)
    expect(getSession(session.id)?.state).toBe('disconnected')
  })

  it('a successful connect after a pty-unavailable failure transitions back to connected', async () => {
    // Proves the renderer's Retry button can actually recover: if the
    // user fixes their dev environment + clicks retry, the second
    // connect succeeds and the lifecycle returns to normal.
    const session = createSession({
      projectId: 'proj_pty_recovery',
      cwd: tmpDir,
      walletAddress: null,
      agentKind: 'claude'
    })
    await connectSession(
      session.id,
      () => {},
      () => {},
      {
        spawner: () => {
          throw new PtyUnavailableError('test fixture')
        }
      }
    )
    expect(getSession(session.id)?.state).toBe('pty-unavailable')

    const ok = await connectSession(
      session.id,
      () => {},
      () => {},
      { spawner: () => inertPty() }
    )
    expect(ok).toBe(true)
    expect(getSession(session.id)?.state).toBe('connected')
    destroySession(session.id)
  })
})
