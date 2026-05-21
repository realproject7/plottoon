import type { Cut } from './CutList'
import { canTransition, isProtected, isImageProtected } from './cutMutations'
import type { CutStatus } from './cutMutations'
import { PRESET_NAMES, getPresetLabel } from './overlayPresets'
import type { PresetName } from './overlayPresets'
import { checkExportBlockers } from './exportChecks'
import { validatePublishReadiness } from './publishReadiness'

const STATUS_OPTIONS: CutStatus[] = ['planned', 'draft', 'needs_revision', 'approved']

const inspectorBtnStyle: React.CSSProperties = {
  all: 'unset',
  cursor: 'pointer',
  display: 'block',
  fontSize: 11,
  padding: '4px 8px',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-surface-raised)',
  border: '1px solid var(--color-border)',
  textAlign: 'center',
  width: '100%',
  boxSizing: 'border-box'
}

interface CutInspectorProps {
  cut: Cut | null
  onStatusChange?: (cutId: string, status: CutStatus) => void
  onImportCleanImage?: (cutId: string) => void
  onSetCurrentRevision?: (cutId: string, version: number) => void
  selectedOverlayId?: string | null
  onAddOverlay?: (cutId: string, presetName: PresetName) => void
  onDeleteOverlay?: (cutId: string, overlayId: string) => void
  onDuplicateOverlay?: (cutId: string, overlayId: string) => void
  onReorderOverlay?: (cutId: string, overlayId: string, direction: 'up' | 'down') => void
  onResizeOverlay?: (cutId: string, overlayId: string, width: number, height: number) => void
  onSetTailAnchor?: (cutId: string, overlayId: string, x: number, y: number) => void
  onRemoveTailAnchor?: (cutId: string, overlayId: string) => void
  exportMetas?: Array<{ cutId: string; byteSize: number; [key: string]: unknown }>
}

