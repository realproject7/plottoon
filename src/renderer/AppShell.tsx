import type { ReactNode } from 'react'
import type { View } from './App'
import { WalletSelector } from './WalletSelector'
import './shell.css'

interface AppShellProps {
  children: ReactNode
  view: View
  onNavigate: (view: View) => void
}

export function AppShell({ children, view, onNavigate }: AppShellProps): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        background: 'var(--color-bg)'
      }}
    >
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
          <button
            type="button"
            className={`nav-item ${view === 'projects' ? 'nav-item--active' : ''}`}
            onClick={() => onNavigate('projects')}
          >
            Projects
          </button>
          <button
            type="button"
            className={`nav-item ${view === 'workspace' ? 'nav-item--active' : ''}`}
            onClick={() => onNavigate('workspace')}
          >
            Workspace
          </button>
          <button
            type="button"
            className={`nav-item ${view === 'dashboard' ? 'nav-item--active' : ''}`}
            onClick={() => onNavigate('dashboard')}
          >
            Dashboard
          </button>
          <button
            type="button"
            className={`nav-item ${view === 'status' ? 'nav-item--active' : ''}`}
            onClick={() => onNavigate('status')}
          >
            Status
          </button>
          <button
            type="button"
            className={`nav-item ${view === 'guides' ? 'nav-item--active' : ''}`}
            onClick={() => onNavigate('guides')}
          >
            Guides
          </button>
        </nav>
        <div style={{ flex: 1 }} />
        <WalletSelector />
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-text-muted)',
            letterSpacing: '0.01em',
            marginTop: 'var(--space-4)'
          }}
        >
          v0.1.0
        </div>
      </aside>
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
