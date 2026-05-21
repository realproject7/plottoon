import { useEffect, useReducer, useRef, useCallback } from 'react'

interface Props {
  projectId: string
}

type State =
  | { phase: 'init' }
  | { phase: 'ready'; sessionId: string; state: 'disconnected' | 'exited'; exitCode: number | null }
  | { phase: 'connected'; sessionId: string; output: string[] }
  | { phase: 'error'; message: string }

type Action =
  | {
      type: 'session-created'
      sessionId: string
      state: 'connected' | 'disconnected' | 'exited'
      exitCode: number | null
    }
  | { type: 'connected'; sessionId: string }
  | { type: 'data'; text: string }
  | { type: 'exited'; code: number | null }
  | { type: 'disconnected' }
  | { type: 'error'; message: string }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'session-created':
      if (action.state === 'connected') {
        return { phase: 'connected', sessionId: action.sessionId, output: [] }
      }
      return {
        phase: 'ready',
        sessionId: action.sessionId,
        state: action.state as 'disconnected' | 'exited',
        exitCode: action.exitCode
      }
    case 'connected':
      return { phase: 'connected', sessionId: action.sessionId, output: [] }
    case 'data':
      if (state.phase !== 'connected') return state
      return { ...state, output: [...state.output, action.text] }
    case 'exited':
      if (state.phase !== 'connected') return state
      return { phase: 'ready', sessionId: state.sessionId, state: 'exited', exitCode: action.code }
    case 'disconnected':
      if (state.phase !== 'connected' && state.phase !== 'ready') return state
      return { phase: 'ready', sessionId: state.sessionId, state: 'disconnected', exitCode: null }
    case 'error':
      return { phase: 'error', message: action.message }
  }
}

export function TerminalPanel({ projectId }: Props): JSX.Element {
  const [state, dispatch] = useReducer(reducer, { phase: 'init' })
  const inputRef = useRef<HTMLInputElement>(null)
  const outputRef = useRef<HTMLPreElement>(null)
  const sessionIdRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function init() {
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
            exitCode: session.exitCode
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

  useEffect(() => {
    const cleanupData = window.plottoon.terminal.onData((sid, data) => {
      if (sid === sessionIdRef.current) {
        dispatch({ type: 'data', text: data })
      }
    })
    const cleanupExit = window.plottoon.terminal.onExit((sid, code) => {
      if (sid === sessionIdRef.current) {
        dispatch({ type: 'exited', code })
      }
    })
    return () => {
      cleanupData()
      cleanupExit()
    }
  }, [])

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  })

  const handleConnect = useCallback(async () => {
    if (state.phase !== 'ready') return
    const ok = await window.plottoon.terminal.connect(state.sessionId)
    if (ok) dispatch({ type: 'connected', sessionId: state.sessionId })
  }, [state])

  const handleDisconnect = useCallback(async () => {
    if (state.phase !== 'connected') return
    await window.plottoon.terminal.disconnect(state.sessionId)
    dispatch({ type: 'disconnected' })
  }, [state])

  const handleRestart = useCallback(async () => {
    if (state.phase !== 'ready' && state.phase !== 'connected') return
    const sid = state.sessionId
    const ok = await window.plottoon.terminal.restart(sid)
    if (ok) dispatch({ type: 'connected', sessionId: sid })
  }, [state])

  const handleInput = useCallback(
    async (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== 'Enter' || state.phase !== 'connected') return
      const input = inputRef.current
      if (!input) return
      const cmd = input.value + '\n'
      input.value = ''
      await window.plottoon.terminal.write(state.sessionId, cmd)
    },
    [state]
  )

  return (
    <div className="terminal-panel">
      <div className="terminal-panel__toolbar">
        <span className="terminal-panel__title">Terminal</span>
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
            <button type="button" className="terminal-action" onClick={handleConnect}>
              connect
            </button>
          )}
          {state.phase === 'connected' && (
            <button type="button" className="terminal-action" onClick={handleDisconnect}>
              disconnect
            </button>
          )}
          {(state.phase === 'ready' || state.phase === 'connected') && (
            <button type="button" className="terminal-action" onClick={handleRestart}>
              restart
            </button>
          )}
        </div>
      </div>

      <pre ref={outputRef} className="terminal-panel__output">
        {state.phase === 'connected' && state.output.join('')}
        {state.phase === 'init' && 'Initializing terminal session…\n'}
        {state.phase === 'error' && `Error: ${state.message}\n`}
        {state.phase === 'ready' &&
          state.state === 'exited' &&
          `Process exited with code ${state.exitCode ?? '?'}.\n`}
        {state.phase === 'ready' &&
          state.state === 'disconnected' &&
          'Terminal disconnected. Click connect to start.\n'}
      </pre>

      {state.phase === 'connected' && (
        <input
          ref={inputRef}
          onKeyDown={handleInput}
          placeholder="Type command and press Enter…"
          className="terminal-panel__input"
        />
      )}
    </div>
  )
}
