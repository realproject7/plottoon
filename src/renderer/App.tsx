import { useState } from 'react'
import { AppShell } from './AppShell'
import { ProjectList } from './ProjectList'
import { Workspace } from './Workspace'

export type View = 'projects' | 'workspace'

function App(): JSX.Element {
  const [view, setView] = useState<View>('projects')

  return (
    <AppShell view={view} onNavigate={setView}>
      {view === 'projects' ? <ProjectList /> : <Workspace />}
    </AppShell>
  )
}

export default App
