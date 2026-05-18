import { useState } from 'react'
import { AppShell } from './AppShell'
import { ProjectList } from './ProjectList'
import { Workspace } from './Workspace'
import { CapabilityReport } from './CapabilityReport'
import { AtlasCloudGuide } from './AtlasCloudGuide'
import { Dashboard } from './Dashboard'

export type View = 'projects' | 'workspace' | 'dashboard' | 'status' | 'guides'

function App(): JSX.Element {
  const [view, setView] = useState<View>('projects')
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)

  const handleSelectProject = (projectId: string): void => {
    setActiveProjectId(projectId)
    setView('workspace')
  }

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
