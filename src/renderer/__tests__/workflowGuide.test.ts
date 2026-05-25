// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { allCutsApproved, deriveWorkflowState } from '../workflowGuide'
import type { Cut } from '../CutList'

function cut(id: string, overrides: Partial<Cut> = {}): Cut {
  return {
    id,
    status: 'draft',
    imageState: { status: 'pending', revisions: [] },
    overlays: [],
    ...overrides
  } as Cut
}

function approvedCut(id: string): Cut {
  return cut(id, {
    status: 'approved',
    imageState: {
      status: 'done',
      path: `plots/p/assets/${id}/clean-v001.webp`,
      revisions: [{ version: 1, path: `plots/p/assets/${id}/clean-v001.webp`, createdAt: 't' }]
    },
    overlays: [{ id: 'o1', type: 'dialogue', content: 'hi', x: 0, y: 0, width: 100, height: 30 }]
  })
}

describe('#279 deriveWorkflowState — outer-most missing state wins', () => {
  it('returns "plan" when no plot exists yet', () => {
    const state = deriveWorkflowState({
      hasAnyPlot: false,
      cuts: [],
      activeCut: null,
      allCutsApproved: false
    })
    expect(state.step).toBe('plan')
    expect(state.cta).toBe('agent')
    expect(state.hint).toMatch(/agent/i)
  })

  it('returns "generate-cuts" when a plot exists but cuts.json is empty', () => {
    const state = deriveWorkflowState({
      hasAnyPlot: true,
      cuts: [],
      activeCut: null,
      allCutsApproved: false
    })
    expect(state.step).toBe('generate-cuts')
    expect(state.cta).toBe('agent')
  })

  it('returns "select-cut" when cuts exist but none is active', () => {
    const cuts = [cut('cut-001')]
    const state = deriveWorkflowState({
      hasAnyPlot: true,
      cuts,
      activeCut: null,
      allCutsApproved: false
    })
    expect(state.step).toBe('select-cut')
    expect(state.cta).toBeNull()
  })
})

describe('#279 deriveWorkflowState — per-cut detail states', () => {
  it('returns "generate-image" when the active cut has no clean image yet', () => {
    const c = cut('cut-001', { imageState: { status: 'pending', revisions: [] } })
    const state = deriveWorkflowState({
      hasAnyPlot: true,
      cuts: [c],
      activeCut: c,
      allCutsApproved: false
    })
    expect(state.step).toBe('generate-image')
    expect(state.cta).toBe('agent')
  })

  it('returns "letter" when the active cut has an image but no overlays', () => {
    const c = cut('cut-001', {
      imageState: {
        status: 'done',
        path: 'plots/p/assets/cut-001/clean-v001.webp',
        revisions: []
      },
      overlays: []
    })
    const state = deriveWorkflowState({
      hasAnyPlot: true,
      cuts: [c],
      activeCut: c,
      allCutsApproved: false
    })
    expect(state.step).toBe('letter')
    expect(state.cta).toBe('inspector')
  })

  it('returns "approve" when the active cut has an image + overlays but status is draft', () => {
    const c = cut('cut-001', {
      status: 'draft',
      imageState: {
        status: 'done',
        path: 'plots/p/assets/cut-001/clean-v001.webp',
        revisions: []
      },
      overlays: [{ id: 'o1', type: 'dialogue', content: 'hi', x: 0, y: 0, width: 100, height: 30 }]
    })
    const state = deriveWorkflowState({
      hasAnyPlot: true,
      cuts: [c],
      activeCut: c,
      allCutsApproved: false
    })
    expect(state.step).toBe('approve')
    expect(state.cta).toBe('inspector')
  })

  it('returns "export-ready" when every cut is approved and the active cut is one of them', () => {
    const cuts = [approvedCut('cut-001'), approvedCut('cut-002')]
    const state = deriveWorkflowState({
      hasAnyPlot: true,
      cuts,
      activeCut: cuts[0],
      allCutsApproved: true
    })
    expect(state.step).toBe('export-ready')
    expect(state.cta).toBe('export')
    expect(state.hint).toMatch(/export/i)
  })

  it('points the user at the next cut when the active cut is approved but others are not', () => {
    const approved = approvedCut('cut-001')
    const pending = cut('cut-002')
    const state = deriveWorkflowState({
      hasAnyPlot: true,
      cuts: [approved, pending],
      activeCut: approved,
      allCutsApproved: false
    })
    expect(state.step).toBe('approve')
    expect(state.cta).toBeNull()
    expect(state.hint).toMatch(/next/i)
  })
})

describe('#279 allCutsApproved', () => {
  it('returns false for an empty array', () => {
    expect(allCutsApproved([])).toBe(false)
  })

  it('returns true only when every cut has an approved-family status', () => {
    expect(allCutsApproved([approvedCut('cut-001'), approvedCut('cut-002')])).toBe(true)
    expect(allCutsApproved([approvedCut('cut-001'), cut('cut-002')])).toBe(false)
  })

  it('treats exported/uploaded/published as approved (post-approval lifecycle)', () => {
    const exp = cut('cut-001', {
      status: 'exported',
      imageState: {
        status: 'done',
        path: 'plots/p/assets/cut-001/clean-v001.webp',
        revisions: []
      },
      overlays: [{ id: 'o1', type: 'dialogue', content: 'x', x: 0, y: 0, width: 1, height: 1 }]
    })
    expect(allCutsApproved([exp])).toBe(true)
  })
})

describe('#279 deriveWorkflowState — never returns a multi-action hint', () => {
  it('exactly one step + one CTA across all branches (no bag of competing instructions)', () => {
    const all = [
      deriveWorkflowState({ hasAnyPlot: false, cuts: [], activeCut: null }),
      deriveWorkflowState({ hasAnyPlot: true, cuts: [], activeCut: null }),
      deriveWorkflowState({ hasAnyPlot: true, cuts: [cut('a')], activeCut: null }),
      deriveWorkflowState({
        hasAnyPlot: true,
        cuts: [cut('a')],
        activeCut: cut('a')
      }),
      deriveWorkflowState({
        hasAnyPlot: true,
        cuts: [approvedCut('a')],
        activeCut: approvedCut('a'),
        allCutsApproved: true
      })
    ]
    for (const s of all) {
      expect(typeof s.step).toBe('string')
      expect(typeof s.title).toBe('string')
      expect(typeof s.hint).toBe('string')
      expect(s.title.length).toBeGreaterThan(0)
      expect(s.hint.length).toBeGreaterThan(0)
    }
  })
})
