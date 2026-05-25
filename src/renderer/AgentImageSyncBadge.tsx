import type { AgentImageSyncSnapshot } from './agentImageSync'

interface Props {
  snapshot: AgentImageSyncSnapshot
  onRetry: () => void
  onDismiss: () => void
}

/**
 * #278: status surface for the most recent agent-image sync run.
 * Shown when the latest run produced at least one adopted revision OR
 * at least one rejected file. Dismissed state is controlled by the
 * parent (Workspace) so the badge stays hidden until the next sync
 * produces a new snapshot.
 */
export function AgentImageSyncBadge({ snapshot, onRetry, onDismiss }: Props): JSX.Element | null {
  if (snapshot.adopted.length === 0 && snapshot.rejected.length === 0) return null
  return (
    <div
      className="workspace__sync-badge"
      data-testid="agent-image-sync-badge"
      role="status"
      aria-live="polite"
      style={{
        padding: 'var(--space-2) var(--space-3)',
        background: 'var(--color-surface-raised)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
        margin: 'var(--space-2) var(--space-3)'
      }}
    >
      {snapshot.adopted.length > 0 && (
        <div data-testid="agent-image-sync-adopted">
          {`Synced ${snapshot.adopted.length} agent image${snapshot.adopted.length === 1 ? '' : 's'}: `}
          {snapshot.adopted
            .map((a) => `${a.cutId} v${String(a.version).padStart(3, '0')}`)
            .join(', ')}
        </div>
      )}
      {snapshot.rejected.length > 0 && (
        <div data-testid="agent-image-sync-rejected" style={{ color: 'var(--color-warn)' }}>
          {`Rejected ${snapshot.rejected.length} file${snapshot.rejected.length === 1 ? '' : 's'}: `}
          {snapshot.rejected.map((r) => `${r.filename} (${r.reason})`).join('; ')}
        </div>
      )}
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button
          type="button"
          data-testid="agent-image-sync-retry"
          onClick={onRetry}
          style={{ all: 'unset', cursor: 'pointer', textDecoration: 'underline', fontSize: 11 }}
        >
          Retry
        </button>
        <button
          type="button"
          data-testid="agent-image-sync-dismiss"
          onClick={onDismiss}
          style={{ all: 'unset', cursor: 'pointer', textDecoration: 'underline', fontSize: 11 }}
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
