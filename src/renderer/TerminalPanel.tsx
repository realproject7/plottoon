import { useEffect, useReducer, useRef, useCallback, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { readScrollback, writeScrollback, clearScrollback } from './terminalScrollback'
import { WALLET_ACTIVE_CHANGED_EVENT } from '../shared/walletIdentity'

interface Props {
  projectId: string
}

type AgentKind = 'claude' | 'codex' | null
type ExitState = 'exited' | 'resume-failed' | 'disconnected'

/**
 * #274: explicit session-lifecycle phases. `detached` is renderer-only:
 * the PTY in main is still running, but the panel has stopped piping
 * user input and shows a "Reattach" prompt. `resume-failed` is set when
 * the main process classifies a quick exit during a resume launch (see
 * `RESUME_QUICK_EXIT_MS` in terminalSession.ts) — the UX offers a
 * fresh launch as the recovery path.
 */
type State =
  | { phase: 'init' }
  | {
      phase: 'ready'
      sessionId: string
      state: 'disconnected' | 'exited' | 'resume-failed' | 'pty-unavailable'
      exitCode: number | null
      agentKind: AgentKind
    }
  | {
      phase: 'connected'
      sessionId: string
      agentKind: AgentKind
      detached: boolean
    }
  | { phase: 'error'; message: string }

type Action =
  | {
      type: 'session-created'
      sessionId: string
      state: 'connected' | 'disconnected' | 'exited' | 'resume-failed' | 'pty-unavailable'
      exitCode: number | null
      agentKind: AgentKind
    }
  | { type: 'connected'; sessionId: string; agentKind: AgentKind }
  | { type: 'exited'; code: number | null; exitState: ExitState }
  | { type: 'disconnected' }
  | { type: 'detach' }
  | { type: 'reattach' }
  | { type: 'error'; message: string }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'session-created':
      if (action.state === 'connected') {
        return {
          phase: 'connected',
          sessionId: action.sessionId,
          agentKind: action.agentKind,
          detached: false
        }
      }
      return {
        phase: 'ready',
        sessionId: action.sessionId,
        state: action.state as 'disconnected' | 'exited' | 'resume-failed' | 'pty-unavailable',
        exitCode: action.exitCode,
        agentKind: action.agentKind
      }
    case 'connected':
      return {
        phase: 'connected',
        sessionId: action.sessionId,
        agentKind: action.agentKind,
        detached: false
      }
    case 'exited': {
      if (state.phase !== 'connected') return state
      const nextState: 'exited' | 'resume-failed' =
        action.exitState === 'resume-failed' ? 'resume-failed' : 'exited'
      return {
        phase: 'ready',
        sessionId: state.sessionId,
        state: nextState,
        exitCode: action.code,
        agentKind: state.agentKind
      }
    }
    case 'disconnected':
      if (state.phase !== 'connected' && state.phase !== 'ready') return state
      return {
        phase: 'ready',
        sessionId: state.sessionId,
        state: 'disconnected',
        exitCode: null,
        agentKind: state.agentKind
      }
    case 'detach':
      if (state.phase !== 'connected') return state
      return { ...state, detached: true }
    case 'reattach':
      if (state.phase !== 'connected') return state
      return { ...state, detached: false }
    case 'error':
      return { phase: 'error', message: action.message }
  }
}

function agentLabel(agentKind: AgentKind): string {
  if (agentKind === 'claude') return 'Claude'
  if (agentKind === 'codex') return 'Codex'
  return 'No agent'
}

/**
 * #274: human-readable lifecycle phrase shown next to the agent badge.
 * Covers every renderer state the reducer can produce so the user
 * always knows where they stand without inspecting xterm output.
 */
function phaseLabel(state: State): string {
  switch (state.phase) {
    case 'init':
      return 'initializing…'
    case 'connected':
      return state.detached ? 'running (detached)' : 'running'
    case 'ready':
      if (state.state === 'disconnected') return 'stopped'
      if (state.state === 'exited') return `exited (${state.exitCode ?? '?'})`
      if (state.state === 'pty-unavailable') return 'PTY unavailable'
      return 'resume failed'
    case 'error':
      return 'error'
  }
}

/**
 * #274: status-dot colour. Mirrors plotlink-ows's tab indicator pattern
 * so users moving between the two apps can read state at a glance.
 */
