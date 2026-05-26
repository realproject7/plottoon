// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import FDBFactory from 'fake-indexeddb/lib/FDBFactory'
import { TerminalPanel } from '../TerminalPanel'

interface MockSession {
  id: string
  projectId: string
  cwd: string
  state: 'connected' | 'disconnected' | 'exited' | 'resume-failed' | 'pty-unavailable'
  createdAt: string
  exitCode: number | null
  agentKind: 'claude' | 'codex' | null
}

interface InstallResult {
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  restart: ReturnType<typeof vi.fn>
  exitHandlers: Array<
    (sid: string, code: number | null, state: 'exited' | 'resume-failed' | 'disconnected') => void
  >
}

function install(opts: {
  initial: MockSession | null
  connectOk?: boolean
  /**
   * #297: when connect resolves to false, TerminalPanel re-fetches the
   * session via getSession to learn the post-failure state (e.g.
   * `pty-unavailable`). Tests that exercise that path pass this to
   * override what `getSession` returns.
   */
  refreshedAfterConnectFailure?: MockSession
}): InstallResult {
  const exitHandlers: InstallResult['exitHandlers'] = []
  const findByProject = vi.fn(async () => opts.initial)
  const create = vi.fn(async () => opts.initial)
  const connect = vi.fn(async () => opts.connectOk ?? true)
  const disconnect = vi.fn(async () => true)
  const destroy = vi.fn(async () => true)
  const restart = vi.fn(async () => true)
  const getSession = vi.fn(async () => opts.refreshedAfterConnectFailure ?? opts.initial)
  ;(
    window as unknown as { plottoon: { terminal: Record<string, unknown>; wallet?: unknown } }
  ).plottoon = {
    terminal: {
      create,
      getSession,
      findByProject,
      connect,
      write: vi.fn().mockResolvedValue(true),
      resize: vi.fn().mockResolvedValue(true),
      disconnect,
      restart,
      destroy,
      onData: vi.fn(() => () => {}),
      onExit: vi.fn(
        (
          handler: (
            sid: string,
            code: number | null,
            state: 'exited' | 'resume-failed' | 'disconnected'
          ) => void
        ) => {
          exitHandlers.push(handler)
          return () => {}
        }
      )
    },
    wallet: {
      getActiveIdentity: vi.fn(async () => null)
    }
  }
  return { connect, disconnect, destroy, restart, exitHandlers }
}

beforeEach(() => {
  ;(window as unknown as { plottoon: unknown }).plottoon = {}
  ;(globalThis as { indexedDB: IDBFactory }).indexedDB = new FDBFactory() as unknown as IDBFactory
})

afterEach(cleanup)

