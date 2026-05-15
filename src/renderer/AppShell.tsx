import type { ReactNode } from 'react'

export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        background: 'var(--color-bg)'
      }}
    >
      <Sidebar />
      <main
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 'var(--space-8)'
        }}
      >
        {children}
      </main>
    </div>
  )
}

function Sidebar(): JSX.Element {
  return (
    <aside
      style={{
        width: 'var(--sidebar-width)',
        background: 'var(--color-surface)',
        borderRight: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        padding: 'var(--space-4)'
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 'var(--font-weight-semibold)' as never,
          fontSize: 20,
          letterSpacing: '-0.01em',
          padding: 'var(--space-2) 0',
          marginBottom: 'var(--space-6)'
        }}
      >
        PlotToon
      </div>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <NavItem label="Projects" active />
        <NavItem label="Workspace" />
      </nav>
      <div style={{ flex: 1 }} />
      <div
        style={{
          fontSize: 11,
          color: 'var(--color-text-muted)',
          letterSpacing: '0.01em'
        }}
      >
        v0.1.0
      </div>
    </aside>
  )
}

function NavItem({ label, active }: { label: string; active?: boolean }): JSX.Element {
  return (
    <div
      style={{
        padding: 'var(--space-2) var(--space-3)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 13,
        fontWeight: active ? 'var(--font-weight-medium)' : ('var(--font-weight-regular)' as never),
        color: active ? 'var(--color-text)' : 'var(--color-text-secondary)',
        background: active ? 'var(--color-surface-raised)' : 'transparent',
        cursor: 'pointer'
      }}
    >
      {label}
    </div>
  )
}
