import { useEffect, useReducer, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface Props {
  projectId: string
}

type State =
  | { phase: 'init' }
  | {
      phase: 'ready'
      sessionId: string
      state: 'disconnected' | 'exited'
      exitCode: number | null
      agentKind: 'claude' | 'codex' | null
    }
  | {
      phase: 'connected'
      sessionId: string
      agentKind: 'claude' | 'codex' | null
    }
  | { phase: 'error'; message: string }

type Action =
  | {
      type: 'session-created'
      sessionId: string
      state: 'connected' | 'disconnected' | 'exited'
      exitCode: number | null
      agentKind: 'claude' | 'codex' | null
    }
  | { type: 'connected'; sessionId: string; agentKind: 'claude' | 'codex' | null }
  | { type: 'exited'; code: number | null }
  | { type: 'disconnected' }
  | { type: 'error'; message: string }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'session-created':
      if (action.state === 'connected') {
        return {
          phase: 'connected',
          sessionId: action.sessionId,
          agentKind: action.agentKind
        }
      }
      return {
        phase: 'ready',
        sessionId: action.sessionId,
        state: action.state as 'disconnected' | 'exited',
        exitCode: action.exitCode,
        agentKind: action.agentKind
      }
    case 'connected':
      return {
        phase: 'connected',
        sessionId: action.sessionId,
        agentKind: action.agentKind
      }
    case 'exited':
      if (state.phase !== 'connected') return state
      return {
        phase: 'ready',
        sessionId: state.sessionId,
        state: 'exited',
        exitCode: action.code,
        agentKind: state.agentKind
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
    case 'error':
      return { phase: 'error', message: action.message }
  }
}

function panelTitle(agentKind: 'claude' | 'codex' | null): string {
  if (agentKind === 'claude') return 'Claude session'
  if (agentKind === 'codex') return 'Codex session'
  // #272: legacy fallback when no agent CLI is installed — surfaces
  // as "Agent session" rather than "Terminal" so the user still
  // understands this is the agent panel.
  return 'Agent session'
}

export function TerminalPanel({ projectId }: Props): JSX.Element {
  const [state, dispatch] = useReducer(reducer, { phase: 'init' })
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const inputDisposerRef = useRef<{ dispose(): void } | null>(null)

  // Mount xterm once into the container; tear down on unmount.
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
      // Container may not be sized yet; resize observer below handles it.
    }
    terminalRef.current = term
    fitRef.current = fit
    return () => {
      inputDisposerRef.current?.dispose()
      inputDisposerRef.current = null
      term.dispose()
      terminalRef.current = null
      fitRef.current = null
    }
  }, [])

  // Resize observer: fit xterm to container size + propagate the new
  // (cols, rows) to the PTY so child processes see correct WINSIZE.
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

  // Create / find the session on mount.
  useEffect(() => {
    let cancelled = false
    async function init(): Promise<void> {
      try {
        let session = await window.plottoon.terminal.findByProject(projectId)
        if (!session) {
          session = await window.plottoon.terminal.create(projectId)
        }
        if (!cancelled) {
          sessionIdRef.current = session.id
          dispatch({
            type: 'session-created',
            sessionId: session.id,
            state: session.state,
            exitCode: session.exitCode,
            agentKind: session.agentKind
          })
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

  // Wire IPC → xterm buffer.
  useEffect(() => {
    const offData = window.plottoon.terminal.onData((sid, data) => {
      if (sid !== sessionIdRef.current) return
      terminalRef.current?.write(data)
    })
    const offExit = window.plottoon.terminal.onExit((sid, code) => {
      if (sid !== sessionIdRef.current) return
      dispatch({ type: 'exited', code })
      terminalRef.current?.writeln(`\r\n[process exited with code ${code ?? '?'}]`)
    })
    return () => {
      offData()
      offExit()
    }
  }, [])

  // Connect xterm input → IPC write while connected.
  useEffect(() => {
    inputDisposerRef.current?.dispose()
    inputDisposerRef.current = null
    if (state.phase !== 'connected') return
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

  const handleConnect = useCallback(async () => {
    if (state.phase !== 'ready') return
    const term = terminalRef.current
    const dims = term ? { cols: term.cols, rows: term.rows } : undefined
    const ok = await window.plottoon.terminal.connect(state.sessionId, dims)
    if (ok) {
      dispatch({ type: 'connected', sessionId: state.sessionId, agentKind: state.agentKind })
    }
  }, [state])

  const handleDisconnect = useCallback(async () => {
    if (state.phase !== 'connected') return
    await window.plottoon.terminal.disconnect(state.sessionId)
    dispatch({ type: 'disconnected' })
  }, [state])

  const handleRestart = useCallback(async () => {
    if (state.phase !== 'ready' && state.phase !== 'connected') return
    const sid = state.sessionId
    const term = terminalRef.current
    const dims = term ? { cols: term.cols, rows: term.rows } : undefined
    term?.clear()
    const ok = await window.plottoon.terminal.restart(sid, dims)
    if (ok) {
      dispatch({
        type: 'connected',
        sessionId: sid,
        agentKind: state.agentKind
      })
    }
  }, [state])

  const title =
    state.phase === 'connected' || state.phase === 'ready'
      ? panelTitle(state.agentKind)
      : 'Agent session'

  return (
    <div className="terminal-panel" data-testid="agent-terminal-panel">
      <div className="terminal-panel__toolbar">
        <span className="terminal-panel__title" data-testid="agent-terminal-title">
          {title}
        </span>
        <span className="terminal-panel__status">
          {state.phase === 'connected' && 'connected'}
          {state.phase === 'ready' && state.state === 'disconnected' && 'disconnected'}
          {state.phase === 'ready' &&
            state.state === 'exited' &&
            `exited (${state.exitCode ?? '?'})`}
          {state.phase === 'init' && 'initializing…'}
          {state.phase === 'error' && 'error'}
        </span>
        <div className="terminal-panel__actions">
          {state.phase === 'ready' && (
            <button
              type="button"
              className="terminal-action"
              onClick={handleConnect}
              data-testid="agent-terminal-connect"
            >
              connect
            </button>
          )}
          {state.phase === 'connected' && (
            <button
              type="button"
              className="terminal-action"
              onClick={handleDisconnect}
              data-testid="agent-terminal-disconnect"
            >
              disconnect
            </button>
          )}
          {(state.phase === 'ready' || state.phase === 'connected') && (
            <button
              type="button"
              className="terminal-action"
              onClick={handleRestart}
              data-testid="agent-terminal-restart"
            >
              restart
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
      {state.phase === 'error' && (
        <div className="terminal-panel__hint terminal-panel__hint--error">
          Error: {state.message}
        </div>
      )}
    </div>
  )
}
