// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import FDBFactory from 'fake-indexeddb/lib/FDBFactory'
import { TerminalPanel } from '../TerminalPanel'
import { writeScrollback } from '../terminalScrollback'

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
  activeWalletAddress?: string | null
  onData?: (handler: (sid: string, data: string) => void) => () => void
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
  ;(
    window as unknown as { plottoon: { terminal: Record<string, unknown>; wallet?: unknown } }
  ).plottoon = {
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
      onData: opts.onData ? vi.fn(opts.onData) : vi.fn(() => () => {}),
      onExit: vi.fn(() => () => {})
    },
    wallet: {
      getActiveIdentity: vi.fn(async () =>
        opts.activeWalletAddress
          ? { address: opts.activeWalletAddress, source: 'plottoon-writer' }
          : null
      )
    }
  }
  return { findByProject, create, connect }
}

beforeEach(() => {
  ;(window as unknown as { plottoon: unknown }).plottoon = {}
  // #273: fresh IDB per test so scrollback content can't bleed across.
  ;(globalThis as { indexedDB: IDBFactory }).indexedDB = new FDBFactory() as unknown as IDBFactory
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
  it('renders the no-agent hint AND hides lifecycle controls when agentKind is null', async () => {
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
    // #274: Resume / Start Fresh / Stop are NOT in the DOM, so a
    // user click can't trigger the shell fallback at the IPC layer.
    expect(screen.queryByTestId('agent-terminal-resume')).toBeNull()
    expect(screen.queryByTestId('agent-terminal-start-fresh')).toBeNull()
    expect(screen.queryByTestId('agent-terminal-stop')).toBeNull()
  })

  it('renders Resume + Start Fresh when agentKind is non-null and session is stopped', async () => {
    const session: MockSession = {
      id: 'term_claude',
      projectId: 'proj_claude',
      cwd: '/tmp/fake-project',
      state: 'disconnected',
      createdAt: '2026-05-25T00:00:00.000Z',
      exitCode: null,
      agentKind: 'claude'
    }
    // #274: stub `connect` to fail so the session stays in 'ready'
    // phase (auto-start fires; on failure reducer stays in ready) and
    // the disconnected toolbar renders.
    installApi({ initial: session, connectOk: false })
    render(<TerminalPanel projectId="proj_claude" />)
    await waitFor(() => {
      expect(screen.getByTestId('agent-terminal-resume')).toBeDefined()
      expect(screen.getByTestId('agent-terminal-start-fresh')).toBeDefined()
    })
    expect(screen.queryByTestId('agent-terminal-no-agent')).toBeNull()
  })
})