describe('#274 TerminalPanel — lifecycle controls', () => {
  it('connected → Stop calls terminal.disconnect (does NOT destroy)', async () => {
    const session: MockSession = {
      id: 'term_stop',
      projectId: 'proj_stop',
      cwd: '/tmp/fake-project',
      state: 'connected',
      createdAt: '2026-05-25T00:00:00.000Z',
      exitCode: null,
      agentKind: 'claude'
    }
    const api = install({ initial: session })
    render(<TerminalPanel projectId="proj_stop" />)
    const stopBtn = await screen.findByTestId('agent-terminal-stop')
    fireEvent.click(stopBtn)
    await waitFor(() => {
      expect(api.disconnect).toHaveBeenCalledWith('term_stop')
    })
    // Stop must never call destroy — the persisted meta survives.
    expect(api.destroy).not.toHaveBeenCalled()
  })

  it('disconnected + Claude → renders Resume + Start Fresh; Resume calls connect with mode:resume', async () => {
    const session: MockSession = {
      id: 'term_resume',
      projectId: 'proj_resume',
      cwd: '/tmp/fake-project',
      state: 'disconnected',
      createdAt: '2026-05-25T00:00:00.000Z',
      exitCode: null,
      agentKind: 'claude'
    }
    // Auto-connect on mount fires; force it to fail so the panel
    // stays in 'ready' state and the recovery toolbar renders.
    const api = install({ initial: session, connectOk: false })
    render(<TerminalPanel projectId="proj_resume" />)
    const resumeBtn = await screen.findByTestId('agent-terminal-resume')
    const freshBtn = screen.getByTestId('agent-terminal-start-fresh')
    expect(resumeBtn).toBeDefined()
    expect(freshBtn).toBeDefined()
    api.connect.mockClear()
    fireEvent.click(resumeBtn)
    await waitFor(() => {
      expect(api.connect).toHaveBeenCalledTimes(1)
    })
    const [sid, , opts] = api.connect.mock.calls[0]
    expect(sid).toBe('term_resume')
    expect(opts).toEqual({ mode: 'resume' })
  })

  it('Start Fresh from a disconnected session calls connect with mode:fresh (NOT restart)', async () => {
    const session: MockSession = {
      id: 'term_fresh',
      projectId: 'proj_fresh',
      cwd: '/tmp/fake-project',
      state: 'disconnected',
      createdAt: '2026-05-25T00:00:00.000Z',
      exitCode: null,
      agentKind: 'claude'
    }
    const api = install({ initial: session, connectOk: false })
    render(<TerminalPanel projectId="proj_fresh" />)
    const freshBtn = await screen.findByTestId('agent-terminal-start-fresh')
    api.connect.mockClear()
    fireEvent.click(freshBtn)
    await waitFor(() => {
      expect(api.connect).toHaveBeenCalledTimes(1)
    })
    const [, , opts] = api.connect.mock.calls[0]
    expect(opts).toEqual({ mode: 'fresh' })
    expect(api.restart).not.toHaveBeenCalled()
  })

  it('Start Fresh from a connected session calls restart (kill + relaunch)', async () => {
    const session: MockSession = {
      id: 'term_fresh_connected',
      projectId: 'proj_fresh_c',
      cwd: '/tmp/fake-project',
      state: 'connected',
      createdAt: '2026-05-25T00:00:00.000Z',
      exitCode: null,
      agentKind: 'claude'
    }
    const api = install({ initial: session })
    render(<TerminalPanel projectId="proj_fresh_c" />)
    const freshBtn = await screen.findByTestId('agent-terminal-start-fresh')
    fireEvent.click(freshBtn)
    await waitFor(() => {
      expect(api.restart).toHaveBeenCalledTimes(1)
    })
    expect(api.restart).toHaveBeenCalledWith('term_fresh_connected', expect.any(Object))
  })
})

describe('#274 TerminalPanel — detach does NOT kill the PTY', () => {
  it('Detach is a renderer-only state change — never calls terminal.disconnect or destroy', async () => {
    const session: MockSession = {
      id: 'term_detach',
      projectId: 'proj_detach',
      cwd: '/tmp/fake-project',
      state: 'connected',
      createdAt: '2026-05-25T00:00:00.000Z',
      exitCode: null,
      agentKind: 'claude'
    }
    const api = install({ initial: session })
    render(<TerminalPanel projectId="proj_detach" />)
    const detachBtn = await screen.findByTestId('agent-terminal-detach')
    fireEvent.click(detachBtn)
    // Detached hint is visible; Reattach button replaces Detach.
    expect(await screen.findByTestId('agent-terminal-detached-hint')).toBeDefined()
    expect(screen.queryByTestId('agent-terminal-detach')).toBeNull()
    expect(screen.getByTestId('agent-terminal-reattach')).toBeDefined()
    // Critically: no kill / destroy was invoked.
    expect(api.disconnect).not.toHaveBeenCalled()
    expect(api.destroy).not.toHaveBeenCalled()
    // Reattach returns to attached state.
    fireEvent.click(screen.getByTestId('agent-terminal-reattach'))
    await waitFor(() => {
      expect(screen.getByTestId('agent-terminal-detach')).toBeDefined()
    })
    expect(api.disconnect).not.toHaveBeenCalled()
    expect(api.destroy).not.toHaveBeenCalled()
  })
})

