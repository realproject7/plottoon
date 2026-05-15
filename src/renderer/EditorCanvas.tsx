import { useEffect, useState, useCallback, useRef } from 'react'
import type { Cut } from './CutList'

const DEFAULT_CANVAS_WIDTH = 320
const DEFAULT_CANVAS_HEIGHT = 480

export interface EditorCanvasProps {
  cut: Cut | null
  projectId: string
  selectedOverlayId: string | null
  onSelectOverlay: (overlayId: string | null) => void
  onMoveOverlay?: (overlayId: string, x: number, y: number) => void
}

type ImageLoadState =
  | { type: 'none' }
  | { type: 'loading' }
  | { type: 'ready'; src: string }
  | { type: 'error'; message: string }

function getCanvasSize(cut: Cut | null): { width: number; height: number } {
  const w = cut?.canvasOverrides?.width ?? DEFAULT_CANVAS_WIDTH
  const h = cut?.canvasOverrides?.height ?? DEFAULT_CANVAS_HEIGHT
  return { width: w, height: h }
}

export function EditorCanvas({
  cut,
  projectId,
  selectedOverlayId,
  onSelectOverlay,
  onMoveOverlay
}: EditorCanvasProps): JSX.Element {
  const [imageState, setImageState] = useState<ImageLoadState>({ type: 'none' })
  const canvasRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    overlayId: string
    startX: number
    startY: number
    origX: number
    origY: number
  } | null>(null)

  const hasDoneImage = cut?.imageState?.status === 'done' && !!cut?.imageState?.path

  useEffect(() => {
    if (!hasDoneImage || !cut?.imageState?.path) {
      return
    }

    const imagePath = cut.imageState.path
    let cancelled = false

    async function resolve() {
      setImageState({ type: 'loading' })
      try {
        const segments = imagePath.split('/')
        const exists = await window.plottoon.fs.projectFileExists(projectId, ...segments)
        if (cancelled) return
        if (!exists) {
          setImageState({ type: 'error', message: 'Asset not found' })
          return
        }
        const absPath = await window.plottoon.fs.resolveProjectFilePath(projectId, ...segments)
        if (cancelled) return
        setImageState({ type: 'ready', src: `file://${absPath}` })
      } catch (err) {
        if (!cancelled) {
          setImageState({
            type: 'error',
            message: err instanceof Error ? err.message : 'Failed to load asset'
          })
        }
      }
    }
    resolve()
    return () => {
      cancelled = true
    }
  }, [cut, projectId, hasDoneImage])

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === canvasRef.current) {
        onSelectOverlay(null)
      }
    },
    [onSelectOverlay]
  )

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent, overlayId: string) => {
      e.stopPropagation()
      onSelectOverlay(overlayId)
    },
    [onSelectOverlay]
  )

  const handleOverlayMouseDown = useCallback(
    (e: React.MouseEvent, overlayId: string, overlay: { x: number; y: number }) => {
      if (!onMoveOverlay) return
      e.preventDefault()
      dragRef.current = {
        overlayId,
        startX: e.clientX,
        startY: e.clientY,
        origX: overlay.x,
        origY: overlay.y
      }
      const handleMouseMove = (ev: MouseEvent) => {
        if (!dragRef.current) return
        const dx = ev.clientX - dragRef.current.startX
        const dy = ev.clientY - dragRef.current.startY
        onMoveOverlay(
          dragRef.current.overlayId,
          dragRef.current.origX + dx,
          dragRef.current.origY + dy
        )
      }
      const handleMouseUp = () => {
        dragRef.current = null
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [onMoveOverlay]
  )

  if (!cut) {
    return (
      <div
        data-testid="editor-empty"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--color-text-muted)',
          fontSize: 13
        }}
      >
        Select a cut to edit
      </div>
    )
  }

  const { width, height } = getCanvasSize(cut)
  const overlays = cut.overlays ?? []

  return (
    <div
      data-testid="editor-viewport"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        overflow: 'auto',
        padding: 'var(--space-3)'
      }}
    >
      <div
        ref={canvasRef}
        data-testid="editor-canvas"
        data-canvas-width={width}
        data-canvas-height={height}
        onClick={handleCanvasClick}
        style={{
          position: 'relative',
          width,
          height,
          flexShrink: 0,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          overflow: 'hidden'
        }}
      >
        {hasDoneImage && imageState.type === 'ready' && (
          <img
            data-testid="editor-bg-image"
            src={imageState.src}
            alt={cut.direction ?? cut.id ?? 'Canvas background'}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              pointerEvents: 'none'
            }}
          />
        )}

        {!hasDoneImage && (
          <div
            data-testid="editor-blank"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none'
            }}
          >
            <div style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>
              <div style={{ fontSize: 12 }}>No image</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>
                {width} x {height}
              </div>
            </div>
          </div>
        )}

        {overlays.map((overlay) => {
          const isSelected = selectedOverlayId === overlay.id
          const presetStyle = overlay.style ?? {}
          return (
            <div
              key={overlay.id}
              data-testid={`overlay-${overlay.id}`}
              data-overlay-id={overlay.id}
              data-selected={isSelected}
              onClick={(e) => handleOverlayClick(e, overlay.id)}
              onMouseDown={(e) => handleOverlayMouseDown(e, overlay.id, overlay)}
              style={{
                position: 'absolute',
                left: overlay.x,
                top: overlay.y,
                width: overlay.width,
                height: overlay.height,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxSizing: 'border-box',
                overflow: 'hidden',
                userSelect: 'none',
                cursor: 'pointer',
                ...presetStyle,
                ...(isSelected
                  ? {
                      outline: '2px solid var(--color-accent, #3b82f6)',
                      outlineOffset: '1px'
                    }
                  : {})
              }}
            >
              <span
                style={{
                  padding: '0 4px',
                  textOverflow: 'ellipsis',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap'
                }}
              >
                {overlay.content || overlay.id}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
