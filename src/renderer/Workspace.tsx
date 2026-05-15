import { TerminalPanel } from './TerminalPanel'

interface Props {
  projectId?: string
}

export function Workspace({ projectId }: Props): JSX.Element {
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
