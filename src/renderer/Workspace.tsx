import { useEffect, useState } from 'react'
import { TerminalPanel } from './TerminalPanel'

interface Props {
  projectId?: string
}

export function Workspace({ projectId }: Props): JSX.Element {
  const [cwd, setCwd] = useState<string | null>(null)

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

  const activeCwd = projectId ? cwd : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <h1
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 24,
          fontWeight: 'var(--font-weight-semibold)' as never,
          letterSpacing: '-0.02em',
          lineHeight: 1.2,
          marginBottom: 'var(--space-2)',
          flexShrink: 0
        }}
      >
        Workspace
      </h1>
      {activeCwd && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-mono, monospace)',
            marginBottom: 'var(--space-4)',
            flexShrink: 0
          }}
        >
          cwd: {activeCwd}
        </div>
      )}
      {!projectId && (
        <p style={{ color: 'var(--color-text-secondary)' }}>Open a project to start editing.</p>
      )}
      {projectId && (
        <div style={{ flex: 1, minHeight: 0 }}>
          <TerminalPanel projectId={projectId} />
        </div>
      )}
    </div>
  )
}
