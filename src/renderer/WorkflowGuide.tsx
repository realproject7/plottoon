import type { WorkflowState } from './workflowGuide'

interface Props {
  state: WorkflowState
}

/**
 * #279: thin one-line workflow guide above the Workspace panels.
 *
 * Mirrors plotlink-ows's "what to do next" cue without falling into
 * card-heavy or marketing UI. The CTA target is exposed via
 * `data-cta` so the renderer (or a future highlight effect) can wire
 * a visual ring around the relevant panel. We deliberately don't
 * render a button — the user reaches for the panel itself, which
 * keeps the guide passive rather than steering the click target.
 */
export function WorkflowGuide({ state }: Props): JSX.Element {
  return (
    <div
      className="workspace__guide"
      data-testid="workflow-guide"
      data-step={state.step}
      data-cta={state.cta ?? 'none'}
      role="status"
      aria-live="polite"
    >
      <span className="workspace__guide-step" data-testid="workflow-guide-step">
        {state.title}
      </span>
      <span className="workspace__guide-hint" data-testid="workflow-guide-hint">
        {state.hint}
      </span>
    </div>
  )
}
