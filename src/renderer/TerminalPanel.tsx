import { useEffect, useReducer, useRef, useCallback, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { readScrollback, writeScrollback, clearScrollback } from './terminalScrollback'
import { WALLET_ACTIVE_CHANGED_EVENT } from '../shared/walletIdentity'

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
  const [activeWallet, setActiveWallet] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const inputDisposerRef = useRef<{ dispose(): void } | null>(null)
  // #273: rolling scrollback buffer + debounced persister. We keep the
  // tail (MAX_SCROLLBACK_BYTES, enforced inside writeScrollback) so a
  // remount can paint history before the live PTY reattaches.
  const scrollbackRef = useRef<string>('')
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Tracks which (wallet, project) pair the current scrollback belongs
  // to so a wallet switch clears the previous wallet's buffer instead
  // of bleeding it into the next.
  const scrollbackOwnerRef = useRef<{ wallet: string; project: string } | null>(null)

  // #273: track active wallet so scrollback persistence is wallet-
  // scoped. Re-resolves on every WALLET_ACTIVE_CHANGED_EVENT so a
  // wallet switch flips the scrollback key.
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
      // #273: flush any pending scrollback write so the next mount
      // (window reopen) restores the latest bytes the user saw, not
      // a stale snapshot from the previous debounce tick.
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

  // Create / find the session on mount, then auto-start the agent
  // process if it's not already connected. #272 acceptance: opening a
  // project auto-starts the selected agent. We deliberately do NOT
  // auto-connect when `agentKind === null` — that path would spawn the
  // user's shell, which is not what the user clicked into the agent
  // panel for. Instead the renderer shows a "No AI agent CLI
  // available" hint and hides the Connect button (see render below).
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
        // Auto-start when:
        //  - we have an agent runtime (claude/codex), AND
        //  - the session isn't already running, AND
        //  - it hasn't crashed (we don't relaunch a crashed agent
        //    automatically — the user clicks Restart explicitly).
        if (session.agentKind !== null && session.state === 'disconnected') {
          const term = terminalRef.current
          const dims = term ? { cols: term.cols, rows: term.rows } : undefined
          const ok = await window.plottoon.terminal.connect(session.id, dims)
          if (!cancelled && ok) {
            dispatch({
              type: 'connected',
              sessionId: session.id,
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

  // Wire IPC → xterm buffer (+ #273 scrollback capture).
  useEffect(() => {
    const offData = window.plottoon.terminal.onData((sid, data) => {
      if (sid !== sessionIdRef.current) return
      terminalRef.current?.write(data)
      // Append to in-memory scrollback and schedule a debounced
      // persist. The store enforces the byte cap, so we just keep
      // appending here and let the writer tail-trim.
      scrollbackRef.current += data
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
      persistTimerRef.current = setTimeout(() => {
        const owner = scrollbackOwnerRef.current
        if (owner) void writeScrollback(owner.wallet, owner.project, scrollbackRef.current)
      }, 400)
    })
    const offExit = window.plottoon.terminal.onExit((sid, code) => {
      if (sid !== sessionIdRef.current) return
      dispatch({ type: 'exited', code })
      const note = `\r\n[process exited with code ${code ?? '?'}]`
      terminalRef.current?.writeln(note)
      scrollbackRef.current += note + '\n'
    })
    return () => {
      offData()
      offExit()
    }
  }, [])

  // #273: restore persisted scrollback on (wallet, project) change.
  // Also flushes the previous owner's buffer to disk before swapping,
  // and clears xterm so the next wallet's history doesn't leak.
  useEffect(() => {
    if (!activeWallet) {
      // Wallet unset: clear visible buffer + in-memory tail, but do
      // NOT touch persisted scrollback — the wallet may come back.
      scrollbackOwnerRef.current = null
      scrollbackRef.current = ''
      terminalRef.current?.clear()
      return
    }
    let cancelled = false
    const owner = { wallet: activeWallet, project: projectId }
    async function restore(): Promise<void> {
      // Flush any in-flight write before swapping owners.
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current)
        persistTimerRef.current = null
      }
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
    // #273: restart wipes the agent session, so the persisted
    // scrollback for the old session is no longer relevant.
    scrollbackRef.current = ''
    const owner = scrollbackOwnerRef.current
    if (owner) void clearScrollback(owner.wallet, owner.project)
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
          {/*
            #272 RE1: when no agent runtime is installed (agentKind ===
            null) we deliberately hide the Connect / Restart buttons.
            The panel falls back to spawning the user's shell at the
            service layer if asked, which is wrong UX for an agent
            panel. Surfacing the no-agent hint below + hiding the
            actions prevents the IPC connect path from running at all.
          */}
          {state.phase === 'ready' && state.agentKind !== null && (
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
          {(state.phase === 'ready' || state.phase === 'connected') && state.agentKind !== null && (
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
      {/*
        #272 RE1: explicit no-agent hint. Surfaces both the cause and
        the remediation so the user doesn't think the panel is broken
        when neither Claude nor Codex is installed. Hidden by design
        when agentKind is non-null (legacy null-agent sessions from
        tests don't render this in production because the IPC path
        only produces null agentKind when no runtime was detected).
      */}
      {(state.phase === 'ready' || state.phase === 'connected') && state.agentKind === null && (
        <div className="terminal-panel__hint" data-testid="agent-terminal-no-agent">
          No AI agent CLI available. Install Claude or Codex on your PATH and restart PlotToon to
          enable this session.
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
