import { useEffect, useReducer, useRef, useState } from 'react'
import { WALLET_ACTIVE_CHANGED_EVENT } from '../shared/walletIdentity'

interface State {
  partition: PartitionedDiscovery
  loading: boolean
  error: string | null
  refreshKey: number
  createDialogOpen: boolean
}

type Action =
  | { type: 'loading' }
  | { type: 'loaded'; partition: PartitionedDiscovery }
  | { type: 'failed'; error: string }
  | { type: 'refresh' }
  | { type: 'openCreate' }
  | { type: 'closeCreate' }

const EMPTY_PARTITION: PartitionedDiscovery = {
  owned: [],
  legacy: [],
  otherWallets: [],
  errors: [],
  activeAddress: null
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'loading':
      return { ...state, loading: true, error: null }
    case 'loaded':
      return { ...state, loading: false, partition: action.partition }
    case 'failed':
      return { ...state, loading: false, error: action.error }
    case 'refresh':
      return { ...state, refreshKey: state.refreshKey + 1 }
    case 'openCreate':
      return { ...state, createDialogOpen: true, error: null }
    case 'closeCreate':
      return { ...state, createDialogOpen: false }
  }
}

interface ProjectListProps {
  onSelectProject?: (projectId: string) => void
}

export function ProjectList({ onSelectProject }: ProjectListProps): JSX.Element {
  const [state, dispatch] = useReducer(reducer, {
    partition: EMPTY_PARTITION,
    loading: true,
    error: null,
    refreshKey: 0,
    createDialogOpen: false
  })

  useEffect(() => {
    let cancelled = false
    dispatch({ type: 'loading' })
    window.plottoon.project
      .discover()
      .then((result) => {
        if (!cancelled) dispatch({ type: 'loaded', partition: result })
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

  useEffect(() => {
    function onActiveChanged(): void {
      dispatch({ type: 'refresh' })
    }
    window.addEventListener(WALLET_ACTIVE_CHANGED_EVENT, onActiveChanged)
    return () => window.removeEventListener(WALLET_ACTIVE_CHANGED_EVENT, onActiveChanged)
  }, [])

  // #246: open the in-app dialog instead of `window.prompt` — the browser
  // prompt was unreliable in Electron (silent failures, appearing off-window).
  // The actual create call happens inside `NewProjectDialog` on submit.
  const handleCreate = (): void => {
    dispatch({ type: 'openCreate' })
  }

  const handleCreateSubmit = async (name: string): Promise<{ error?: string }> => {
    try {
      const result = await window.plottoon.project.create(name)
      if (result) {
        dispatch({ type: 'closeCreate' })
        dispatch({ type: 'refresh' })
      } else {
        // `project:create` returned null — the user cancelled the
        // folder-picker dialog after entering a name. Close cleanly.
        dispatch({ type: 'closeCreate' })
      }
      return {}
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Failed to create project' }
    }
  }

  const handleAssign = async (projectId: string): Promise<void> => {
    try {
      await window.plottoon.project.assignToActiveWallet(projectId)
      dispatch({ type: 'refresh' })
    } catch (err) {
      dispatch({
        type: 'failed',
        error: err instanceof Error ? err.message : 'Failed to assign project'
      })
    }
  }

  const { partition } = state
  const hasOwned = partition.owned.length > 0
  const hasLegacy = partition.legacy.length > 0
  const hasErrors = partition.errors.length > 0
  const hasActiveWallet = partition.activeAddress !== null

  return (
    <div className="projects-screen">
      <div className="projects-screen__header">
        <div>
          <h1 className="projects-screen__heading">Projects</h1>
          <p className="projects-screen__subhead">
            {hasActiveWallet
              ? 'Your webtoon projects for the active wallet.'
              : 'Connect a wallet to see and create projects.'}
          </p>
        </div>
        {hasActiveWallet && hasOwned && (
          <button type="button" className="btn-primary" onClick={handleCreate}>
            New Project
          </button>
        )}
      </div>

      {state.loading && <LoadingState />}
      {!state.loading && state.error && (
        <ErrorState message={state.error} onRetry={() => dispatch({ type: 'refresh' })} />
      )}
      {!state.loading && !state.error && !hasActiveWallet && <NoWalletState />}
      {!state.loading && !state.error && hasActiveWallet && !hasOwned && !hasLegacy && (
        <EmptyState onCreate={handleCreate} />
      )}
      {!state.loading && !state.error && hasOwned && (
        <ProjectGrid projects={partition.owned} onSelectProject={onSelectProject} />
      )}
      {!state.loading && !state.error && hasLegacy && hasActiveWallet && (
        <section className="screen__section" data-testid="legacy-projects-section">
          <div className="screen__section-label">Unassigned projects</div>
          <p className="projects-screen__subhead">
            Projects created before wallet-scoping. Assign one to the active wallet to make it
            visible by default.
          </p>
          <LegacyProjectGrid projects={partition.legacy} onAssign={handleAssign} />
        </section>
      )}
      {!state.loading && !state.error && hasErrors && (
        <section className="screen__section" data-testid="error-projects-section">
          <div className="screen__section-label">Projects with metadata errors</div>
          <ErrorProjectGrid projects={partition.errors} />
        </section>
      )}

      {state.createDialogOpen && (
        <NewProjectDialog
          onCancel={() => dispatch({ type: 'closeCreate' })}
          onSubmit={handleCreateSubmit}
        />
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

function NoWalletState(): JSX.Element {
  return (
    <div className="empty-state" data-testid="no-active-wallet-state">
      <div>
        <div className="empty-state__title">No active wallet</div>
        <p className="empty-state__body">
          Use the wallet switcher in the sidebar to connect or pick a wallet, then return here to
          see and create projects.
        </p>
      </div>
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
    if (!hasError && project.id && onSelect) onSelect(project.id)
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

function LegacyProjectGrid({
  projects,
  onAssign
}: {
  projects: DiscoveredProject[]
  onAssign: (projectId: string) => void
}): JSX.Element {
  return (
    <div className="project-grid">
      {projects.map((project) => (
        <LegacyProjectCard key={project.path} project={project} onAssign={onAssign} />
      ))}
    </div>
  )
}

function LegacyProjectCard({
  project,
  onAssign
}: {
  project: DiscoveredProject
  onAssign: (projectId: string) => void
}): JSX.Element {
  const projectName = project.meta?.name ?? project.path.split('/').pop() ?? 'Untitled project'
  const description = project.meta?.description || 'No description'
  return (
    <div
      className="project-card"
      title={projectName}
      data-testid={`legacy-project-${project.path}`}
    >
      <div className="project-card__title">{projectName}</div>
      <div className="project-card__description">{description}</div>
      <button
        type="button"
        className="text-btn"
        style={{ alignSelf: 'flex-start', marginTop: 6 }}
        onClick={(e) => {
          e.stopPropagation()
          if (project.id) onAssign(project.id)
        }}
        disabled={!project.id}
        data-testid={`assign-project-${project.path}`}
      >
        Assign to active wallet →
      </button>
    </div>
  )
}

function ErrorProjectGrid({ projects }: { projects: DiscoveredProject[] }): JSX.Element {
  return (
    <div className="project-grid">
      {projects.map((project) => (
        <div key={project.path} className="project-card project-card--error">
          <div className="project-card__title">{project.path.split('/').pop()}</div>
          <div className="project-card__error">{project.error}</div>
        </div>
      ))}
    </div>
  )
}

interface NewProjectDialogProps {
  onCancel: () => void
  onSubmit: (name: string) => Promise<{ error?: string }>
}

function NewProjectDialog({ onCancel, onSubmit }: NewProjectDialogProps): JSX.Element {
  const [name, setName] = useState('')
  const [validation, setValidation] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // #269: track whether the workspace folder is already configured.
  // - `null` while loading (don't render either branch yet so the
  //    explanation banner doesn't flash for established users).
  // - `false` → first-run; show the in-app explanation so the user
  //    knows the upcoming native folder picker is asking for the
  //    PARENT workspace folder, not the per-project folder.
  // - `true`  → silent path; never re-show this on every project
  //    creation once a workspace is configured.
  const [workspaceConfigured, setWorkspaceConfigured] = useState<boolean | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      try {
        const dir = await window.plottoon.project.getProjectsDir()
        if (!cancelled) setWorkspaceConfigured(dir !== null)
      } catch {
        // If the read fails (rare; fs error in the config dir), assume
        // first-run so the user gets the more-informative copy. Worst
        // case: they see the explanation once even though they had a
        // workspace configured — better than the opposite mistake.
        if (!cancelled) setWorkspaceConfigured(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && !submitting) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, submitting])

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (submitting) return
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      setValidation('Enter a project name to continue.')
      return
    }
    setValidation(null)
    setSubmitError(null)
    setSubmitting(true)
    const result = await onSubmit(trimmed)
    setSubmitting(false)
    if (result.error) {
      setSubmitError(result.error)
    }
  }

  return (
    <div
      className="dialog-overlay"
      role="presentation"
      data-testid="new-project-dialog-overlay"
      onClick={(e) => {
        // Clicking the dim overlay (but not the dialog itself) cancels.
        if (e.target === e.currentTarget && !submitting) onCancel()
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-dialog-title"
        data-testid="new-project-dialog"
      >
        <form onSubmit={handleSubmit} className="dialog__form">
          <h2 id="new-project-dialog-title" className="dialog__title">
            New project
          </h2>
          {workspaceConfigured === false && (
            <div className="dialog__hint" data-testid="new-project-workspace-explainer" role="note">
              {/*
                #269: first-run explainer. After Create, the native
                folder picker asks for the WORKSPACE folder where
                PlotToon will store every project — not the folder
                for this single project. The new project folder
                (named after the project slug) is created inside it.
                Without this hint the picker can read as "pick the
                folder for this project" and users land in confusion.
              */}
              After you click <strong>Create</strong>, choose a workspace folder where PlotToon will
              store all your webtoon projects. Your new project folder will be created inside it.
            </div>
          )}
          <label className="dialog__field">
            <span className="dialog__label">Project name</span>
            <input
              ref={inputRef}
              type="text"
              className="dialog__input"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (validation) setValidation(null)
              }}
              disabled={submitting}
              data-testid="new-project-name-input"
              aria-invalid={validation !== null}
              aria-describedby={validation ? 'new-project-name-error' : undefined}
            />
          </label>
          {validation && (
            <div
              id="new-project-name-error"
              className="dialog__validation"
              role="alert"
              data-testid="new-project-validation"
            >
              {validation}
            </div>
          )}
          {submitError && (
            <div
              className="dialog__submit-error"
              role="alert"
              data-testid="new-project-submit-error"
            >
              {submitError}
            </div>
          )}
          <div className="dialog__actions">
            <button
              type="button"
              className="dialog__btn dialog__btn--secondary"
              onClick={onCancel}
              disabled={submitting}
              data-testid="new-project-cancel"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={submitting}
              data-testid="new-project-submit"
            >
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
