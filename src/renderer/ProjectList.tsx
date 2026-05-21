import { useEffect, useReducer } from 'react'

interface State {
  projects: DiscoveredProject[]
  loading: boolean
  error: string | null
  refreshKey: number
}

type Action =
  | { type: 'loading' }
  | { type: 'loaded'; projects: DiscoveredProject[] }
  | { type: 'failed'; error: string }
  | { type: 'refresh' }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'loading':
      return { ...state, loading: true, error: null }
    case 'loaded':
      return { ...state, loading: false, projects: action.projects }
    case 'failed':
      return { ...state, loading: false, error: action.error }
    case 'refresh':
      return { ...state, refreshKey: state.refreshKey + 1 }
  }
}

interface ProjectListProps {
  onSelectProject?: (projectId: string) => void
}

export function ProjectList({ onSelectProject }: ProjectListProps): JSX.Element {
  const [state, dispatch] = useReducer(reducer, {
    projects: [],
    loading: true,
    error: null,
    refreshKey: 0
  })

  useEffect(() => {
    let cancelled = false
    dispatch({ type: 'loading' })
    window.plottoon.project
      .discover()
      .then((discovered) => {
        if (!cancelled) dispatch({ type: 'loaded', projects: discovered })
      })
      .catch((err) => {
        if (!cancelled)
          dispatch({
            type: 'failed',
            error: err instanceof Error ? err.message : 'Failed to discover projects'
          })
      })
    return () => {
      cancelled = true
    }
  }, [state.refreshKey])

  const handleCreate = async (): Promise<void> => {
    const name = prompt('Project name:')
    if (!name?.trim()) return
    try {
      const result = await window.plottoon.project.create(name.trim())
      if (result) dispatch({ type: 'refresh' })
    } catch (err) {
      dispatch({
        type: 'failed',
        error: err instanceof Error ? err.message : 'Failed to create project'
      })
    }
  }

  return (
    <div className="projects-screen">
      <div className="projects-screen__header">
        <div>
          <h1 className="projects-screen__heading">Projects</h1>
          <p className="projects-screen__subhead">Your webtoon projects will appear here.</p>
        </div>
        {state.projects.length > 0 && (
          <button type="button" className="btn-primary" onClick={handleCreate}>
            New Project
          </button>
        )}
      </div>

      {state.loading && <LoadingState />}
      {!state.loading && state.error && (
        <ErrorState message={state.error} onRetry={() => dispatch({ type: 'refresh' })} />
      )}
      {!state.loading && !state.error && state.projects.length === 0 && (
        <EmptyState onCreate={handleCreate} />
      )}
      {!state.loading && !state.error && state.projects.length > 0 && (
        <ProjectGrid projects={state.projects} onSelectProject={onSelectProject} />
      )}
    </div>
  )
}

function LoadingState(): JSX.Element {
  return <div className="loading-state">Loading projects...</div>
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }): JSX.Element {
  return (
    <div className="error-panel">
      <div className="error-panel__title">Something went wrong</div>
      <p className="error-panel__message">{message}</p>
      <button type="button" className="btn-primary" onClick={onRetry}>
        Retry
      </button>
    </div>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }): JSX.Element {
  return (
    <div className="empty-state">
      <div>
        <div className="empty-state__title">No projects yet</div>
        <p className="empty-state__body">Create a new project to start building your webtoon.</p>
      </div>
      <button type="button" className="btn-primary" onClick={onCreate}>
        New Project
      </button>
    </div>
  )
}

function ProjectGrid({
  projects,
  onSelectProject
}: {
  projects: DiscoveredProject[]
  onSelectProject?: (projectId: string) => void
}): JSX.Element {
  return (
    <div className="project-grid">
      {projects.map((project) => (
        <ProjectCard key={project.path} project={project} onSelect={onSelectProject} />
      ))}
    </div>
  )
}

function ProjectCard({
  project,
  onSelect
}: {
  project: DiscoveredProject
  onSelect?: (projectId: string) => void
}): JSX.Element {
  const hasError = project.error !== null

  const handleClick = (): void => {
    if (!hasError && project.id && onSelect) {
      onSelect(project.id)
    }
  }

  const cardClassName = `project-card${hasError ? ' project-card--error' : ''}`
  const projectName = project.meta?.name ?? project.path.split('/').pop() ?? 'Untitled project'

  return (
    <div
      role={!hasError && project.id ? 'button' : undefined}
      tabIndex={!hasError && project.id ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') handleClick()
      }}
      className={cardClassName}
      title={projectName}
    >
      <div className="project-card__title">{projectName}</div>
      {hasError ? (
        <div className="project-card__error">{project.error}</div>
      ) : (
        <div className="project-card__description">
          {project.meta?.description || 'No description'}
        </div>
      )}
    </div>
  )
}