describe('#273 TerminalPanel — scrollback restore (uses fake content only)', () => {
  const WALLET_A = '0xaaaa000000000000000000000000000000000001'
  const WALLET_B = '0xbbbb000000000000000000000000000000000002'

  it('restores persisted scrollback for (wallet, project) on mount', async () => {
    // Seed the renderer's IDB with fake content for (wallet A,
    // proj_restore). Simulates a previous session leaving its
    // scrollback on disk.
    await writeScrollback(WALLET_A, 'proj_restore', 'fake-scrollback-from-prior-session\r\n')
    const session: MockSession = {
      id: 'term_restore',
      projectId: 'proj_restore',
      cwd: '/tmp/fake-project',
      state: 'connected',
      createdAt: '2026-05-25T00:00:00.000Z',
      exitCode: null,
      agentKind: 'claude'
    }
    installApi({
      initial: session,
      activeWalletAddress: WALLET_A
    })
    const { container } = render(<TerminalPanel projectId="proj_restore" />)
    // xterm renders the prior content into the xterm viewport — assert
    // it lands in the DOM. jsdom's xterm rendering is text-only so the
    // distinctive marker appears as plain text.
    await waitFor(() => {
      expect(container.textContent ?? '').toContain('fake-scrollback-from-prior-session')
    })
  })

  it('does NOT show wallet A’s scrollback when wallet B is active', async () => {
    // Seed wallet A's scrollback for the project.
    await writeScrollback(
      WALLET_A,
      'proj_shared',
      'WALLET_A_PRIVATE_FAKE_SCROLLBACK_SHOULD_NOT_LEAK'
    )
    const session: MockSession = {
      id: 'term_shared',
      projectId: 'proj_shared',
      cwd: '/tmp/fake-project',
      state: 'connected',
      createdAt: '2026-05-25T00:00:00.000Z',
      exitCode: null,
      agentKind: 'claude'
    }
    installApi({
      initial: session,
      // Wallet B is active — wallet A's scrollback must not leak.
      activeWalletAddress: WALLET_B
    })
    const { container } = render(<TerminalPanel projectId="proj_shared" />)
    // Wait for the panel title to render so we know the restore effect
    // has had a chance to run.
    await waitFor(() => {
      expect(screen.getByTestId('agent-terminal-title').textContent).toBe('Claude session')
    })
    // Give the restore effect a tick to settle.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(container.textContent ?? '').not.toContain('WALLET_A_PRIVATE_FAKE_SCROLLBACK')
  })

  it('flushes the previous wallet’s in-flight scrollback (debounce-tail data) before swapping owners', async () => {
    // #273 RE1 regression: data received within the 400 ms debounce
    // window before a wallet switch must be persisted to the previous
    // wallet's row, not lost. Test installs a custom onData that
    // captures the panel's data handler, fires fake content, then
    // immediately dispatches WALLET_ACTIVE_CHANGED_EVENT so the
    // restore effect runs before the debounce timer would fire.
    const session: MockSession = {
      id: 'term_switch',
      projectId: 'proj_switch',
      cwd: '/tmp/fake-project',
      state: 'connected',
      createdAt: '2026-05-25T00:00:00.000Z',
      exitCode: null,
      agentKind: 'claude'
    }
    let panelDataHandler: ((sid: string, data: string) => void) | null = null
    // Dynamic active wallet — flips from A to B when the test wants.
    let active: string | null = WALLET_A
    const findByProject = vi.fn(async () => session)
    const create = vi.fn(async () => session)
    const connect = vi.fn(async () => true)
    ;(
      window as unknown as { plottoon: { terminal: Record<string, unknown>; wallet: unknown } }
    ).plottoon = {
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
        onData: vi.fn((handler: (sid: string, data: string) => void) => {
          panelDataHandler = handler
          return () => {}
        }),
        onExit: vi.fn(() => () => {})
      },
      wallet: {
        getActiveIdentity: vi.fn(async () =>
          active ? { address: active, source: 'plottoon-writer' } : null
        )
      }
    }

    render(<TerminalPanel projectId="proj_switch" />)

    // Wait for the panel to mount + register its data handler.
    await waitFor(() => {
      expect(panelDataHandler).not.toBeNull()
    })
    // Also wait for the wallet-A scrollback restore effect to complete
    // so the in-flight content we're about to send belongs to A.
    await waitFor(() => {
      expect(screen.getByTestId('agent-terminal-title').textContent).toBe('Claude session')
    })

    // Fire fake content from the agent. Since the debounce is 400 ms,
    // this content sits in scrollbackRef but is NOT yet persisted.
    const FAKE_IN_FLIGHT = 'fake-debounced-content-must-not-be-lost-on-wallet-switch'
    panelDataHandler!('term_switch', FAKE_IN_FLIGHT)

    // Immediately switch wallets before the 400 ms debounce can fire.
    active = WALLET_B
    window.dispatchEvent(new CustomEvent('plottoon:wallet:active-changed'))

    // Wait for the IDB row to materialise under wallet A.
    const { readScrollback } = await import('../terminalScrollback')
    await waitFor(async () => {
      const got = await readScrollback(WALLET_A, 'proj_switch')
      expect(got).not.toBeNull()
      expect(got).toContain(FAKE_IN_FLIGHT)
    })
    // And wallet B's row never received any of A's content.
    const bGot = await readScrollback(WALLET_B, 'proj_switch')
    expect(bGot ?? '').not.toContain(FAKE_IN_FLIGHT)
  })

  it('renders an empty terminal when no scrollback was persisted for (wallet, project)', async () => {
    const session: MockSession = {
      id: 'term_empty',
      projectId: 'proj_empty',
      cwd: '/tmp/fake-project',
      state: 'connected',
      createdAt: '2026-05-25T00:00:00.000Z',
      exitCode: null,
      agentKind: 'claude'
    }
    installApi({
      initial: session,
      activeWalletAddress: WALLET_A
    })
    const { container } = render(<TerminalPanel projectId="proj_empty" />)
    await waitFor(() => {
      expect(screen.getByTestId('agent-terminal-title').textContent).toBe('Claude session')
    })
    // Sanity: no stray fake content from any prior test.
    expect(container.textContent ?? '').not.toContain('fake-scrollback-from-prior-session')
    expect(container.textContent ?? '').not.toContain('WALLET_A_PRIVATE_FAKE_SCROLLBACK')
  })
})
