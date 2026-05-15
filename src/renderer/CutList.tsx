import { useEffect, useReducer } from 'react'

interface Cut {
  id: string
  direction?: string
  dialogue?: string
  narration?: string
  imageState?: {
    status?: string
    path?: string
    backend?: string
    model?: string
    prompt?: string
    attempts?: number
    revisionNotes?: string
  }
  continuityNotes?: string
}

interface CutsData {
  cuts: Cut[]
}

interface State {
  phase: 'loading' | 'ready' | 'empty' | 'error'
  plots: string[]
  activePlot: string | null
  cuts: Cut[]
  activeCutId: string | null
  error: string | null
}

type Action =
  | { type: 'plots-loaded'; plots: string[] }
  | { type: 'cuts-loaded'; cuts: Cut[] }
  | { type: 'select-plot'; plot: string }
  | { type: 'select-cut'; cutId: string }
  | { type: 'no-plots' }
  | { type: 'error'; message: string }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'plots-loaded':
      return {
        ...state,
        phase: action.plots.length > 0 ? 'ready' : 'empty',
        plots: action.plots,
        activePlot: action.plots[0] ?? null
      }
    case 'cuts-loaded':
      return {
        ...state,
        phase: 'ready',
        cuts: action.cuts,
        activeCutId: action.cuts[0]?.id ?? null
      }
    case 'select-plot':
      return { ...state, activePlot: action.plot, cuts: [], activeCutId: null }
    case 'select-cut':
      return { ...state, activeCutId: action.cutId }
    case 'no-plots':
      return { ...state, phase: 'empty', plots: [], cuts: [] }
    case 'error':
      return { ...state, phase: 'error', error: action.message }
  }
}

interface CutListProps {
  projectId: string
  activeCutId: string | null
  onSelectCut: (cut: Cut | null) => void
  onPlotsLoaded?: (plots: string[]) => void
}

export type { Cut, CutsData }

export function CutList({
  projectId,
  activeCutId,
  onSelectCut,
  onPlotsLoaded
}: CutListProps): JSX.Element {
  const [state, dispatch] = useReducer(reducer, {
    phase: 'loading',
    plots: [],
    activePlot: null,
    cuts: [],
    activeCutId: null,
    error: null
  })

  useEffect(() => {
    let cancelled = false
    async function loadPlots() {
      try {
        const entries = await window.plottoon.fs.listProjectDir(projectId, 'plots')
        if (cancelled) return
        if (entries.length === 0) {
          dispatch({ type: 'no-plots' })
          return
        }
        dispatch({ type: 'plots-loaded', plots: entries })
        onPlotsLoaded?.(entries)
      } catch {
        if (!cancelled) dispatch({ type: 'no-plots' })
      }
    }
    loadPlots()
    return () => {
      cancelled = true
    }
  }, [projectId, onPlotsLoaded])

  useEffect(() => {
    if (!state.activePlot) return
    let cancelled = false
    async function loadCuts() {
      try {
        const hasFile = await window.plottoon.fs.projectFileExists(
          projectId,
          'plots',
          state.activePlot!,
          'cuts.json'
        )
        if (!hasFile) {
          if (!cancelled) {
            dispatch({ type: 'cuts-loaded', cuts: [] })
            onSelectCut(null)
          }
          return
        }
        const raw = await window.plottoon.fs.readProjectFile(
          projectId,
          'plots',
          state.activePlot!,
          'cuts.json'
        )
        const data: CutsData = JSON.parse(raw)
        if (!cancelled) {
          const cuts = Array.isArray(data.cuts) ? data.cuts : []
          dispatch({ type: 'cuts-loaded', cuts })
          if (cuts.length > 0) onSelectCut(cuts[0])
        }
      } catch (err) {
        if (!cancelled) {
          dispatch({
            type: 'error',
            message: err instanceof Error ? err.message : 'Failed to load cuts'
          })
          onSelectCut(null)
        }
      }
    }
    loadCuts()
    return () => {
      cancelled = true
    }
  }, [projectId, state.activePlot, onSelectCut])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 'var(--font-weight-semibold)' as never,
          color: 'var(--color-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          padding: 'var(--space-3) var(--space-3) var(--space-1)'
        }}
      >
        Plots
      </div>

      {state.plots.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            padding: '0 var(--space-2) var(--space-2)',
            flexShrink: 0
          }}
        >
          {state.plots.map((plot) => (
            <button
              key={plot}
              type="button"
              onClick={() => {
                dispatch({ type: 'select-plot', plot })
                onSelectCut(null)
              }}
              style={{
                all: 'unset',
                cursor: 'pointer',
                padding: 'var(--space-1) var(--space-2)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 12,
                background:
                  state.activePlot === plot ? 'var(--color-surface-raised)' : 'transparent',
                fontWeight:
                  state.activePlot === plot
                    ? ('var(--font-weight-medium)' as never)
                    : ('var(--font-weight-regular)' as never)
              }}
            >
              {plot}
            </button>
          ))}
        </div>
      )}

      <div
        style={{
          fontSize: 11,
          fontWeight: 'var(--font-weight-semibold)' as never,
          color: 'var(--color-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          padding: 'var(--space-2) var(--space-3) var(--space-1)',
          borderTop: '1px solid var(--color-border)'
        }}
      >
        Cuts
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '0 var(--space-2)' }}>
        {state.phase === 'loading' && (
          <div
            style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: 'var(--space-2)' }}
          >
            Loading...
          </div>
        )}
        {state.phase === 'empty' && (
          <div
            style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: 'var(--space-2)' }}
          >
            No plots found
          </div>
        )}
        {state.phase === 'error' && (
          <div style={{ fontSize: 12, color: 'var(--color-error)', padding: 'var(--space-2)' }}>
            {state.error}
          </div>
        )}
        {state.phase === 'ready' && state.cuts.length === 0 && (
          <div
            style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: 'var(--space-2)' }}
          >
            No cuts in this plot
          </div>
        )}
        {state.cuts.map((cut) => (
          <button
            key={cut.id}
            type="button"
            onClick={() => onSelectCut(cut)}
            style={{
              all: 'unset',
              cursor: 'pointer',
              display: 'block',
              width: '100%',
              padding: 'var(--space-2)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 12,
              background: activeCutId === cut.id ? 'var(--color-surface-raised)' : 'transparent',
              fontWeight:
                activeCutId === cut.id
                  ? ('var(--font-weight-medium)' as never)
                  : ('var(--font-weight-regular)' as never),
              marginBottom: 1
            }}
          >
            <div>{cut.id}</div>
            {cut.direction && (
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--color-text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {cut.direction}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