describe('#274 TerminalPanel — destroy requires explicit confirm', () => {
  it('first click sets confirm state but does NOT invoke terminal.destroy', async () => {
    const session: MockSession = {
      id: 'term_destroy',
      projectId: 'proj_destroy',
      cwd: '/tmp/fake-project',
      state: 'connected',
      createdAt: '2026-05-25T00:00:00.000Z',
      exitCode: null,
      agentKind: 'claude'
    }
    const api = install({ initial: session })
    render(<TerminalPanel projectId="proj_destroy" />)
    const destroyBtn = await screen.findByTestId('agent-terminal-destroy')
    expect(destroyBtn.textContent).toMatch(/^destroy$/)
    fireEvent.click(destroyBtn)
    await waitFor(() => {
      expect(screen.getByTestId('agent-terminal-destroy').textContent).toMatch(/confirm destroy/)
    })
    expect(api.destroy).not.toHaveBeenCalled()
    // Second click confirms.
    fireEvent.click(screen.getByTestId('agent-terminal-destroy'))
    await waitFor(() => {
      expect(api.destroy).toHaveBeenCalledWith('term_destroy')
    })
  })
})

describe('#291 TerminalPanel — restored resume-failed session does not auto-resume', () => {
  it('mounting with an initial session in state=resume-failed does NOT auto-call terminal.connect', async () => {
    // Simulates the post-restart path: terminal:create adopted a
    // persisted record whose lastState was resume-failed (#291). The
    // session payload returned to the renderer carries state=resume-
    // failed. The renderer must show the Start Fresh recovery surface
    // and skip the auto-connect-on-mount path entirely — otherwise the
    // app would loop on the same rejected --resume <uuid>.
    const restored: MockSession = {
      id: 'term_restored_rf',
      projectId: 'proj_restored_rf',
      cwd: '/tmp/fake-project',
      state: 'resume-failed',
      createdAt: '2026-05-25T00:00:00.000Z',
      exitCode: 1,
      agentKind: 'claude'
    }
    const api = install({ initial: restored })
    render(<TerminalPanel projectId="proj_restored_rf" />)

    // Recovery surface renders.
    expect(await screen.findByTestId('agent-terminal-resume-failed-hint')).toBeDefined()
    expect(screen.getByTestId('agent-terminal-start-fresh')).toBeDefined()
    // Status label reflects the resume-failed state.
    expect(screen.getByTestId('agent-terminal-status').textContent).toMatch(/resume failed/i)
    // Give the auto-connect effect a chance to fire — it must NOT.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(api.connect).not.toHaveBeenCalled()
  })

  it('Start Fresh from a restored resume-failed session calls connect with mode:fresh', async () => {
    // The recovery path: user clicks Start Fresh on the restored
    // resume-failed panel. Since the session is in 'ready' phase
    // (not 'connected'), handleStartFresh routes through connect
    // with mode:fresh (not restart). This is the explicit way out
    // of the restart loop.
    const restored: MockSession = {
      id: 'term_restored_rf_2',
      projectId: 'proj_restored_rf_2',
      cwd: '/tmp/fake-project',
      state: 'resume-failed',
      createdAt: '2026-05-25T00:00:00.000Z',
      exitCode: 1,
      agentKind: 'claude'
    }
    const api = install({ initial: restored })
    render(<TerminalPanel projectId="proj_restored_rf_2" />)
    const fresh = await screen.findByTestId('agent-terminal-start-fresh')
    fireEvent.click(fresh)
    await waitFor(() => {
      expect(api.connect).toHaveBeenCalledTimes(1)
    })
    const [, , opts] = api.connect.mock.calls[0]
    expect(opts).toEqual({ mode: 'fresh' })
    expect(api.restart).not.toHaveBeenCalled()
  })
})

