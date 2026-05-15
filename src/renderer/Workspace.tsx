import { useState, useCallback } from 'react'
import { TerminalPanel } from './TerminalPanel'
import { CutList } from './CutList'
import { CutInspector } from './CutInspector'
import type { Cut } from './CutList'

interface Props {
  projectId?: string
}

export function Workspace({ projectId }: Props): JSX.Element {
  const [activeCut, setActiveCut] = useState<Cut | null>(null)

  const handleSelectCut = useCallback((cut: Cut) => {
    setActiveCut(cut)
  }, [])

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
          />
        </div>

        {/* Center: Preview area */}
        <div
          data-testid="preview-panel"
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--color-bg)'
          }}
        >
          {activeCut ? (
            <div style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 'var(--font-weight-medium)' as never,
                  marginBottom: 'var(--space-2)'
                }}
              >
                {activeCut.id}
              </div>
              {activeCut.direction && (
                <div style={{ fontSize: 12, maxWidth: '40ch', margin: '0 auto' }}>
                  {activeCut.direction}
                </div>
              )}
              {activeCut.imageState?.path && (
                <div
                  style={{
                    fontSize: 11,
                    fontFamily: 'var(--font-mono, monospace)',
                    marginTop: 'var(--space-2)'
                  }}
                >
                  {activeCut.imageState.path}
                </div>
              )}
            </div>
          ) : (
            <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
              Select a cut to preview
            </div>
          )}
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
          <CutInspector cut={activeCut} />
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
