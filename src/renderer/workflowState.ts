/**
 * #279: derive the next-action hint for the integrated Workspace.
 *
 * The Workspace surfaces the PlotToon loop (plan → generate → letter
 * → approve → export) so users don't have to read docs to understand
 * what comes next. This module is the pure decision function — given
 * the current cuts and selected cut, return a step + copy + optional
 * call-to-action target panel.
 *
 * Keeping the logic pure makes the loop testable independent of the
 * full Workspace render tree.
 */

import type { Cut } from './CutList'

/**
 * Loop steps in order. The first step that applies wins — once cuts
 * exist we move past "plan", once the active cut has an image we move
 * past "generate-image", etc. `export-ready` is the terminal state.
 */
export type WorkflowStep =
  | 'plan'
  | 'generate-cuts'
  | 'select-cut'
  | 'generate-image'
  | 'letter'
  | 'approve'
  | 'export-ready'

export interface WorkflowState {
  step: WorkflowStep
  /** Short headline shown in the guide. */
  title: string
  /** One-sentence next action the user should take. */
  hint: string
  /**
   * Optional pointer at the panel/control the user should reach for
   * next — used by the renderer to highlight the relevant panel.
   * 'agent' = the terminal; 'editor' = canvas; 'inspector' = side
   * panel; null = no specific surface.
   */
  cta: 'agent' | 'editor' | 'inspector' | 'export' | null
}

interface DeriveInput {
  hasAnyPlot: boolean
  cuts: readonly Cut[]
  activeCut: Cut | null
  /** From the export-readiness check; if all cuts are approved, the export panel becomes the CTA. */
  allCutsApproved?: boolean
}

const APPROVED_STATUSES = new Set(['approved', 'exported', 'uploaded', 'published'])

function hasImage(cut: Cut): boolean {
  return cut.imageState?.status === 'done' && !!cut.imageState?.path
}

function hasOverlays(cut: Cut): boolean {
  return Array.isArray(cut.overlays) && cut.overlays.length > 0
}

function isApproved(cut: Cut): boolean {
  return APPROVED_STATUSES.has(cut.status ?? '')
}

/**
 * Derive the next-action hint. The branches are ordered from the
 * outer-most missing state (no plots) inward to the per-cut detail
 * states. This lets the renderer always show *one* hint that's
 * actionable right now — never a bag of competing instructions.
 */
export function deriveWorkflowState(input: DeriveInput): WorkflowState {
  if (!input.hasAnyPlot) {
    return {
      step: 'plan',
      title: 'Start a plot with the agent',
      hint: 'Open the agent panel below and ask it to plan cuts for a new plot.',
      cta: 'agent'
    }
  }
  if (input.cuts.length === 0) {
    return {
      step: 'generate-cuts',
      title: 'No cuts yet',
      hint: 'Ask the agent to generate cuts for this plot, or add a cut manually from the toolbar.',
      cta: 'agent'
    }
  }
  if (!input.activeCut) {
    return {
      step: 'select-cut',
      title: 'Select a cut',
      hint: 'Pick a cut from the list to preview and edit it.',
      cta: null
    }
  }
  const cut = input.activeCut
  if (!hasImage(cut)) {
    return {
      step: 'generate-image',
      title: 'Clean image pending',
      hint: 'Ask the agent to generate a clean image for this cut, or import one manually from the inspector.',
      cta: 'agent'
    }
  }
  if (!hasOverlays(cut)) {
    return {
      step: 'letter',
      title: 'Add lettering',
      hint: 'Drop in dialogue, narration, or SFX overlays from the inspector to letter this cut.',
      cta: 'inspector'
    }
  }
  if (!isApproved(cut)) {
    return {
      step: 'approve',
      title: 'Approve when ready',
      hint: 'Set the cut status to approved in the inspector when the lettering looks right.',
      cta: 'inspector'
    }
  }
  if (input.allCutsApproved) {
    return {
      step: 'export-ready',
      title: 'Ready to export',
      hint: 'All cuts are approved. Open the export panel from the inspector to publish.',
      cta: 'export'
    }
  }
  // Active cut is approved but other cuts still need work — point the
  // user at the cut list to find the next one.
  return {
    step: 'approve',
    title: 'Move to the next cut',
    hint: 'This cut is approved. Pick the next unapproved cut from the list to continue.',
    cta: null
  }
}

/**
 * Convenience: derive `allCutsApproved` from a cuts array. Used by the
 * Workspace when calling `deriveWorkflowState` so the export-ready
 * branch is reachable.
 */
export function allCutsApproved(cuts: readonly Cut[]): boolean {
  if (cuts.length === 0) return false
  return cuts.every(isApproved)
}
