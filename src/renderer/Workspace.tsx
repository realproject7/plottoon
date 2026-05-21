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
      saveCuts(cuts)
    },
    [saveCuts]
  )

  const handlePlotChanged = useCallback((plot: string | null) => {
    activePlotRef.current = plot
    setActivePlot(plot)
    envelopeRef.current = null
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
      <div className="workspace__empty">
        <p>Open a project to start editing.</p>
      </div>
    )
  }

  return (
    <div className="workspace">
      {cwd && (
        <div className="workspace__cwd" data-testid="workspace-cwd" title={cwd}>
          cwd: {cwd}
        </div>
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
