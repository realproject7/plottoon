import type { ReactNode } from 'react'
import type { View } from './App'
import { WalletSelector } from './WalletSelector'
import './shell.css'

interface AppShellProps {
  children: ReactNode
  view: View
  onNavigate: (view: View) => void
}

const NAV_ITEMS: { view: View; label: string }[] = [
  { view: 'projects', label: 'Projects' },
  { view: 'workspace', label: 'Workspace' },
  { view: 'dashboard', label: 'Dashboard' },
  { view: 'status', label: 'Status' },
  { view: 'guides', label: 'Guides' }
]

export function AppShell({ children, view, onNavigate }: AppShellProps): JSX.Element {
  return (
    <div className="app-shell">
      <aside className="app-shell__sidebar">
        <div className="app-shell__brand">
          Plot<span className="app-shell__brand-accent">Toon</span>
        </div>
        <nav className="app-shell__nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.view}
              type="button"
              className={`nav-item ${view === item.view ? 'nav-item--active' : ''}`}
              onClick={() => onNavigate(item.view)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div style={{ flex: 1 }} />
        <div className="app-shell__footer">
          <WalletSelector />
          <div className="app-shell__version">v0.1.0</div>
        </div>
      </aside>
      <main className="app-shell__main">{children}</main>
    </div>
  )
}
