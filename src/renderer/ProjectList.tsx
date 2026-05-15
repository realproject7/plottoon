export function ProjectList(): JSX.Element {
  return (
    <div>
      <h1
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 24,
          fontWeight: 'var(--font-weight-semibold)' as never,
          letterSpacing: '-0.02em',
          lineHeight: 1.2,
          marginBottom: 'var(--space-2)'
        }}
      >
        Projects
      </h1>
      <p
        style={{
          color: 'var(--color-text-secondary)',
          marginBottom: 'var(--space-8)'
        }}
      >
        Your webtoon projects will appear here.
      </p>
      <EmptyState />
    </div>
  )
}

function EmptyState(): JSX.Element {
  return (
    <div
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-12) var(--space-8)',
        textAlign: 'center',
        background: 'var(--color-surface)'
      }}
    >
      <div
        style={{
          fontSize: 18,
          fontFamily: 'var(--font-display)',
          fontWeight: 'var(--font-weight-medium)' as never,
          marginBottom: 'var(--space-2)'
        }}
      >
        No projects yet
      </div>
      <p
        style={{
          color: 'var(--color-text-secondary)',
          marginBottom: 'var(--space-6)',
          maxWidth: '40ch',
          margin: '0 auto var(--space-6)'
        }}
      >
        Create or open a project folder to start building your webtoon.
      </p>
      <button type="button" className="btn-primary">
        Open Project
      </button>
    </div>
  )
}
