export function Workspace(): JSX.Element {
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
        Workspace
      </h1>
      <p style={{ color: 'var(--color-text-secondary)' }}>Open a project to start editing.</p>
    </div>
  )
}
