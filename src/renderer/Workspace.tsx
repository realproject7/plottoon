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
  setOverlayTailAnchor
} from './cutMutations'
import type { CutStatus } from './cutMutations'
import type { Cut } from './CutList'
import { createOverlayFromPreset } from './overlayPresets'
import type { PresetName } from './overlayPresets'

interface Props {
  projectId?: string
}

export function Workspace({ projectId }: Props): JSX.Element {
  const [activeCut, setActiveCut] = useState<Cut | null>(null)
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null)
  const [cwd, setCwd] = useState<string | null>(null)
  const activePlotRef = useRef<string | null>(null)
  const cutsRef = useRef<Cut[]>([])

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

  const handleSelectCut = useCallback((cut: Cut | null) => {
    setActiveCut(cut)
    setSelectedOverlayId(null)
  }, [])

  const saveCuts = useCallback(
    (cuts: Cut[]) => {
      if (!projectId || !activePlotRef.current) return
      const data = JSON.stringify({ cuts }, null, 2)
      window.plottoon.fs.writeProjectFile(
        projectId,
        ['plots', activePlotRef.current, 'cuts.json'],
        data
      )
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
      const next = duplicateOverlay(cutsRef.current, cutId, overlayId)
      cutsRef.current = next
      saveCuts(next)
      const updated = next.find((c) => c.id === cutId)
      if (updated && activeCut?.id === cutId) setActiveCut(updated)
      const newOverlay = updated?.overlays?.find(
        (o) =>
          o.id !== overlayId &&
          !cutsRef.current.find((c) => c.id === cutId)?.overlays?.some((old) => old.id === o.id)
      )
      if (newOverlay) setSelectedOverlayId(newOverlay.id)
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

  if (!projectId) {
    return (
      <div style={{ padding: 'var(--space-4)' }}>
        <p style={{ color: 'var(--color-text-secondary)' }}>Open a project to start editing.</p>
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden'
      }}
    >
      {cwd && (
        <div
          data-testid="workspace-cwd"
          style={{
            fontSize: 12,
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-mono, monospace)',
            padding: 'var(--space-2) var(--space-3)',
            borderBottom: '1px solid var(--color-border)',
            flexShrink: 0
          }}
        >
          cwd: {cwd}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden'
        }}
      >
        {/* Left: Cut list navigation */}
        <div
          data-testid="cut-list-panel"
          style={{
            width: 200,
            flexShrink: 0,
            borderRight: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            overflow: 'hidden'
          }}
        >
          <CutList
            projectId={projectId}
            activeCutId={activeCut?.id ?? null}
            onSelectCut={handleSelectCut}
            onCutsChanged={handleCutsChanged}
            onPlotChanged={handlePlotChanged}
          />
        </div>

        {/* Center: Preview area */}
        <div
          data-testid="preview-panel"
          style={{
            flex: 1,
            minWidth: 0,
            background: 'var(--color-bg)',
            overflow: 'hidden'
          }}
        >
          <EditorCanvas
            cut={activeCut}
            projectId={projectId}
            selectedOverlayId={selectedOverlayId}
            onSelectOverlay={setSelectedOverlayId}
            onMoveOverlay={handleMoveOverlay}
          />
        </div>

        {/* Right: Inspector */}
        <div
          data-testid="inspector-panel"
          style={{
            width: 240,
            flexShrink: 0,
            borderLeft: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            overflow: 'auto'
          }}
        >
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
          />
        </div>
      </div>

      {/* Bottom: Terminal */}
      <div
        data-testid="terminal-region"
        style={{
          height: 200,
          flexShrink: 0,
          borderTop: '1px solid var(--color-border)'
        }}
      >
        <TerminalPanel projectId={projectId} />
      </div>
    </div>
  )
}
