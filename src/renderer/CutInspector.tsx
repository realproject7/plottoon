import type { Cut } from './CutList'
import { canTransition, isProtected, isImageProtected } from './cutMutations'
import type { CutStatus } from './cutMutations'

const STATUS_OPTIONS: CutStatus[] = ['planned', 'draft', 'needs_revision', 'approved']

interface CutInspectorProps {
  cut: Cut | null
  onStatusChange?: (cutId: string, status: CutStatus) => void
  onImportCleanImage?: (cutId: string) => void
  onSetCurrentRevision?: (cutId: string, version: number) => void
}

export function CutInspector({
  cut,
  onStatusChange,
  onImportCleanImage,
  onSetCurrentRevision
}: CutInspectorProps): JSX.Element {
  if (!cut) {
    return (
      <div
        style={{
          padding: 'var(--space-4)',
          color: 'var(--color-text-muted)',
          fontSize: 13
        }}
      >
        Select a cut to inspect
      </div>
    )
  }

  return (
    <div style={{ padding: 'var(--space-3)', overflow: 'auto', height: '100%' }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 'var(--font-weight-semibold)' as never,
          color: 'var(--color-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          marginBottom: 'var(--space-3)'
        }}
      >
        Inspector
      </div>

      <Field label="Cut ID" value={cut.id} />

      <div style={{ marginBottom: 'var(--space-2)' }}>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 1 }}>
          Status
        </div>
        {isProtected(cut) ? (
          <div
            data-testid="status-protected"
            style={{ fontSize: 12, fontWeight: 'var(--font-weight-medium)' as never }}
          >
            {cut.status} (protected)
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {STATUS_OPTIONS.map((s) => {
              const current = cut.status ?? 'planned'
              const active = current === s
              const allowed = active || canTransition(current, s)
              return (
                <button
                  key={s}
                  type="button"
                  data-testid={`status-btn-${s}`}
                  disabled={!allowed}
                  onClick={() => {
                    if (!active && allowed) onStatusChange?.(cut.id, s)
                  }}
                  style={{
                    all: 'unset',
                    cursor: allowed ? 'pointer' : 'default',
                    fontSize: 10,
                    padding: '2px 6px',
                    borderRadius: 'var(--radius-sm)',
                    background: active ? 'var(--color-surface-raised)' : 'transparent',
                    border: `1px solid ${active ? 'var(--color-border)' : 'transparent'}`,
                    opacity: allowed ? 1 : 0.35,
                    textTransform: 'uppercase',
                    letterSpacing: '0.03em'
                  }}
                >
                  {s.replace('_', ' ')}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <Field label="Direction" value={cut.direction} />
      <Field label="Dialogue" value={cut.dialogue} />
      <Field label="Narration" value={cut.narration} />
      <Field label="Continuity Notes" value={cut.continuityNotes} />

      {cut.imageState && (
        <>
          <div
            style={{
              fontSize: 11,
              fontWeight: 'var(--font-weight-semibold)' as never,
              color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              marginTop: 'var(--space-4)',
              marginBottom: 'var(--space-2)',
              borderTop: '1px solid var(--color-border)',
              paddingTop: 'var(--space-3)'
            }}
          >
            Image State
          </div>
          <Field label="Status" value={cut.imageState.status} />
          <Field label="Path" value={cut.imageState.path} mono />
          <Field label="Backend" value={cut.imageState.generationBackend} />
          <Field label="Model" value={cut.imageState.model} />
          <Field label="Prompt" value={cut.imageState.prompt} />
          <Field
            label="Attempts"
            value={cut.imageState.attempts != null ? String(cut.imageState.attempts) : undefined}
          />
          <Field label="Revision Notes" value={cut.imageState.revisionNotes} />
          {onImportCleanImage && !isImageProtected(cut) && (
            <button
              type="button"
              data-testid="import-clean-btn"
              onClick={() => onImportCleanImage(cut.id)}
              style={{
                all: 'unset',
                cursor: 'pointer',
                display: 'block',
                fontSize: 11,
                padding: '4px 8px',
                marginTop: 'var(--space-2)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--color-surface-raised)',
                border: '1px solid var(--color-border)',
                textAlign: 'center',
                width: '100%',
                boxSizing: 'border-box'
              }}
            >
              Import clean image
            </button>
          )}
        </>
      )}

      {cut.imageState?.revisions && cut.imageState.revisions.length > 0 && (
        <>
          <div
            style={{
              fontSize: 11,
              fontWeight: 'var(--font-weight-semibold)' as never,
              color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              marginTop: 'var(--space-4)',
              marginBottom: 'var(--space-2)',
              borderTop: '1px solid var(--color-border)',
              paddingTop: 'var(--space-3)'
            }}
          >
            Revisions
          </div>
          {cut.imageState.revisions.map((rev) => {
            const isCurrent = cut.imageState?.path === rev.path
            const cutProtected = isImageProtected(cut)
            return (
              <div
                key={rev.version}
                data-testid={`revision-${rev.version}`}
                style={{
                  marginBottom: 'var(--space-2)',
                  padding: 'var(--space-1) var(--space-2)',
                  borderRadius: 'var(--radius-sm)',
                  background: isCurrent ? 'var(--color-surface-raised)' : 'transparent',
                  border: isCurrent ? '1px solid var(--color-border)' : '1px solid transparent'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                  <span style={{ fontWeight: 'var(--font-weight-medium)' as never }}>
                    v{rev.version}
                    {isCurrent ? ' (current)' : ''}
                  </span>
                  {!isCurrent && onSetCurrentRevision && !cutProtected && (
                    <button
                      type="button"
                      data-testid={`set-current-${rev.version}`}
                      onClick={() => onSetCurrentRevision(cut.id, rev.version)}
                      style={{
                        all: 'unset',
                        cursor: 'pointer',
                        fontSize: 10,
                        color: 'var(--color-text-muted)',
                        textDecoration: 'underline'
                      }}
                    >
                      Set as current
                    </button>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    fontFamily: 'var(--font-mono, monospace)',
                    color: 'var(--color-text-muted)',
                    wordBreak: 'break-all'
                  }}
                >
                  {rev.path}
                </div>
                {rev.revisionNotes && (
                  <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>
                    {rev.revisionNotes}
                  </div>
                )}
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

function Field({
  label,
  value,
  mono
}: {
  label: string
  value?: string
  mono?: boolean
}): JSX.Element | null {
  if (!value) return null

  return (
    <div style={{ marginBottom: 'var(--space-2)' }}>
      <div
        style={{
          fontSize: 11,
          color: 'var(--color-text-muted)',
          marginBottom: 1
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 12,
          fontFamily: mono ? 'var(--font-mono, monospace)' : undefined,
          wordBreak: 'break-word'
        }}
      >
        {value}
      </div>
    </div>
  )
}
