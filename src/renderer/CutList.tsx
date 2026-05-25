import { useEffect, useReducer, useCallback } from 'react'
import { addCut, deleteCut, duplicateCut, moveCut, isProtected } from './cutMutations'

interface TailAnchor {
  x: number
  y: number
}

interface Overlay {
  id: string
  type: string
  content: string
  x: number
  y: number
  width: number
  height: number
  style?: Record<string, string>
  tailAnchor?: TailAnchor
}

interface CanvasOverrides {
  width?: number
  height?: number
  backgroundColor?: string
}

interface Cut {
  id: string
  status?: string
  direction?: string
  dialogue?: string
  narration?: string
  imageState?: {
    status?: string
    path?: string
    generationBackend?: string
    model?: string
    prompt?: string
    attempts?: number
    revisionNotes?: string
    revisions?: Array<{
      version: number
      path: string
      createdAt: string
      revisionNotes?: string
    }>
  }
  overlays?: Overlay[]
  canvasOverrides?: CanvasOverrides
  continuityNotes?: string
}

interface PlotPublishState {
  published: boolean
  exportedAt: string | null
  format: string | null
}

interface CutsFileEnvelope {
  version: number
  plotTitle: string
  synopsis: string
  publishState: PlotPublishState
}

interface CutsData {
  cuts: Cut[]
  version?: number
  plotTitle?: string
  synopsis?: string
  publishState?: PlotPublishState
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
  | { type: 'update-cuts'; cuts: Cut[] }
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
    case 'update-cuts':
      return { ...state, cuts: action.cuts }
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
  onCutsChanged?: (cuts: Cut[]) => void
  onPlotChanged?: (plot: string | null) => void
  onPlotsLoaded?: (plots: string[]) => void
  onEnvelopeLoaded?: (envelope: CutsFileEnvelope) => void
  /**
   * #278 RE1: external override for the cuts array. When the parent
   * (Workspace) mutates cuts outside CutList — e.g. agent-image sync
   * merges new revisions in — it passes the new array here. CutList
   * dispatches `update-cuts` (NOT `cuts-loaded`) so the user's
   * selection + plot-load envelope are preserved. The pre-RE1 bug
   * was that CutList kept its own stale state.cuts after a sync, and
   * subsequent mutations saved the stale array back over the synced
   * revisions.
   */
  cutsOverride?: Cut[]
}

export type { Cut, CutsData, CutsFileEnvelope, Overlay, CanvasOverrides, TailAnchor }