describe('#274 TerminalPanel — resume-failed fallback', () => {
  it('IPC exit event with state=resume-failed flips the panel into the recovery surface', async () => {
    const session: MockSession = {
      id: 'term_rf',
      projectId: 'proj_rf',
      cwd: '/tmp/fake-project',
      state: 'connected',
      createdAt: '2026-05-25T00:00:00.000Z',
      exitCode: null,
      agentKind: 'claude'
    }
    const api = install({ initial: session })
    render(<TerminalPanel projectId="proj_rf" />)
    // Wait for the data/exit handler to register.
    await waitFor(() => {
      expect(api.exitHandlers.length).toBeGreaterThan(0)
    })
    // Simulate the main process firing exit with the resume-failed
    // classification (the new #274 payload).
    api.exitHandlers.forEach((h) => h('term_rf', 1, 'resume-failed'))
    // Resume-failed hint + Start Fresh recovery button render.
    expect(await screen.findByTestId('agent-terminal-resume-failed-hint')).toBeDefined()
    expect(screen.getByTestId('agent-terminal-start-fresh')).toBeDefined()
    // The status label reflects the resume-failed state.
    expect(screen.getByTestId('agent-terminal-status').textContent).toMatch(/resume failed/i)
  })

  it('exit event with state=exited shows the regular exited surface (no resume-failed hint)', async () => {
    const session: MockSession = {
      id: 'term_exit',
      projectId: 'proj_exit',
      cwd: '/tmp/fake-project',
      state: 'connected',
      createdAt: '2026-05-25T00:00:00.000Z',
      exitCode: null,
      agentKind: 'claude'
    }
    const api = install({ initial: session })
    render(<TerminalPanel projectId="proj_exit" />)
    await waitFor(() => {
      expect(api.exitHandlers.length).toBeGreaterThan(0)
    })
    api.exitHandlers.forEach((h) => h('term_exit', 0, 'exited'))
    await waitFor(() => {
      expect(screen.getByTestId('agent-terminal-status').textContent).toMatch(/exited/)
    })
    expect(screen.queryByTestId('agent-terminal-resume-failed-hint')).toBeNull()
    expect(screen.getByTestId('agent-terminal-start-fresh')).toBeDefined()
  })
})

describe('#274 TerminalPanel — agent identity badge', () => {
  it('shows "Claude session" when agentKind is claude', async () => {
    const session: MockSession = {
      id: 'term_c',
      projectId: 'proj_c',
      cwd: '/tmp/fake-project',
      state: 'connected',
      createdAt: '2026-05-25T00:00:00.000Z',
      exitCode: null,
      agentKind: 'claude'
    }
    install({ initial: session })
    render(<TerminalPanel projectId="proj_c" />)
    // #290 RE1: the title element exists immediately as "Agent session"
    // during the init phase, before the init effect resolves and the
    // reducer flips to a `connected`/`ready` state with the agent
    // identity. `findByTestId` returned the still-`init` element on
    // slow CI runs, so we poll the textContent with `waitFor` until the
    // post-dispatch text settles.
    await waitFor(() => {
      expect(screen.getByTestId('agent-terminal-title').textContent).toBe('Claude session')
    })
  })

  it('shows "Codex session" when agentKind is codex', async () => {
    const session: MockSession = {
      id: 'term_cx',
      projectId: 'proj_cx',
      cwd: '/tmp/fake-project',
      state: 'connected',
      createdAt: '2026-05-25T00:00:00.000Z',
      exitCode: null,
      agentKind: 'codex'
    }
    install({ initial: session })
    render(<TerminalPanel projectId="proj_cx" />)
    await waitFor(() => {
      expect(screen.getByTestId('agent-terminal-title').textContent).toBe('Codex session')
    })
  })

  it('status-dot data-state attribute reflects the current phase', async () => {
    const session: MockSession = {
      id: 'term_dot',
      projectId: 'proj_dot',
      cwd: '/tmp/fake-project',
      state: 'connected',
      createdAt: '2026-05-25T00:00:00.000Z',
      exitCode: null,
      agentKind: 'claude'
    }
    install({ initial: session })
    render(<TerminalPanel projectId="proj_dot" />)
    const dot = await screen.findByTestId('agent-terminal-status-dot')
    expect(dot.getAttribute('data-state')).toBe('running')
  })
})