export function CutInspector({
  cut,
  onStatusChange,
  onImportCleanImage,
  onSetCurrentRevision,
  selectedOverlayId,
  onAddOverlay,
  onDeleteOverlay,
  onDuplicateOverlay,
  onReorderOverlay,
  onResizeOverlay,
  onSetTailAnchor,
  onRemoveTailAnchor,
  exportMetas
}: CutInspectorProps): JSX.Element {
  if (!cut) {
    return <div className="inspector__empty">Select a cut to inspect</div>
  }

  return (
    <div className="inspector">
      <div className="inspector__section-label">Inspector</div>

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

      {selectedOverlayId &&
        cut.overlays &&
        (() => {
          const overlay = cut.overlays.find((o) => o.id === selectedOverlayId)
          if (!overlay) return null
          return (
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
                Selected Overlay
              </div>
              <Field label="ID" value={overlay.id} mono />
              <Field label="Type" value={overlay.type} />
              <Field label="Content" value={overlay.content} />
              <Field label="X" value={String(overlay.x)} mono />
              <Field label="Y" value={String(overlay.y)} mono />
              {onResizeOverlay ? (
                <div style={{ display: 'flex', gap: 4, marginBottom: 'var(--space-2)' }}>
                  <NumberInput
                    label="W"
                    testId="overlay-width"
                    value={overlay.width}
                    onChange={(v) => onResizeOverlay(cut.id, overlay.id, v, overlay.height)}
                  />
                  <NumberInput
                    label="H"
                    testId="overlay-height"
                    value={overlay.height}
                    onChange={(v) => onResizeOverlay(cut.id, overlay.id, overlay.width, v)}
                  />
                </div>
              ) : (
                <>
                  <Field label="Width" value={String(overlay.width)} mono />
                  <Field label="Height" value={String(overlay.height)} mono />
                </>
              )}
              {overlay.tailAnchor && (
                <div style={{ display: 'flex', gap: 4, marginBottom: 'var(--space-2)' }}>
                  {onSetTailAnchor ? (
                    <>
                      <NumberInput
                        label="Tail X"
                        testId="tail-x"
                        value={overlay.tailAnchor.x}
                        onChange={(v) =>
                          onSetTailAnchor(cut.id, overlay.id, v, overlay.tailAnchor!.y)
                        }
                      />
                      <NumberInput
                        label="Tail Y"
                        testId="tail-y"
                        value={overlay.tailAnchor.y}
                        onChange={(v) =>
                          onSetTailAnchor(cut.id, overlay.id, overlay.tailAnchor!.x, v)
                        }
                      />
                    </>
                  ) : (
                    <>
                      <Field label="Tail X" value={String(overlay.tailAnchor.x)} mono />
                      <Field label="Tail Y" value={String(overlay.tailAnchor.y)} mono />
                    </>
                  )}
                </div>
              )}
              {onRemoveTailAnchor && overlay.tailAnchor && (
                <button
                  type="button"
                  data-testid="remove-tail-btn"
                  onClick={() => onRemoveTailAnchor(cut.id, overlay.id)}
                  style={{ ...inspectorBtnStyle, marginBottom: 4 }}
                >
                  Remove tail anchor
                </button>
              )}
              {onSetTailAnchor && !overlay.tailAnchor && (
                <button
                  type="button"
                  data-testid="add-tail-btn"
                  onClick={() =>
                    onSetTailAnchor(
                      cut.id,
                      overlay.id,
                      overlay.x + overlay.width / 2,
                      overlay.y + overlay.height + 20
                    )
                  }
                  style={inspectorBtnStyle}
                >
                  Add tail anchor
                </button>
              )}
              <div
                style={{
                  display: 'flex',
                  gap: 4,
                  marginTop: 'var(--space-2)'
                }}
              >
                {onDuplicateOverlay && (
                  <button
                    type="button"
                    data-testid="duplicate-overlay-btn"
                    onClick={() => onDuplicateOverlay(cut.id, overlay.id)}
                    style={{ ...inspectorBtnStyle, flex: 1 }}
                  >
                    Duplicate
                  </button>
                )}
                {onReorderOverlay && (
                  <>
                    <button
                      type="button"
                      data-testid="overlay-z-up"
                      onClick={() => onReorderOverlay(cut.id, overlay.id, 'up')}
                      title="Bring forward"
                      style={{ ...inspectorBtnStyle, flex: 0, width: 28 }}
                    >
                      &#x2191;
                    </button>
                    <button
                      type="button"
                      data-testid="overlay-z-down"
                      onClick={() => onReorderOverlay(cut.id, overlay.id, 'down')}
                      title="Send backward"
                      style={{ ...inspectorBtnStyle, flex: 0, width: 28 }}
                    >
                      &#x2193;
                    </button>
                  </>
                )}
              </div>
              {onDeleteOverlay && (
                <button
                  type="button"
                  data-testid="delete-overlay-btn"
                  onClick={() => onDeleteOverlay(cut.id, overlay.id)}
                  style={{
                    ...inspectorBtnStyle,
                    color: 'var(--color-error, #e53e3e)',
                    marginTop: 4
                  }}
                >
                  Delete overlay
                </button>
              )}
            </>
          )
        })()}

      {onAddOverlay && (
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
            Add Overlay
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {PRESET_NAMES.map((name) => (
              <button
                key={name}
                type="button"
                data-testid={`add-overlay-${name}`}
                onClick={() => onAddOverlay(cut.id, name)}
                style={{
                  all: 'unset',
                  cursor: 'pointer',
                  fontSize: 11,
                  padding: '4px 8px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-surface-raised)',
                  border: '1px solid var(--color-border)',
                  textAlign: 'center'
                }}
              >
                {getPresetLabel(name)}
              </button>
            ))}
          </div>
        </>
      )}

      {(() => {
        const blockers = checkExportBlockers(cut.overlays ?? [])
        if (blockers.length === 0) return null
        return (
          <div
            data-testid="export-blockers"
            style={{
              marginTop: 'var(--space-4)',
              padding: 'var(--space-2) var(--space-3)',
              borderTop: '1px solid var(--color-border)',
              background: 'var(--color-surface-raised)',
              borderRadius: 'var(--radius-sm)'
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 'var(--font-weight-semibold)' as never,
                color: 'var(--color-error, #e53e3e)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                marginBottom: 4
              }}
            >
              Export blocked
            </div>
            {blockers.map((b) => (
              <div key={b.type} style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                {b.message}
              </div>
            ))}
          </div>
        )
      })()}

      {(() => {
        const report = validatePublishReadiness(
          [cut],
          (exportMetas ?? []) as import('./exportMetadata').ExportMeta[]
        )
        const nonPass = report.checks.filter((c) => c.level !== 'pass')
        if (nonPass.length === 0) {
          return (
            <div
              data-testid="publish-ready"
              style={{
                marginTop: 'var(--space-4)',
                padding: 'var(--space-2) var(--space-3)',
                borderTop: '1px solid var(--color-border)',
                fontSize: 11,
                color: 'var(--color-text-muted)'
              }}
            >
              Publish ready
            </div>
          )
        }
        return (
          <div
            data-testid="publish-readiness"
            style={{
              marginTop: 'var(--space-4)',
              padding: 'var(--space-2) var(--space-3)',
              borderTop: '1px solid var(--color-border)'
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 'var(--font-weight-semibold)' as never,
                color: report.ready ? 'var(--color-text-muted)' : 'var(--color-error, #e53e3e)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                marginBottom: 4
              }}
            >
              {report.ready ? 'Publish ready (with warnings)' : 'Not ready to publish'}
            </div>
            {nonPass.map((c) => (
              <div
                key={c.id}
                data-testid={`readiness-${c.id}`}
                style={{
                  fontSize: 11,
                  color:
                    c.level === 'block' ? 'var(--color-error, #e53e3e)' : 'var(--color-text-muted)',
                  marginBottom: 2
                }}
              >
                {c.level === 'block' ? '[BLOCK]' : '[WARN]'} {c.label}: {c.message}
              </div>
            ))}
          </div>
        )
      })()}
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

function NumberInput({
  label,
  testId,
  value,
  onChange
}: {
  label: string
  testId: string
  value: number
  onChange: (v: number) => void
}): JSX.Element {
  return (
    <label style={{ flex: 1 }}>
      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 1 }}>{label}</div>
      <input
        data-testid={testId}
        type="number"
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(v)
        }}
        style={{
          width: '100%',
          fontSize: 11,
          fontFamily: 'var(--font-mono, monospace)',
          padding: '2px 4px',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--color-surface)',
          color: 'inherit',
          boxSizing: 'border-box'
        }}
      />
    </label>
  )
}