function statusDotClass(state: State): string {
  switch (state.phase) {
    case 'connected':
      return state.detached
        ? 'terminal-panel__dot terminal-panel__dot--detached'
        : 'terminal-panel__dot terminal-panel__dot--running'
    case 'ready':
      if (state.state === 'resume-failed') return 'terminal-panel__dot terminal-panel__dot--failed'
      if (state.state === 'pty-unavailable')
        return 'terminal-panel__dot terminal-panel__dot--failed'
      if (state.state === 'exited') return 'terminal-panel__dot terminal-panel__dot--exited'
      return 'terminal-panel__dot terminal-panel__dot--stopped'
    case 'error':
      return 'terminal-panel__dot terminal-panel__dot--failed'
    case 'init':
    default:
      return 'terminal-panel__dot terminal-panel__dot--init'
  }
}

export function TerminalPanel({ projectId }: Props): JSX.Element {
  const [state, dispatch] = useReducer(reducer, { phase: 'init' })
  const [activeWallet, setActiveWallet] = useState<string | null>(null)
  // #274: inline destroy confirmation. We key it on the current phase
  // so a phase transition (e.g. PTY exit, restart) auto-clears the
  // confirm without needing an effect that calls setState in response
  // to phase changes. Derived value below.
  const [confirmPhase, setConfirmPhase] = useState<State['phase'] | null>(null)
  const confirmDestroy = confirmPhase === state.phase
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const inputDisposerRef = useRef<{ dispose(): void } | null>(null)
  const scrollbackRef = useRef<string>('')
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollbackOwnerRef = useRef<{ wallet: string; project: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      try {
        const id = await window.plottoon.wallet.getActiveIdentity()
        if (!cancelled) setActiveWallet(id?.address ?? null)
      } catch {
        if (!cancelled) setActiveWallet(null)
      }
    }
    load()
    const onChange = (): void => {
      void load()
    }
    window.addEventListener(WALLET_ACTIVE_CHANGED_EVENT, onChange)
    return () => {
      cancelled = true
      window.removeEventListener(WALLET_ACTIVE_CHANGED_EVENT, onChange)
    }
  }, [])

  useEffect(() => {
    if (!containerRef.current) return
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'SF Mono, ui-monospace, Menlo, monospace',
      fontSize: 12,
      convertEol: true,
      theme: {
        background: '#1f1f1f',
        foreground: '#e6e6e6',
        cursor: '#e6e6e6'
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    try {
      fit.fit()
    } catch {
      // Container may not be sized yet; ResizeObserver below handles it.
    }
    terminalRef.current = term
    fitRef.current = fit
    return () => {
      inputDisposerRef.current?.dispose()
      inputDisposerRef.current = null
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current)
        persistTimerRef.current = null
        const owner = scrollbackOwnerRef.current
        if (owner) void writeScrollback(owner.wallet, owner.project, scrollbackRef.current)
      }
      term.dispose()
      terminalRef.current = null
      fitRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(() => {
      const fit = fitRef.current
      const term = terminalRef.current
      if (!fit || !term) return
      try {
        fit.fit()
      } catch {
        return
      }
      if (sessionIdRef.current) {
        void window.plottoon.terminal.resize(sessionIdRef.current, term.cols, term.rows)
      }
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    async function init(): Promise<void> {
      try {
        let session = await window.plottoon.terminal.findByProject(projectId)
        if (!session) {
          session = await window.plottoon.terminal.create(projectId)
        }
        if (cancelled) return
        sessionIdRef.current = session.id
        dispatch({
          type: 'session-created',
          sessionId: session.id,
          state: session.state,
          exitCode: session.exitCode,
          agentKind: session.agentKind
        })
        // #274: auto-start preserves #272 behaviour — we connect a
        // disconnected session with a known agent. The IPC picks
        // mode='auto', which #273 resolves to 'resume' when a prior
        // connection exists, else 'fresh'. We deliberately do NOT
        // auto-relaunch resume-failed or exited sessions; the user
        // sees the recovery prompt and clicks Start Fresh.
        if (session.agentKind !== null && session.state === 'disconnected') {
          const term = terminalRef.current
          const dims = term ? { cols: term.cols, rows: term.rows } : undefined
          const ok = await window.plottoon.terminal.connect(session.id, dims)
          if (cancelled) return
          if (ok) {
            dispatch({
              type: 'connected',
              sessionId: session.id,
              agentKind: session.agentKind
            })
          } else {
            // #297: connect returned false — the main process either
            // hit a PtyUnavailableError (agent session, no real PTY)
            // or some other spawner failure. Refetch the session to
            // learn the post-failure state so the renderer surfaces
            // the right recovery copy (pty-unavailable banner vs the
            // generic stopped state).
            const refreshed = await window.plottoon.terminal.getSession(session.id)
            if (cancelled) return
            dispatch({
              type: 'session-created',
              sessionId: session.id,
              state: refreshed?.state ?? 'disconnected',
              exitCode: refreshed?.exitCode ?? null,
              agentKind: session.agentKind
            })
          }
        }
      } catch (e) {
        if (!cancelled) dispatch({ type: 'error', message: (e as Error).message })
      }
    }
    init()
    return () => {
      cancelled = true
    }
  }, [projectId])

  useEffect(() => {
    const offData = window.plottoon.terminal.onData((sid, data) => {
      if (sid !== sessionIdRef.current) return
      terminalRef.current?.write(data)
      scrollbackRef.current += data
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
      persistTimerRef.current = setTimeout(() => {
        const owner = scrollbackOwnerRef.current
        if (owner) void writeScrollback(owner.wallet, owner.project, scrollbackRef.current)
      }, 400)
    })
    const offExit = window.plottoon.terminal.onExit((sid, code, exitState) => {
      if (sid !== sessionIdRef.current) return
      dispatch({ type: 'exited', code, exitState })
      const note =
        exitState === 'resume-failed'
          ? `\r\n[resume failed — agent exited with code ${code ?? '?'}]`
          : `\r\n[process exited with code ${code ?? '?'}]`
      terminalRef.current?.writeln(note)
      scrollbackRef.current += note + '\n'
    })
    return () => {
      offData()
      offExit()
    }
  }, [])

  useEffect(() => {
    const previousOwner = scrollbackOwnerRef.current
    const previousBuffer = scrollbackRef.current
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current)
      persistTimerRef.current = null
    }
    if (previousOwner && previousBuffer.length > 0) {
      void writeScrollback(previousOwner.wallet, previousOwner.project, previousBuffer)
    }

    if (!activeWallet) {
      scrollbackOwnerRef.current = null
      scrollbackRef.current = ''
      terminalRef.current?.clear()
      return
    }
    let cancelled = false
    const owner = { wallet: activeWallet, project: projectId }
    async function restore(): Promise<void> {
      scrollbackRef.current = ''
      scrollbackOwnerRef.current = owner
      const restored = await readScrollback(owner.wallet, owner.project)
      if (cancelled || scrollbackOwnerRef.current !== owner) return
      const term = terminalRef.current
      if (!term) return
      term.clear()
      if (restored) {
        term.write(restored)
        scrollbackRef.current = restored
      }
    }
    void restore()
    return () => {
      cancelled = true
    }
  }, [activeWallet, projectId])

  // #274: only pipe xterm input → IPC when connected AND attached.
  // Detached panels keep showing PTY output but ignore typed input so
  // the user can't accidentally feed the agent commands they didn't
  // intend to send.
  useEffect(() => {
    inputDisposerRef.current?.dispose()
    inputDisposerRef.current = null
    if (state.phase !== 'connected' || state.detached) return
    const term = terminalRef.current
    if (!term) return
    const dispose = term.onData((data) => {
      void window.plottoon.terminal.write(state.sessionId, data)
    })
    inputDisposerRef.current = dispose
    return () => {
      dispose.dispose()
    }
  }, [state])

  /**
   * #274: explicit Resume — sends `mode: 'resume'` so the main process
   * launches Claude with `--resume <sessionId>` (or Codex's picker).
   * If the agent rejects the resume, the IPC exit event arrives with
   * `state: 'resume-failed'` and the reducer surfaces the fallback.
   */
  const handleResume = useCallback(async () => {
    if (state.phase !== 'ready') return
    const term = terminalRef.current
    const dims = term ? { cols: term.cols, rows: term.rows } : undefined
    const ok = await window.plottoon.terminal.connect(state.sessionId, dims, { mode: 'resume' })
    if (ok) {
      dispatch({ type: 'connected', sessionId: state.sessionId, agentKind: state.agentKind })
    }
  }, [state])

  const handleStartFresh = useCallback(async () => {
    if (state.phase !== 'ready' && state.phase !== 'connected') return
    const sid = state.sessionId
    const term = terminalRef.current
    const dims = term ? { cols: term.cols, rows: term.rows } : undefined
    term?.clear()
    scrollbackRef.current = ''
    const owner = scrollbackOwnerRef.current
    if (owner) void clearScrollback(owner.wallet, owner.project)
    // #274: explicit user choice — bypass the auto-resume heuristic.
    // We use restart when the session is currently connected
    // (kill + relaunch) so the user gets a clean slate; we use connect
    // with mode='fresh' otherwise to avoid an unnecessary kill.
    const ok =
      state.phase === 'connected'
        ? await window.plottoon.terminal.restart(sid, dims)
        : await window.plottoon.terminal.connect(sid, dims, { mode: 'fresh' })
    if (ok) {
      dispatch({ type: 'connected', sessionId: sid, agentKind: state.agentKind })
    }
  }, [state])

  /**
   * #274: detach is renderer-only — the IPC layer is untouched, so the
   * PTY keeps running. We stop piping user input (the input-effect
   * disposer runs because `detached` flipped) and surface a Reattach
   * prompt. xterm continues rendering PTY output so the user sees
   * what's happening while detached.
   */
  const handleDetach = useCallback(() => {
    if (state.phase !== 'connected') return
    dispatch({ type: 'detach' })
  }, [state])

  const handleReattach = useCallback(() => {
    if (state.phase !== 'connected') return
    dispatch({ type: 'reattach' })
  }, [state])

  /**
   * #274: stop = kill the PTY, keep the session meta. The agent's
   * persisted record (#273) survives so a later Resume can try again.
   */
  const handleStop = useCallback(async () => {
    if (state.phase !== 'connected') return
    await window.plottoon.terminal.disconnect(state.sessionId)
    dispatch({ type: 'disconnected' })
  }, [state])

  /**
   * #274: destroy = kill the PTY + drop the session meta. Used when
   * the user wants to abandon the current agent state entirely (e.g.
   * after a resume-failed they no longer want to recover from). Inline
   * confirm so a misclick on the toolbar can't nuke session state.
   */
  const handleDestroy = useCallback(async () => {
    if (state.phase === 'init') return
    if (state.phase === 'error') return
    if (!confirmDestroy) {
      setConfirmPhase(state.phase)
      return
    }
    const sid = state.phase === 'ready' || state.phase === 'connected' ? state.sessionId : null
    if (!sid) return
    const owner = scrollbackOwnerRef.current
    if (owner) void clearScrollback(owner.wallet, owner.project)
    terminalRef.current?.clear()
    scrollbackRef.current = ''
    await window.plottoon.terminal.destroy(sid)
    // The session is gone in main; surface an explicit notice so the
    // user knows to reload the panel.
    dispatch({ type: 'error', message: 'Session destroyed. Reload the panel to start a new one.' })
    setConfirmPhase(null)
  }, [state, confirmDestroy])

  const sessionStateLabel = phaseLabel(state)
  const dotClass = statusDotClass(state)
  const agentName =
    state.phase === 'connected' || state.phase === 'ready' ? agentLabel(state.agentKind) : 'Agent'

  // #274 helpers for the recovery section under the toolbar — we keep
  // the markup grouped here rather than inline to keep the toolbar
  // visually tight.
  const showResumeFailedRecovery = state.phase === 'ready' && state.state === 'resume-failed'
  const showExitedRecovery = state.phase === 'ready' && state.state === 'exited'
  const showStoppedRecovery = state.phase === 'ready' && state.state === 'disconnected'
  // #297: PTY-unavailable recovery surface — distinct from "stopped"
  // so the renderer can explain WHY the agent couldn't start (PTY
  // allocation refused; node-pty load failed) and offer a Retry that
  // re-runs the connect. We don't show Resume here because the
  // session never reached the point where a session-id would be
  // meaningful; Retry is the only useful action.
  const showPtyUnavailableRecovery = state.phase === 'ready' && state.state === 'pty-unavailable'

  return (
    <div className="terminal-panel" data-testid="agent-terminal-panel">
      <div className="terminal-panel__toolbar">
        <span
          className={dotClass}
          data-testid="agent-terminal-status-dot"
          data-state={
            state.phase === 'connected'
              ? state.detached
                ? 'detached'
                : 'running'
              : state.phase === 'ready'
                ? state.state
                : state.phase
          }
          aria-hidden="true"
        />
        <span className="terminal-panel__title" data-testid="agent-terminal-title">
          {agentName} session
        </span>
        <span className="terminal-panel__status" data-testid="agent-terminal-status">
          {sessionStateLabel}
        </span>
        <div className="terminal-panel__actions">
          {/*
            #274: a single toolbar that swaps actions per phase rather
            than scattering buttons across multiple banners.
            - connected + attached: Detach / Stop / Destroy
            - connected + detached: Reattach / Stop / Destroy
            - ready/disconnected: Resume / Start Fresh / Destroy
            - ready/exited:        Start Fresh / Destroy
            - ready/resume-failed: Start Fresh (highlighted) / Destroy
            Connect/Restart from the pre-#274 UX are subsumed by
            Resume / Start Fresh / Reattach respectively.
          */}
          {state.phase === 'connected' && !state.detached && (
            <button
              type="button"
              className="terminal-action"
              onClick={handleDetach}
              data-testid="agent-terminal-detach"
            >
              detach
            </button>
          )}
          {state.phase === 'connected' && state.detached && (
            <button
              type="button"
              className="terminal-action"
              onClick={handleReattach}
              data-testid="agent-terminal-reattach"
            >
              reattach
            </button>
          )}
          {state.phase === 'connected' && (
            <button
              type="button"
              className="terminal-action"
              onClick={handleStop}
              data-testid="agent-terminal-stop"
            >
              stop
            </button>
          )}
          {state.phase === 'connected' && state.agentKind !== null && (
            <button
              type="button"
              className="terminal-action"
              onClick={handleStartFresh}
              data-testid="agent-terminal-start-fresh"
            >
              start fresh
            </button>
          )}
          {showStoppedRecovery && state.agentKind !== null && (
            <>
              <button
                type="button"
                className="terminal-action"
                onClick={handleResume}
                data-testid="agent-terminal-resume"
              >
                resume
              </button>
              <button
                type="button"
                className="terminal-action"
                onClick={handleStartFresh}
                data-testid="agent-terminal-start-fresh"
              >
                start fresh
              </button>
            </>
          )}
          {(showExitedRecovery || showResumeFailedRecovery) && state.agentKind !== null && (
            <button
              type="button"
              className="terminal-action"
              onClick={handleStartFresh}
              data-testid="agent-terminal-start-fresh"
            >
              start fresh
            </button>
          )}
          {showPtyUnavailableRecovery && state.agentKind !== null && (
            <button
              type="button"
              className="terminal-action"
              onClick={handleStartFresh}
              data-testid="agent-terminal-pty-retry"
            >
              retry
            </button>
          )}
          {(state.phase === 'ready' || state.phase === 'connected') && (
            <button
              type="button"
              className="terminal-action terminal-action--danger"
              onClick={handleDestroy}
              data-testid="agent-terminal-destroy"
              aria-pressed={confirmDestroy}
            >
              {confirmDestroy ? 'confirm destroy' : 'destroy'}
            </button>
          )}
        </div>
      </div>

      <div
        ref={containerRef}
        className="terminal-panel__xterm"
        data-testid="agent-terminal-xterm"
      />

      {state.phase === 'init' && (
        <div className="terminal-panel__hint">Initializing agent session…</div>
      )}
      {(state.phase === 'ready' || state.phase === 'connected') && state.agentKind === null && (
        <div className="terminal-panel__hint" data-testid="agent-terminal-no-agent">
          No AI agent CLI available. Install Claude or Codex on your PATH and restart PlotToon to
          enable this session.
        </div>
      )}
      {showResumeFailedRecovery && (
        <div
          className="terminal-panel__hint terminal-panel__hint--warn"
          data-testid="agent-terminal-resume-failed-hint"
          role="status"
          aria-live="polite"
        >
          The agent rejected the resume (exited quickly with code {state.exitCode ?? '?'}). Try
          “start fresh” to begin a new session.
        </div>
      )}
      {showPtyUnavailableRecovery && (
        <div
          className="terminal-panel__hint terminal-panel__hint--error"
          data-testid="agent-terminal-pty-unavailable-hint"
          role="status"
          aria-live="polite"
        >
          Couldn’t allocate a terminal (PTY) for the agent. Make sure native modules built correctly
          during install (reinstall PlotToon if needed), then click “retry” above.
        </div>
      )}
      {state.phase === 'connected' && state.detached && (
        <div
          className="terminal-panel__hint"
          data-testid="agent-terminal-detached-hint"
          role="status"
          aria-live="polite"
        >
          Detached — the agent is still running. Click “reattach” to send input again.
        </div>
      )}
      {state.phase === 'error' && (
        <div className="terminal-panel__hint terminal-panel__hint--error">
          Error: {state.message}
        </div>
      )}
    </div>
  )
}