describe('#297 TerminalPanel — PTY-unavailable recovery surface', () => {
  it('auto-start that fails with pty-unavailable surfaces the recovery banner + Retry button', async () => {
    // Simulates the real bug: main process refused to allocate a PTY
    // (node-pty failed to load or `pty.spawn(...)` threw). The
    // auto-start path's `connect` returns false; TerminalPanel
    // re-fetches the session via getSession and sees state=
    // 'pty-unavailable'. The recovery surface renders.
    const initial: MockSession = {
      id: 'term_pty',
      projectId: 'proj_pty',
      cwd: '/tmp/fake-project',
      state: 'disconnected',
      createdAt: '2026-05-25T00:00:00.000Z',
      exitCode: null,
      agentKind: 'claude'
    }
    const refreshed: MockSession = { ...initial, state: 'pty-unavailable' }
    install({ initial, connectOk: false, refreshedAfterConnectFailure: refreshed })
    render(<TerminalPanel projectId="proj_pty" />)
    expect(await screen.findByTestId('agent-terminal-pty-unavailable-hint')).toBeDefined()
    expect(screen.getByTestId('agent-terminal-pty-retry')).toBeDefined()
    // Status label reflects the state.
    expect(screen.getByTestId('agent-terminal-status').textContent).toMatch(/PTY unavailable/i)
    // Status dot is the "failed" colour (red).
    expect(screen.getByTestId('agent-terminal-status-dot').getAttribute('data-state')).toBe(
      'pty-unavailable'
    )
  })

  it('Retry from a pty-unavailable surface calls connect with mode:fresh', async () => {
    // The Retry button on pty-unavailable wires through handleStartFresh
    // (same code path as Start Fresh from exited/resume-failed) which
    // sends mode:'fresh' — the only useful recovery once PTY is back.
    const initial: MockSession = {
      id: 'term_pty_retry',
      projectId: 'proj_pty_retry',
      cwd: '/tmp/fake-project',
      state: 'disconnected',
      createdAt: '2026-05-25T00:00:00.000Z',
      exitCode: null,
      agentKind: 'claude'
    }
    const refreshed: MockSession = { ...initial, state: 'pty-unavailable' }
    const api = install({ initial, connectOk: false, refreshedAfterConnectFailure: refreshed })
    render(<TerminalPanel projectId="proj_pty_retry" />)
    const retry = await screen.findByTestId('agent-terminal-pty-retry')
    api.connect.mockClear()
    fireEvent.click(retry)
    await waitFor(() => {
      expect(api.connect).toHaveBeenCalledTimes(1)
    })
    const [, , opts] = api.connect.mock.calls[0]
    expect(opts).toEqual({ mode: 'fresh' })
    // restart MUST NOT be called — the session never reached connected,
    // so there's nothing to kill + relaunch.
    expect(api.restart).not.toHaveBeenCalled()
  })

  it('mounting with initial state=pty-unavailable does NOT auto-call terminal.connect', async () => {
    // Same guarantee as the resume-failed restored case: an explicit
    // recoverable state must require user action to retry. Without
    // this, the renderer would loop on the same PTY-allocation
    // failure repeatedly.
    const restored: MockSession = {
      id: 'term_pty_restored',
      projectId: 'proj_pty_restored',
      cwd: '/tmp/fake-project',
      state: 'pty-unavailable',
      createdAt: '2026-05-25T00:00:00.000Z',
      exitCode: null,
      agentKind: 'claude'
    }
    const api = install({ initial: restored })
    render(<TerminalPanel projectId="proj_pty_restored" />)
    expect(await screen.findByTestId('agent-terminal-pty-unavailable-hint')).toBeDefined()
    // Allow the auto-connect effect a chance to fire — it must NOT.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(api.connect).not.toHaveBeenCalled()
  })
})
