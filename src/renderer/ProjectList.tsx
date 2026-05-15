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
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-8)'
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 24,
              fontWeight: 'var(--font-weight-semibold)' as never,
              letterSpacing: '-0.02em',
              lineHeight: 1.2,
              marginBottom: 'var(--space-1)'
            }}
          >
            Projects
          </h1>
          <p style={{ color: 'var(--color-text-secondary)' }}>
            Your webtoon projects will appear here.
          </p>
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
  return (
    <div
      style={{
        color: 'var(--color-text-muted)',
        padding: 'var(--space-12) 0',
        textAlign: 'center'
      }}
    >
      Loading projects...
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }): JSX.Element {
  return (
    <div
      style={{
        border: '1px solid var(--color-error)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-6)',
        background: 'var(--color-surface)'
      }}
    >
      <div
        style={{ fontWeight: 'var(--font-weight-medium)' as never, marginBottom: 'var(--space-2)' }}
      >
        Something went wrong
      </div>
      <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
        {message}
      </p>
      <button type="button" className="btn-primary" onClick={onRetry}>
        Retry
      </button>
    </div>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }): JSX.Element {
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
          maxWidth: '40ch',
          margin: '0 auto var(--space-6)'
        }}
      >
        Create a new project to start building your webtoon.
      </p>
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
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: 'var(--space-4)'
      }}
    >
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

  return (
    <div
      role={!hasError && project.id ? 'button' : undefined}
      tabIndex={!hasError && project.id ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') handleClick()
      }}
      style={{
        border: `1px solid ${hasError ? 'var(--color-error)' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-4)',
        background: 'var(--color-surface)',
        cursor: hasError ? 'default' : 'pointer'
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 'var(--font-weight-medium)' as never,
          marginBottom: 'var(--space-1)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {project.meta?.name ?? project.path.split('/').pop()}
      </div>
      {hasError ? (
        <div style={{ fontSize: 12, color: 'var(--color-error)' }}>{project.error}</div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          {project.meta?.description || 'No description'}
        </div>
      )}
    </div>
  )
}