export function CutList({
  projectId,
  activeCutId,
  onSelectCut,
  onCutsChanged,
  onPlotChanged,
  onPlotsLoaded,
  onEnvelopeLoaded,
  cutsOverride
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
        onPlotChanged?.(entries[0] ?? null)
        onPlotsLoaded?.(entries)
      } catch {
        if (!cancelled) dispatch({ type: 'no-plots' })
      }
    }
    loadPlots()
    return () => {
      cancelled = true
    }
  }, [projectId, onPlotChanged, onPlotsLoaded])

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
          onEnvelopeLoaded?.({
            version: data.version ?? 1,
            plotTitle: data.plotTitle ?? state.activePlot ?? '',
            synopsis: data.synopsis ?? '',
            publishState: data.publishState ?? {
              published: false,
              exportedAt: null,
              format: null
            }
          })
          dispatch({ type: 'cuts-loaded', cuts })
          onCutsChanged?.(cuts)
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
  }, [projectId, state.activePlot, onSelectCut, onCutsChanged, onEnvelopeLoaded])

  // #278 RE1: when the parent passes a new cuts array (e.g. after
  // agent-image sync merged in new revisions), push it into our
  // reducer via `update-cuts`. That preserves activeCutId — unlike
  // `cuts-loaded`, which resets the selection to the first cut. We
  // intentionally compare by reference: the parent allocates a fresh
  // array every time it merges, so identity-equal arrays are no-ops.
  useEffect(() => {
    if (!cutsOverride) return
    dispatch({ type: 'update-cuts', cuts: cutsOverride })
  }, [cutsOverride])

  const mutateCuts = useCallback(
    (next: Cut[]) => {
      dispatch({ type: 'update-cuts', cuts: next })
      onCutsChanged?.(next)
    },
    [onCutsChanged]
  )

  const handleAdd = useCallback(() => {
    mutateCuts(addCut(state.cuts, activeCutId ?? undefined))
  }, [state.cuts, activeCutId, mutateCuts])

  const handleDelete = useCallback(() => {
    if (!activeCutId) return
    const cut = state.cuts.find((c) => c.id === activeCutId)
    if (cut && isProtected(cut)) return
    const next = deleteCut(state.cuts, activeCutId)
    mutateCuts(next)
    onSelectCut(null)
  }, [state.cuts, activeCutId, mutateCuts, onSelectCut])

  const handleDuplicate = useCallback(() => {
    if (!activeCutId) return
    mutateCuts(duplicateCut(state.cuts, activeCutId))
  }, [state.cuts, activeCutId, mutateCuts])

  const handleMove = useCallback(
    (direction: 'up' | 'down') => {
      if (!activeCutId) return
      mutateCuts(moveCut(state.cuts, activeCutId, direction))
    },
    [state.cuts, activeCutId, mutateCuts]
  )

  return (
    <div className="cut-list">
      <div className="cut-list__section-label">Plots</div>

      {state.plots.length > 0 && (
        <div className="cut-list__plots">
          {state.plots.map((plot) => {
            const isActive = state.activePlot === plot
            return (
              <button
                key={plot}
                type="button"
                onClick={() => {
                  dispatch({ type: 'select-plot', plot })
                  onPlotChanged?.(plot)
                  onSelectCut(null)
                }}
                className={`cut-list__row${isActive ? ' cut-list__row--active' : ''}`}
              >
                {plot}
              </button>
            )
          })}
        </div>
      )}

      <div className="cut-list__section-label cut-list__section-label--bordered">Cuts</div>

      {state.phase === 'ready' && (
        <div className="cut-list__toolbar" data-testid="cut-toolbar">
          <ToolBtn label="+" title="Add cut" onClick={handleAdd} />
          <ToolBtn
            label="\u2212"
            title="Delete cut"
            onClick={handleDelete}
            disabled={!activeCutId}
          />
          <ToolBtn
            label="\u2398"
            title="Duplicate cut"
            onClick={handleDuplicate}
            disabled={!activeCutId}
          />
          <ToolBtn
            label="\u2191"
            title="Move up"
            onClick={() => handleMove('up')}
            disabled={!activeCutId}
          />
          <ToolBtn
            label="\u2193"
            title="Move down"
            onClick={() => handleMove('down')}
            disabled={!activeCutId}
          />
        </div>
      )}

      <div className="cut-list__scroll">
        {state.phase === 'loading' && <div className="cut-list__hint">Loading...</div>}
        {state.phase === 'empty' && <div className="cut-list__hint">No plots found</div>}
        {state.phase === 'error' && (
          <div className="cut-list__hint cut-list__hint--error">{state.error}</div>
        )}
        {state.phase === 'ready' && state.cuts.length === 0 && (
          <div className="cut-list__hint">No cuts in this plot</div>
        )}
        {state.cuts.map((cut) => {
          const isActive = activeCutId === cut.id
          return (
            <button
              key={cut.id}
              type="button"
              onClick={() => onSelectCut(cut)}
              className={`cut-list__row${isActive ? ' cut-list__row--active' : ''}`}
            >
              <div className="cut-row-header">
                <span>{cut.id}</span>
                {cut.status && (
                  <span data-testid={`status-${cut.id}`} className="cut-status-tag">
                    {cut.status}
                  </span>
                )}
              </div>
              {cut.direction && <div className="cut-row-direction">{cut.direction}</div>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ToolBtn({
  label,
  title,
  onClick,
  disabled
}: {
  label: string
  title: string
  onClick: () => void
  disabled?: boolean
}): JSX.Element {
  return (
    <button type="button" title={title} onClick={onClick} disabled={disabled} className="tool-btn">
      {label}
    </button>
  )
}
