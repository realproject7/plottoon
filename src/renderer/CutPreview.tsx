import { useEffect, useState } from 'react'
import type { Cut } from './CutList'

interface CutPreviewProps {
  cut: Cut | null
  projectId: string
}

type PreviewState =
  | { type: 'empty' }
  | { type: 'blank'; cutId: string }
  | { type: 'loading'; cutId: string; path: string }
  | { type: 'ready'; cutId: string; src: string }
  | { type: 'error'; cutId: string; path: string; message: string }

export function CutPreview({ cut, projectId }: CutPreviewProps): JSX.Element {
  const [state, setState] = useState<PreviewState>({ type: 'empty' })

  useEffect(() => {
    if (!cut) {
      setState({ type: 'empty' })
      return
    }

    const imagePath = cut.imageState?.path
    if (!imagePath || cut.imageState?.status !== 'done') {
      setState({ type: 'blank', cutId: cut.id })
      return
    }

    setState({ type: 'loading', cutId: cut.id, path: imagePath })

    let cancelled = false
    async function resolve() {
      try {
        const segments = imagePath!.split('/')
        const exists = await window.plottoon.fs.projectFileExists(projectId, ...segments)
        if (cancelled) return
        if (!exists) {
          setState({
            type: 'error',
            cutId: cut!.id,
            path: imagePath!,
            message: 'Asset not found'
          })
          return
        }
        const absPath = await window.plottoon.fs.resolveProjectFilePath(projectId, ...segments)
        if (cancelled) return
        setState({ type: 'ready', cutId: cut!.id, src: `file://${absPath}` })
      } catch (err) {
        if (!cancelled) {
          setState({
            type: 'error',
            cutId: cut!.id,
            path: imagePath!,
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

  if (state.type === 'empty') {
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

  if (state.type === 'blank') {
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
            borderRadius: 'var(--radius-md, 8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <div style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>
            <div style={{ fontSize: 24, marginBottom: 'var(--space-2)' }}>&#x1F5BC;</div>
            <div style={{ fontSize: 12 }}>No image</div>
            <div style={{ fontSize: 11, marginTop: 'var(--space-1)' }}>320 &times; 480</div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{cut?.id}</div>
        {cut?.direction && (
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
      </div>
    )
  }

  if (state.type === 'loading') {
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

  if (state.type === 'error') {
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
        <div style={{ fontSize: 13, color: 'var(--color-error, #e53e3e)' }}>{state.message}</div>
        <div
          style={{
            fontSize: 11,
            fontFamily: 'var(--font-mono, monospace)',
            color: 'var(--color-text-muted)',
            maxWidth: '50ch',
            textAlign: 'center',
            wordBreak: 'break-all'
          }}
        >
          {state.path}
        </div>
      </div>
    )
  }

  // state.type === 'ready'
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
        src={state.src}
        alt={cut?.direction ?? cut?.id ?? 'Cut preview'}
        onError={() => {
          setState({
            type: 'error',
            cutId: state.cutId,
            path: cut?.imageState?.path ?? '',
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
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{cut?.id}</div>
    </div>
  )
}
