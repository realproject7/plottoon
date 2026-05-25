// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import FDBFactory from 'fake-indexeddb/lib/FDBFactory'
import { Workspace } from '../Workspace'
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

function imageReadyCut(id: string): Cut {
  return cut(id, {
    imageState: {
      status: 'done',
      path: `plots/episode-1/assets/${id}/clean-v001.webp`,
      revisions: [
        {
          version: 1,
          path: `plots/episode-1/assets/${id}/clean-v001.webp`,
          createdAt: 't'
        }
      ]
    },
    overlays: [{ id: 'o1', type: 'dialogue', content: 'hi', x: 0, y: 0, width: 100, height: 30 }]
  })
}

function installApi(cuts: Cut[]): {
  writeProjectFile: ReturnType<typeof vi.fn>
} {
  const writeProjectFile = vi.fn().mockResolvedValue(undefined)
  ;(window as unknown as { plottoon: unknown }).plottoon = {
    fs: {
      listProjectDir: vi.fn().mockResolvedValue(['episode-1']),
      projectFileExists: vi.fn().mockResolvedValue(true),
      readProjectFile: vi.fn().mockResolvedValue(
        JSON.stringify({
          version: 1,
          plotTitle: 'episode-1',
          synopsis: '',
          cuts,
          publishState: { published: false, exportedAt: null, format: null }
        })
      ),
      writeProjectFile,
      regeneratePlotText: vi.fn().mockResolvedValue(undefined),
      resolveProjectFilePath: vi.fn().mockResolvedValue('/mock'),
      syncAgentImagesForPlot: vi.fn().mockResolvedValue({ adopted: [], rejected: [] })
    },
    terminal: {
      create: vi.fn(),
      getSession: vi.fn(),
      findByProject: vi.fn().mockResolvedValue(null),
      connect: vi.fn(),
      write: vi.fn(),
      disconnect: vi.fn(),
      restart: vi.fn(),
      destroy: vi.fn(),
      onData: vi.fn(() => () => {}),
      onExit: vi.fn(() => () => {})
    },
    wallet: {
      getActiveIdentity: vi.fn(async () => null)
    }
  }
  return { writeProjectFile }
}

beforeEach(() => {
  ;(window as unknown as { plottoon: unknown }).plottoon = {}
  ;(globalThis as { indexedDB: IDBFactory }).indexedDB = new FDBFactory() as unknown as IDBFactory
})

afterEach(cleanup)

describe('#279 RE1 — WorkflowGuide reflects mutations across every panel', () => {
  it('approving the last unapproved cut flips the guide to "export-ready" (not "move to next")', async () => {
    // Single cut, already has an image and overlay so it's stuck on
    // the approve step. Approving it via the inspector should flip
    // the guide to export-ready — pre-RE1 this regression failed
    // because handleStatusChange updated cutsRef but skipped
    // cutsOverride, so the guide saw the old draft cut.
    const draft = imageReadyCut('cut-001')
    installApi([draft])
    render(<Workspace projectId="proj_1" />)

    // Wait for the initial guide to render. The active cut starts as
    // the first cut (CutList auto-selects), with image + overlay but
    // status=draft, so the guide shows "Approve when ready".
    // We compare by data-step (the canonical state) rather than the
    // copy so a benign copy change can't accidentally pass via a
    // substring match.
    await waitFor(() => {
      expect(screen.getByTestId('workflow-guide').getAttribute('data-step')).toBe('approve')
    })

    // Find the "Approved" status button in the inspector and click it.
    // CutInspector renders status as a set of buttons with test ids
    // `status-btn-<status>`; clicking fires onStatusChange which
    // routes through Workspace's handleStatusChange → commitCuts.
    fireEvent.click(screen.getByTestId('status-btn-approved'))

    // The guide should now show export-ready — proves the status
    // change flowed through commitCuts into cutsOverride (which
    // drives the guide's allCutsApproved input). Pre-RE1 this was
    // the bug: cutsOverride was stale so allCutsApproved saw the old
    // draft cut, leaving the guide on the approve step.
    await waitFor(() => {
      expect(screen.getByTestId('workflow-guide').getAttribute('data-step')).toBe('export-ready')
    })
    // CTA target is the export panel.
    expect(screen.getByTestId('workflow-guide').getAttribute('data-cta')).toBe('export')
  })

  it('the workspace wrapper data-guide-cta mirrors the guide so CSS can highlight the panel', async () => {
    // Multiple cuts so the guide stays in "approve" land after the
    // first approval — confirms the wrapper attribute always reflects
    // the LIVE workflow state, not a stale snapshot.
    const c1 = imageReadyCut('cut-001')
    const c2 = imageReadyCut('cut-002')
    installApi([c1, c2])
    const { container } = render(<Workspace projectId="proj_1" />)

    // Initial state: active cut is the first draft cut, guide is on
    // the approve step.
    await waitFor(() => {
      expect(screen.getByTestId('workflow-guide').getAttribute('data-step')).toBe('approve')
    })
    const workspaceEl = container.querySelector('.workspace') as HTMLElement
    expect(workspaceEl.getAttribute('data-guide-cta')).toBe('inspector')

    // Approve the first cut via the inspector button; the second is
    // still unapproved so the guide stays on the approve step but the
    // cta drops to null (no specific surface — the user reaches for
    // the cut list to pick the next cut).
    fireEvent.click(screen.getByTestId('status-btn-approved'))

    await waitFor(() => {
      expect(workspaceEl.getAttribute('data-guide-cta')).toBe('none')
    })
    // Step is still "approve" but the hint now points at the next cut.
    expect(screen.getByTestId('workflow-guide').getAttribute('data-step')).toBe('approve')
    expect(screen.getByTestId('workflow-guide-hint').textContent).toMatch(/next/i)
  })
})
