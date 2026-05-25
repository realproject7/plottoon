// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { TerminalPanel } from '../TerminalPanel'

interface MockSession {
  id: string
  projectId: string
  cwd: string
  state: 'connected' | 'disconnected' | 'exited'
  createdAt: string
  exitCode: number | null
  agentKind: 'claude' | 'codex' | null
}

function installApi(opts: {
  initial: MockSession | null
  createReturn?: MockSession
  connectOk?: boolean
  onConnect?: (sessionId: string, dims?: { cols?: number; rows?: number }) => void | Promise<void>
}): {
  findByProject: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  connect: ReturnType<typeof vi.fn>
} {
  const findByProject = vi.fn(async () => opts.initial)
  const create = vi.fn(async () => opts.createReturn)
  const connect = vi.fn(async (sid: string, dims?: { cols?: number; rows?: number }) => {
    await opts.onConnect?.(sid, dims)
    return opts.connectOk ?? true
  })
  ;(window as unknown as { plottoon: { terminal: Record<string, unknown> } }).plottoon = {
    terminal: {
      create,
      getSession: vi.fn(),
      findByProject,
      connect,
      write: vi.fn().mockResolvedValue(true),
      resize: vi.fn().mockResolvedValue(true),
      disconnect: vi.fn().mockResolvedValue(true),
      restart: vi.fn().mockResolvedValue(true),
      destroy: vi.fn(),
      onData: vi.fn(() => () => {}),
      onExit: vi.fn(() => () => {})
    }
  }
  return { findByProject, create, connect }
}

beforeEach(() => {
  ;(window as unknown as { plottoon: unknown }).plottoon = {}
})

afterEach(cleanup)

describe('#272 RE1 TerminalPanel — auto-start agent session on mount', () => {
  it('calls terminal.connect with current dims when the new session is disconnected and has a Claude agent', async () => {
    const session: MockSession = {
      id: 'term_1',
      projectId: 'proj_1',
      cwd: '/tmp/fake-project',
      state: 'disconnected',
      createdAt: '2026-05-25T00:00:00.000Z',
      exitCode: null,
      agentKind: 'claude'
    }
    const { findByProject, create, connect } = installApi({
      initial: null,
      createReturn: session,
      connectOk: true
    })
    render(<TerminalPanel projectId="proj_1" />)
    await waitFor(() => {
      expect(create).toHaveBeenCalledWith('proj_1')
    })
    await waitFor(() => {
      expect(connect).toHaveBeenCalledWith('term_1', expect.objectContaining({}))
    })
    expect(findByProject).toHaveBeenCalledWith('proj_1')
    // Pane title should be Claude session, not Agent session.
    await waitFor(() => {
      expect(screen.getByTestId('agent-terminal-title').textContent).toBe('Claude session')
    })
  })

  it('does NOT auto-connect when agentKind is null (no Claude/Codex installed)', async () => {
    const session: MockSession = {
      id: 'term_no_agent',
      projectId: 'proj_no_agent',
      cwd: '/tmp/fake-project',
      state: 'disconnected',
      createdAt: '2026-05-25T00:00:00.000Z',
      exitCode: null,
      agentKind: null
    }
    const { connect } = installApi({
      initial: null,
      createReturn: session,
      connectOk: true
    })
    render(<TerminalPanel projectId="proj_no_agent" />)
    // Wait for the no-agent hint to render — confirms init resolved
    // and we're in the steady state.
    await screen.findByTestId('agent-terminal-no-agent')
    expect(connect).not.toHaveBeenCalled()
  })

  it('does NOT auto-connect when reattaching to an already-connected existing session', async () => {
    const session: MockSession = {
      id: 'term_existing',
      projectId: 'proj_existing',
      cwd: '/tmp/fake-project',
      state: 'connected',
      createdAt: '2026-05-25T00:00:00.000Z',
      exitCode: null,
      agentKind: 'claude'
    }
    const { connect } = installApi({
      initial: session
    })
    render(<TerminalPanel projectId="proj_existing" />)
    await waitFor(() => {
      expect(screen.getByTestId('agent-terminal-title').textContent).toBe('Claude session')
    })
    expect(connect).not.toHaveBeenCalled()
  })

  it('does NOT auto-restart a session that exited (user clicks Restart explicitly)', async () => {
    const session: MockSession = {
      id: 'term_exited',
      projectId: 'proj_exited',
      cwd: '/tmp/fake-project',
      state: 'exited',
      createdAt: '2026-05-25T00:00:00.000Z',
      exitCode: 137,
      agentKind: 'claude'
    }
    const { connect } = installApi({
      initial: session
    })
    render(<TerminalPanel projectId="proj_exited" />)
    await waitFor(() => {
      // The status line shows "exited (137)".
      expect(screen.getByText(/exited \(137\)/)).toBeDefined()
    })
    expect(connect).not.toHaveBeenCalled()
  })
})

describe('#272 RE1 TerminalPanel — no-agent UX (production path when no CLI detected)', () => {
  it('renders the no-agent hint AND hides Connect / Restart buttons when agentKind is null', async () => {
    const session: MockSession = {
      id: 'term_no_agent_2',
      projectId: 'proj_no_agent_2',
      cwd: '/tmp/fake-project',
      state: 'disconnected',
      createdAt: '2026-05-25T00:00:00.000Z',
      exitCode: null,
      agentKind: null
    }
    installApi({ initial: session })
    render(<TerminalPanel projectId="proj_no_agent_2" />)
    const hint = await screen.findByTestId('agent-terminal-no-agent')
    expect(hint.textContent).toMatch(/No AI agent CLI available/i)
    expect(hint.textContent).toMatch(/install Claude or Codex/i)
    // Crucially: Connect + Restart buttons are NOT in the DOM, so a
    // user click can't trigger the shell fallback at the IPC layer.
    expect(screen.queryByTestId('agent-terminal-connect')).toBeNull()
    expect(screen.queryByTestId('agent-terminal-restart')).toBeNull()
  })

  it('renders Connect AND Restart buttons when agentKind is non-null (Claude/Codex)', async () => {
    const session: MockSession = {
      id: 'term_claude',
      projectId: 'proj_claude',
      cwd: '/tmp/fake-project',
      state: 'disconnected',
      createdAt: '2026-05-25T00:00:00.000Z',
      exitCode: null,
      agentKind: 'claude'
    }
    // Stub `connect` to fail so the session stays in 'ready' phase
    // and the buttons render. (Auto-start fires `connect` on mount; if
    // it succeeds we'd be in 'connected' phase + see disconnect/
    // restart instead.)
    installApi({ initial: session, connectOk: false })
    render(<TerminalPanel projectId="proj_claude" />)
    await waitFor(() => {
      expect(screen.getByTestId('agent-terminal-connect')).toBeDefined()
      expect(screen.getByTestId('agent-terminal-restart')).toBeDefined()
    })
    expect(screen.queryByTestId('agent-terminal-no-agent')).toBeNull()
  })
})
