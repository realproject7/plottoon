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

  const handleCutsChanged = useCallback(
    (cuts: Cut[]) => {
      cutsRef.current = cuts
      // #278 RE1: keep the override mirror current so a later sync
      // merge can be computed off the latest user mutations instead of
      // the original load. We don't push this back into CutList (it
      // already has the latest in its own reducer) — we only set it so
      // sync-side reads via `cutsRef` stay aligned with what we'd hand
      // to `<CutList cutsOverride={...}>` on the next sync.
      setCutsOverride(cuts)
      saveCuts(cuts)
    },
    [saveCuts]
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
      const next = setStatus(cutsRef.current, cutId, status)
      cutsRef.current = next
      saveCuts(next)
      const updated = next.find((c) => c.id === cutId)
      if (updated && activeCut?.id === cutId) {
        setActiveCut(updated)
      }
    },
    [saveCuts, activeCut]
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
      cutsRef.current = next
      saveCuts(next)
      const updated = next.find((c) => c.id === cutId)
      if (updated && activeCut?.id === cutId) {
        setActiveCut(updated)
      }
    },
    [projectId, saveCuts, activeCut]
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
      cutsRef.current = next
      saveCuts(next)
      const updated = next.find((c) => c.id === cutId)
      if (updated && activeCut?.id === cutId) {
        setActiveCut(updated)
      }
    },
    [saveCuts, activeCut]
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
        cutsRef.current = merged
        // #278 RE1: push the merged array into CutList via the
        // override prop BEFORE we persist + before we touch activeCut.
        // The new array reference triggers CutList's update-cuts
        // dispatch, so its internal state.cuts matches disk. Without
        // this, the next CutList mutation would write its stale view
        // back over the synced revisions.
        setCutsOverride(merged)
        saveCuts(merged)
        if (activeCut) {
          const updated = merged.find((c) => c.id === activeCut.id)
          if (updated) setActiveCut(updated)
        }
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
  }, [projectId, saveCuts, activeCut])

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
      const next = addOverlay(cutsRef.current, cutId, overlay)
      cutsRef.current = next
      saveCuts(next)
      const updated = next.find((c) => c.id === cutId)
      if (updated && activeCut?.id === cutId) {
        setActiveCut(updated)
      }
      setSelectedOverlayId(overlay.id)
    },
    [saveCuts, activeCut]
  )

  const handleDeleteOverlay = useCallback(
    (cutId: string, overlayId: string) => {
      const next = deleteOverlay(cutsRef.current, cutId, overlayId)
      cutsRef.current = next
      saveCuts(next)
      const updated = next.find((c) => c.id === cutId)
      if (updated && activeCut?.id === cutId) {
        setActiveCut(updated)
      }
      if (selectedOverlayId === overlayId) {
        setSelectedOverlayId(null)
      }
    },
    [saveCuts, activeCut, selectedOverlayId]
  )

  const handleMoveOverlay = useCallback(
    (overlayId: string, x: number, y: number) => {
      if (!activeCut) return
      const next = moveOverlay(cutsRef.current, activeCut.id, overlayId, x, y)
      cutsRef.current = next
      saveCuts(next)
      const updated = next.find((c) => c.id === activeCut.id)
      if (updated) setActiveCut(updated)
    },
    [saveCuts, activeCut]
  )

  const handleResizeOverlay = useCallback(
    (cutId: string, overlayId: string, width: number, height: number) => {
      const next = resizeOverlay(cutsRef.current, cutId, overlayId, width, height)
      cutsRef.current = next
      saveCuts(next)
      const updated = next.find((c) => c.id === cutId)
      if (updated && activeCut?.id === cutId) setActiveCut(updated)
    },
    [saveCuts, activeCut]
  )

  const handleDuplicateOverlay = useCallback(
    (cutId: string, overlayId: string) => {
      const { cuts: next, newId } = duplicateOverlay(cutsRef.current, cutId, overlayId)
      cutsRef.current = next
      saveCuts(next)
      const updated = next.find((c) => c.id === cutId)
      if (updated && activeCut?.id === cutId) setActiveCut(updated)
      if (newId) setSelectedOverlayId(newId)
    },
    [saveCuts, activeCut]
  )

  const handleReorderOverlay = useCallback(
    (cutId: string, overlayId: string, direction: 'up' | 'down') => {
      const next = reorderOverlay(cutsRef.current, cutId, overlayId, direction)
      cutsRef.current = next
      saveCuts(next)
      const updated = next.find((c) => c.id === cutId)
      if (updated && activeCut?.id === cutId) setActiveCut(updated)
    },
    [saveCuts, activeCut]
  )

  const handleSetTailAnchor = useCallback(
    (cutId: string, overlayId: string, x: number, y: number) => {
      const next = setOverlayTailAnchor(cutsRef.current, cutId, overlayId, { x, y })
      cutsRef.current = next
      saveCuts(next)
      const updated = next.find((c) => c.id === cutId)
      if (updated && activeCut?.id === cutId) setActiveCut(updated)
    },
    [saveCuts, activeCut]
  )

  const handleRemoveTailAnchor = useCallback(
    (cutId: string, overlayId: string) => {
      const next = setOverlayTailAnchor(cutsRef.current, cutId, overlayId, undefined)
      cutsRef.current = next
      saveCuts(next)
      const updated = next.find((c) => c.id === cutId)
      if (updated && activeCut?.id === cutId) setActiveCut(updated)
    },
    [saveCuts, activeCut]
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
  return (
    <div className="workspace">
      {cwd && (
        <div className="workspace__cwd" data-testid="workspace-cwd" title={cwd}>
          cwd: {cwd}
        </div>
      )}
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
