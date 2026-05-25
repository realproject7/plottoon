// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { WorkflowGuide } from '../WorkflowGuide'
import type { WorkflowState } from '../workflowState'

afterEach(cleanup)

function state(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    step: 'plan',
    title: 'Test title',
    hint: 'Test hint',
    cta: 'agent',
    ...overrides
  }
}

describe('#279 WorkflowGuide', () => {
  it('renders the step title + hint copy', () => {
    render(
      <WorkflowGuide state={state({ title: 'Start a plot', hint: 'Ask the agent to plan' })} />
    )
    expect(screen.getByTestId('workflow-guide-step').textContent).toBe('Start a plot')
    expect(screen.getByTestId('workflow-guide-hint').textContent).toBe('Ask the agent to plan')
  })

  it('mirrors the CTA target as a data attribute so panels can highlight', () => {
    render(<WorkflowGuide state={state({ cta: 'inspector' })} />)
    const root = screen.getByTestId('workflow-guide')
    expect(root.getAttribute('data-cta')).toBe('inspector')
  })

  it('mirrors the step id so layouts can swap styling per-step', () => {
    render(<WorkflowGuide state={state({ step: 'export-ready', cta: 'export' })} />)
    expect(screen.getByTestId('workflow-guide').getAttribute('data-step')).toBe('export-ready')
  })

  it('emits role=status + aria-live so screen readers announce step changes', () => {
    render(<WorkflowGuide state={state()} />)
    const root = screen.getByTestId('workflow-guide')
    expect(root.getAttribute('role')).toBe('status')
    expect(root.getAttribute('aria-live')).toBe('polite')
  })

  it('renders the cta=none variant without crashing when no surface is highlighted', () => {
    render(<WorkflowGuide state={state({ cta: null })} />)
    expect(screen.getByTestId('workflow-guide').getAttribute('data-cta')).toBe('none')
  })
})
