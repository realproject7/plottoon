import { useEffect, useState } from 'react'
import type { Cut } from './CutList'
import { isImageProtected } from './cutMutations'

interface CutPreviewProps {
  cut: Cut | null
  projectId: string
  onImportCleanImage?: (cutId: string) => void
}

type AsyncState =
  | { type: 'idle' }
  | { type: 'loading'; cutId: string; path: string }
  | { type: 'ready'; cutId: string; src: string }
  | { type: 'error'; cutId: string; path: string; message: string }

function needsAsyncLoad(cut: Cut | null): cut is Cut {
  return cut !== null && cut.imageState?.status === 'done' && !!cut.imageState?.path
}

export function CutPreview({ cut, projectId, onImportCleanImage }: CutPreviewProps): JSX.Element {
  const [asyncState, setAsyncState] = useState<AsyncState>({ type: 'idle' })

  useEffect(() => {
    if (!needsAsyncLoad(cut)) return

    const imagePath = cut.imageState!.path!

    let cancelled = false
    async function resolve() {
      setAsyncState({ type: 'loading', cutId: cut.id, path: imagePath })
      try {
        const segments = imagePath.split('/')
        const exists = await window.plottoon.fs.projectFileExists(projectId, ...segments)
        if (cancelled) return
        if (!exists) {
          setAsyncState({
            type: 'error',
            cutId: cut.id,
            path: imagePath,
            message: 'Asset not found'
          })
          return
        }
        const absPath = await window.plottoon.fs.resolveProjectFilePath(projectId, ...segments)
        if (cancelled) return
        setAsyncState({ type: 'ready', cutId: cut.id, src: `file://${absPath}` })
      } catch (err) {
        if (!cancelled) {
          setAsyncState({
            type: 'error',
            cutId: cut.id,
            path: imagePath,
            message: err instanceof Error ? err.message : 'Failed to load asset'
          })
        }
      }
    }
    resolve()
    return () => {
      cancelled = true
    }
  }, [cut, projectId])

  // Derive sync states from props
  if (!cut) {
    return (
      <div
        data-testid="preview-empty"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--color-text-muted)',
          fontSize: 13
        }}
      >
        Select a cut to preview
      </div>
    )
  }

  if (!needsAsyncLoad(cut)) {
    return (
      <div
        data-testid="preview-blank"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 'var(--space-3)'
        }}
      >
        <div
          style={{
            width: 320,
            height: 480,
            background: 'var(--color-surface)',
            border: '2px dashed var(--color-border)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <div style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>
            <div style={{ fontSize: 12 }}>No image</div>
            <div style={{ fontSize: 11, marginTop: 'var(--space-1)' }}>320 &times; 480</div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{cut.id}</div>
        {cut.direction && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--color-text-muted)',
              maxWidth: '40ch',
              textAlign: 'center'
            }}
          >
            {cut.direction}
          </div>
        )}
        {onImportCleanImage && !isImageProtected(cut) && (
          <button
            type="button"
            data-testid="preview-import-btn"
            onClick={() => onImportCleanImage(cut.id)}
            style={{
              all: 'unset',
              cursor: 'pointer',
              fontSize: 12,
              padding: '6px 16px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-surface-raised)',
              border: '1px solid var(--color-border)'
            }}
          >
            Import clean image
          </button>
        )}
      </div>
    )
  }

  if (asyncState.type === 'loading' || asyncState.type === 'idle') {
    return (
      <div
        data-testid="preview-loading"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--color-text-muted)',
          fontSize: 12
        }}
      >
        Loading...
      </div>
    )
  }

  if (asyncState.type === 'error') {
    return (
      <div
        data-testid="preview-error"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 'var(--space-2)'
        }}
      >
        <div style={{ fontSize: 13, color: 'var(--danger)' }}>{asyncState.message}</div>
        <div
          style={{
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-text-muted)',
            maxWidth: '50ch',
            textAlign: 'center',
            wordBreak: 'break-all'
          }}
        >
          {asyncState.path}
        </div>
      </div>
    )
  }

  // asyncState.type === 'ready'
  return (
    <div
      data-testid="preview-image"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: 'var(--space-3)',
        gap: 'var(--space-2)',
        overflow: 'hidden'
      }}
    >
      <img
        src={asyncState.src}
        alt={cut.direction ?? cut.id ?? 'Cut preview'}
        onError={() => {
          setAsyncState({
            type: 'error',
            cutId: asyncState.cutId,
            path: cut.imageState?.path ?? '',
            message: 'Failed to load image'
          })
        }}
        style={{
          maxWidth: '100%',
          maxHeight: 'calc(100% - 40px)',
          objectFit: 'contain',
          borderRadius: 'var(--radius-sm)'
        }}
      />
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{cut.id}</div>
    </div>
  )
}
