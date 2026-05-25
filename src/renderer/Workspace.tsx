import { useState, useEffect, useCallback, useRef } from 'react'
import { TerminalPanel } from './TerminalPanel'
import { CutList } from './CutList'
import { CutInspector } from './CutInspector'
import { EditorCanvas } from './EditorCanvas'
import {
  setStatus,
  isImageProtected,
  addOverlay,
  deleteOverlay,
  moveOverlay,
  resizeOverlay,
  duplicateOverlay,
  reorderOverlay,
  setOverlayTailAnchor,
  normalizeCutsForSave
} from './cutMutations'
import type { CutStatus } from './cutMutations'
import type { Cut, CutsFileEnvelope } from './CutList'
import { createOverlayFromPreset } from './overlayPresets'
import type { PresetName } from './overlayPresets'
import type { ExportMeta } from './exportMetadata'
import {
  buildSyncRequests,
  mergeAdoptedRevisions,
  type AgentImageSyncSnapshot
} from './agentImageSync'
import { AgentImageSyncBadge } from './AgentImageSyncBadge'
import { WorkflowGuide } from './WorkflowGuide'
import { allCutsApproved, deriveWorkflowState } from './workflowState'

interface Props {
  projectId?: string
}

export function Workspace({ projectId }: Props): JSX.Element {
  const [activeCut, setActiveCut] = useState<Cut | null>(null)
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null)
  const [cwd, setCwd] = useState<string | null>(null)
  const [exportMetas, setExportMetas] = useState<ExportMeta[]>([])
  const [activePlot, setActivePlot] = useState<string | null>(null)
  const activePlotRef = useRef<string | null>(null)
  const cutsRef = useRef<Cut[]>([])
  const envelopeRef = useRef<CutsFileEnvelope | null>(null)
  // #278: last sync snapshot — drives the status badge. `dismissed`
  // hides the badge until the next sync produces a new result; the
  // sync hook (`triggerSync`) sets it back to `false` when it runs.
  const [syncSnapshot, setSyncSnapshot] = useState<AgentImageSyncSnapshot>({
    adopted: [],
    rejected: []
  })
  const [syncDismissed, setSyncDismissed] = useState(true)
  // Guards against overlapping syncs. The renderer fires sync on a
  // 5 s interval AND on manual click; this ref keeps us from
  // double-merging if one run is still in flight when the next ticks.
  const syncInFlightRef = useRef(false)
  // #279: list of plot slugs loaded by CutList — drives the
  // workflow-guide "no plots yet" branch and lets the Workspace
  // surface the right empty state above the panel layout.
  const [plotList, setPlotList] = useState<string[]>([])
  // #278 RE1: cutsOverride state for CutList. Workspace owns this so
  // sync-driven merges can flow into CutList's internal reducer via
  // the `cutsOverride` prop, defeating the SSOT bug where CutList's
  // stale state could overwrite synced revisions on the next mutation.
  // CutList's own mutations still flow back through onCutsChanged ->
  // handleCutsChanged, and that path updates this state too so the
  // override always reflects the latest merged view.
  const [cutsOverride, setCutsOverride] = useState<Cut[] | undefined>(undefined)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    async function fetchCwd() {
      const session = await window.plottoon.terminal.findByProject(projectId!)
      if (!cancelled && session) {
        setCwd(session.cwd)
      }
    }
    fetchCwd()
    return () => {
      cancelled = true
    }
  }, [projectId])

  useEffect(() => {
    if (!projectId || !activePlot) return
    let cancelled = false
    async function loadMetas() {
      try {
        const raw = await window.plottoon.fs.readProjectFile(
          projectId!,
          'plots',
          activePlot!,
          'exports',
          'manifest.json'
        )
        if (cancelled) return
        const manifest = JSON.parse(raw)
        setExportMetas(Array.isArray(manifest.cuts) ? manifest.cuts : [])
      } catch {
        if (!cancelled) setExportMetas([])
      }
    }
    loadMetas()
    return () => {
      cancelled = true
    }
  }, [projectId, activePlot])

  const handleSelectCut = useCallback((cut: Cut | null) => {
    setActiveCut(cut)
    setSelectedOverlayId(null)
  }, [])

  const saveCuts = useCallback(
    (cuts: Cut[]) => {
      if (!projectId || !activePlotRef.current) return
      const envelope = envelopeRef.current ?? {
        version: 1,
        plotTitle: activePlotRef.current,
        synopsis: '',
        publishState: { published: false, exportedAt: null, format: null }
      }
      const normalized = normalizeCutsForSave(cuts)
      const data = JSON.stringify({ ...envelope, cuts: normalized }, null, 2)
      const plot = activePlotRef.current
      window.plottoon.fs
        .writeProjectFile(projectId, ['plots', plot, 'cuts.json'], data)
        .then(() => window.plottoon.fs.regeneratePlotText(projectId, plot))
        .catch((err) => console.warn('plot-text.md regeneration failed:', err))
    },
    [projectId]
  )

  /**
   * #279 RE1: single mutation funnel. Every path that produces a new
   * cuts array MUST go through here so the four sources of truth stay
   * aligned:
   *   1. `cutsRef.current`         — sync reads + later mutations
   *   2. `cutsOverride` state      — CutList prop (#278) + WorkflowGuide
   *   3. `activeCut` state         — preview/inspector view
   *   4. `cuts.json` on disk       — persistence (also triggers plot-text.md regen)
   * Pre-RE1 most handlers updated 1/3/4 but skipped 2, so the
   * workflow guide saw stale state — e.g. approving the last cut
   * still showed "move to the next cut" instead of "ready to export".
   *
   * `commitCuts` does the four updates in one place. Caller-specific
   * side effects (selection changes, last-revision tracking) stay in
   * the caller; only the cuts-state plumbing is centralised here.
   */
  /**
   * #279 RE1: activeCut is tracked via setActiveCut(prev => ...) so
   * we always read the LATEST state inside the commit, not whatever
   * was captured when commitCuts last ran via useCallback. This
   * prevents a stale closure from skipping the activeCut refresh
   * when a mutation arrives between renders.
   */
  const commitCuts = useCallback(
    (next: Cut[]) => {
      cutsRef.current = next
      setCutsOverride(next)
      saveCuts(next)
      setActiveCut((prev) => {
        if (!prev) return prev
        // Find the updated cut, or null if it was deleted.
        return next.find((c) => c.id === prev.id) ?? null
      })
    },
    [saveCuts]
  )

  const handleCutsChanged = useCallback(
    (cuts: Cut[]) => {
      // #278 RE1 + #279 RE1: route through commitCuts so the override
      // mirror, the active-cut state, and disk all stay aligned with
      // the cuts array CutList just produced.
      commitCuts(cuts)
    },
    [commitCuts]
  )

  const handlePlotChanged = useCallback((plot: string | null) => {
    activePlotRef.current = plot
    setActivePlot(plot)
    envelopeRef.current = null
    // #278 RE1: clear the cuts override on plot switch — the new plot
    // loads its own cuts from disk via CutList's loader, and we don't
    // want a stale override from the previous plot bleeding into it.
    setCutsOverride(undefined)
  }, [])

  const handleEnvelopeLoaded = useCallback((envelope: CutsFileEnvelope) => {
    envelopeRef.current = envelope
  }, [])

  const handleStatusChange = useCallback(
    (cutId: string, status: CutStatus) => {
      commitCuts(setStatus(cutsRef.current, cutId, status))
    },
    [commitCuts]
  )

  const handleImportCleanImage = useCallback(
    async (cutId: string) => {
      if (!projectId || !activePlotRef.current) return
      const cut = cutsRef.current.find((c) => c.id === cutId)
      if (cut && isImageProtected(cut)) return
      const result = await window.plottoon.fs.importCleanImage(
        projectId,
        activePlotRef.current,
        cutId
      )
      if (!result) return
      const next = cutsRef.current.map((c) => {
        if (c.id !== cutId) return c
        const existing = c.imageState?.revisions ?? []
        const nextVersion =
          existing.length > 0 ? Math.max(...existing.map((r) => r.version)) + 1 : 1
        const revision = {
          version: nextVersion,
          path: result.relativePath,
          createdAt: new Date().toISOString()
        }
        return {
          ...c,
          imageState: {
            ...c.imageState,
            status: 'done' as const,
            path: result.relativePath,
            generationBackend: 'manual',
            revisions: [...existing, revision]
          }
        }
      })
      commitCuts(next)
    },
    [projectId, commitCuts]
  )

  const handleSetCurrentRevision = useCallback(
    (cutId: string, version: number) => {
      const cut = cutsRef.current.find((c) => c.id === cutId)
      if (!cut || isImageProtected(cut)) return
      const revisions = cut.imageState?.revisions ?? []
      const target = revisions.find((r) => r.version === version)
      if (!target) return
      const next = cutsRef.current.map((c) =>
        c.id === cutId
          ? {
              ...c,
              imageState: {
                ...c.imageState,
                status: 'done' as const,
                path: target.path
              }
            }
          : c
      )
      commitCuts(next)
    },
    [commitCuts]
  )

  // #278: agent image sync — main scans the asset folders, returns new
  // revisions, we merge them into cuts.json and surface the result.
  const triggerSync = useCallback(async () => {
    if (!projectId || !activePlotRef.current) return
    if (syncInFlightRef.current) return
    syncInFlightRef.current = true
    try {
      const requests = buildSyncRequests(cutsRef.current)
      const result = await window.plottoon.fs.syncAgentImagesForPlot(
        projectId,
        activePlotRef.current,
        requests
      )
      if (result.adopted.length === 0 && result.rejected.length === 0) {
        // Nothing to report. Don't churn the badge.
        return
      }
      if (result.adopted.length > 0) {
        const merged = mergeAdoptedRevisions(cutsRef.current, result.adopted)
        // #278 RE1 + #279 RE1: routing the merged array through
        // commitCuts (instead of touching cutsRef/setCutsOverride/
        // saveCuts/setActiveCut by hand) keeps the four sources of
        // truth aligned and gives the workflow guide the post-merge
        // view immediately.
        commitCuts(merged)
      }
      setSyncSnapshot({
        adopted: result.adopted,
        rejected: result.rejected
      })
      setSyncDismissed(false)
    } catch {
      // Best-effort; sync failures must never crash the workspace.
    } finally {
      syncInFlightRef.current = false
    }
  }, [projectId, commitCuts])

  useEffect(() => {
    if (!projectId || !activePlot) return
    // Poll every 5 s while a project is open. Polling is the MVP per
    // the #278 issue: avoids the platform variability of fs.watch and
    // matches the agent's write cadence (one image every few seconds
    // at most). The first sync runs immediately so the user doesn't
    // wait 5 s on open.
    void triggerSync()
    const id = setInterval(() => {
      void triggerSync()
    }, 5000)
    return () => clearInterval(id)
  }, [projectId, activePlot, triggerSync])

  const dismissSyncBadge = useCallback(() => setSyncDismissed(true), [])

  const handleAddOverlay = useCallback(
    (cutId: string, presetName: PresetName) => {
      const overlay = createOverlayFromPreset(presetName, 20, 20)
      commitCuts(addOverlay(cutsRef.current, cutId, overlay))
      setSelectedOverlayId(overlay.id)
    },
    [commitCuts]
  )

  const handleDeleteOverlay = useCallback(
    (cutId: string, overlayId: string) => {
      commitCuts(deleteOverlay(cutsRef.current, cutId, overlayId))
      if (selectedOverlayId === overlayId) {
        setSelectedOverlayId(null)
      }
    },
    [commitCuts, selectedOverlayId]
  )

  const handleMoveOverlay = useCallback(
    (overlayId: string, x: number, y: number) => {
      if (!activeCut) return
      commitCuts(moveOverlay(cutsRef.current, activeCut.id, overlayId, x, y))
    },
    [commitCuts, activeCut]
  )

  const handleResizeOverlay = useCallback(
    (cutId: string, overlayId: string, width: number, height: number) => {
      commitCuts(resizeOverlay(cutsRef.current, cutId, overlayId, width, height))
    },
    [commitCuts]
  )

  const handleDuplicateOverlay = useCallback(
    (cutId: string, overlayId: string) => {
      const { cuts: next, newId } = duplicateOverlay(cutsRef.current, cutId, overlayId)
      commitCuts(next)
      if (newId) setSelectedOverlayId(newId)
    },
    [commitCuts]
  )

  const handleReorderOverlay = useCallback(
    (cutId: string, overlayId: string, direction: 'up' | 'down') => {
      commitCuts(reorderOverlay(cutsRef.current, cutId, overlayId, direction))
    },
    [commitCuts]
  )

  const handleSetTailAnchor = useCallback(
    (cutId: string, overlayId: string, x: number, y: number) => {
      commitCuts(setOverlayTailAnchor(cutsRef.current, cutId, overlayId, { x, y }))
    },
    [commitCuts]
  )

  const handleRemoveTailAnchor = useCallback(
    (cutId: string, overlayId: string) => {
      commitCuts(setOverlayTailAnchor(cutsRef.current, cutId, overlayId, undefined))
    },
    [commitCuts]
  )

  if (!projectId) {
    return (
      <div className="workspace__empty" data-testid="workspace-no-project">
        {/*
          #274: explain the AI-agent flow on the empty state. Users
          coming from plotlink-ows expect the terminal to be visible
          at all times; PlotToon hides the panel until a project is
          open. The hint sets that expectation so a first-time user
          doesn't wonder where the agent went.
        */}
        <p>Open a project from the sidebar to start editing.</p>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 8 }}>
          Opening a project also launches the AI agent session for that project.
        </p>
      </div>
    )
  }

  // #278: render the badge only when the user hasn't dismissed it.
  // The component itself returns null when both lists are empty, so
  // this guard purely handles the user-dismiss case (which we never
  // persist beyond the current Workspace mount).
  //
  // #279: derive the workflow-guide state from the live cuts view.
  // `cutsOverride` is the post-#278 source of truth for the current
  // cuts array; we default to [] for the first paint before CutList
  // has loaded from disk. The plotList comes from CutList's
  // listProjectDir result via `onPlotsLoaded` so we can show the
  // "no plots yet" branch.
  const liveCuts = cutsOverride ?? []
  const workflow = deriveWorkflowState({
    hasAnyPlot: plotList.length > 0,
    cuts: liveCuts,
    activeCut,
    allCutsApproved: allCutsApproved(liveCuts)
  })

  return (
    <div className="workspace" data-guide-cta={workflow.cta ?? 'none'}>
      {cwd && (
        <div className="workspace__cwd" data-testid="workspace-cwd" title={cwd}>
          cwd: {cwd}
        </div>
      )}
      <WorkflowGuide state={workflow} />
      {!syncDismissed && (
        <AgentImageSyncBadge
          snapshot={syncSnapshot}
          onRetry={() => {
            void triggerSync()
          }}
          onDismiss={dismissSyncBadge}
        />
      )}
      <div className="workspace__panels">
        <div className="workspace__panel workspace__panel--list" data-testid="cut-list-panel">
          <CutList
            projectId={projectId}
            activeCutId={activeCut?.id ?? null}
            onSelectCut={handleSelectCut}
            onCutsChanged={handleCutsChanged}
            onPlotChanged={handlePlotChanged}
            onPlotsLoaded={setPlotList}
            onEnvelopeLoaded={handleEnvelopeLoaded}
            cutsOverride={cutsOverride}
          />
        </div>

        <div className="workspace__panel workspace__panel--preview" data-testid="preview-panel">
          <EditorCanvas
            cut={activeCut}
            projectId={projectId}
            selectedOverlayId={selectedOverlayId}
            onSelectOverlay={setSelectedOverlayId}
            onMoveOverlay={handleMoveOverlay}
          />
        </div>

        <div className="workspace__panel workspace__panel--inspector" data-testid="inspector-panel">
          <CutInspector
            cut={activeCut}
            onStatusChange={handleStatusChange}
            onImportCleanImage={handleImportCleanImage}
            onSetCurrentRevision={handleSetCurrentRevision}
            selectedOverlayId={selectedOverlayId}
            onAddOverlay={handleAddOverlay}
            onDeleteOverlay={handleDeleteOverlay}
            onDuplicateOverlay={handleDuplicateOverlay}
            onReorderOverlay={handleReorderOverlay}
            onResizeOverlay={handleResizeOverlay}
            onSetTailAnchor={handleSetTailAnchor}
            onRemoveTailAnchor={handleRemoveTailAnchor}
            exportMetas={exportMetas}
          />
        </div>
      </div>

      <div className="workspace__terminal" data-testid="terminal-region">
        <TerminalPanel projectId={projectId} />
      </div>
    </div>
  )
}
