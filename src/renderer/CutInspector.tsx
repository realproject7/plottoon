import type { Cut } from './CutList'

interface CutInspectorProps {
  cut: Cut | null
}

export function CutInspector({ cut }: CutInspectorProps): JSX.Element {
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
          <Field label="Backend" value={cut.imageState.backend} />
          <Field label="Model" value={cut.imageState.model} />
          <Field label="Prompt" value={cut.imageState.prompt} />
          <Field
            label="Attempts"
            value={cut.imageState.attempts != null ? String(cut.imageState.attempts) : undefined}
          />
          <Field label="Revision Notes" value={cut.imageState.revisionNotes} />
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
