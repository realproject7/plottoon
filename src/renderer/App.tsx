import { useState } from 'react'
import { AppShell } from './AppShell'
import { ProjectList } from './ProjectList'
import { Workspace } from './Workspace'
import { CapabilityReport } from './CapabilityReport'

export type View = 'projects' | 'workspace' | 'status'

function App(): JSX.Element {
  const [view, setView] = useState<View>('projects')

  let content: JSX.Element
  if (view === 'projects') content = <ProjectList />
  else if (view === 'status') content = <CapabilityReport />
  else content = <Workspace />

  return (
    <AppShell view={view} onNavigate={setView}>
      {content}
    </AppShell>
  )
}

export default App
