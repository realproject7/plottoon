import { useState, useEffect } from 'react'
import { AppShell } from './AppShell'
import { ProjectList } from './ProjectList'
import { Workspace } from './Workspace'
import { CapabilityReport } from './CapabilityReport'
import { AtlasCloudGuide } from './AtlasCloudGuide'
import { Dashboard } from './Dashboard'
import { WALLET_ACTIVE_CHANGED_EVENT } from '../shared/walletIdentity'

export type View = 'projects' | 'workspace' | 'dashboard' | 'status' | 'guides'

function App(): JSX.Element {
  const [view, setView] = useState<View>('projects')
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)

  const handleSelectProject = (projectId: string): void => {
    setActiveProjectId(projectId)
    setView('workspace')
  }

  // Wallet switches must invalidate the open workspace project. The new
  // active wallet might not own the previously-opened project, and the
  // wallet-scoped lookup means that project may no longer be visible at
  // all — keep the user from editing wallet-A's project under wallet B.
  useEffect(() => {
    function onActiveWalletChanged(): void {
      setActiveProjectId(null)
      setView((current) => (current === 'workspace' ? 'projects' : current))
    }
    window.addEventListener(WALLET_ACTIVE_CHANGED_EVENT, onActiveWalletChanged)
    return () => window.removeEventListener(WALLET_ACTIVE_CHANGED_EVENT, onActiveWalletChanged)
  }, [])

  let content: JSX.Element
  if (view === 'projects') content = <ProjectList onSelectProject={handleSelectProject} />
  else if (view === 'dashboard') content = <Dashboard />
  else if (view === 'status') content = <CapabilityReport />
  else if (view === 'guides') content = <AtlasCloudGuide />
  else content = <Workspace projectId={activeProjectId ?? undefined} />

  return (
    <AppShell view={view} onNavigate={setView}>
      {content}
    </AppShell>
  )
}

export default App
