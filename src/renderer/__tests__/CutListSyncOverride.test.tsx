// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { useCallback, useState } from 'react'
import { CutList } from '../CutList'
import type { Cut } from '../CutList'

function makeCut(id: string, revisions: Array<{ version: number; path: string }> = []): Cut {
  return {
    id,
    status: 'draft',
    imageState: {
      status: 'pending',
      revisions: revisions.map((r) => ({ ...r, createdAt: 't' }))
    }
  } as Cut
}

const INITIAL_CUTS: Cut[] = [makeCut('cut-001'), makeCut('cut-002'), makeCut('cut-003')]

function installFsMocks(cuts: Cut[]): void {
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
      )
    }
  }
}

beforeEach(() => {
  installFsMocks(INITIAL_CUTS)
})

afterEach(cleanup)

describe('#278 RE1 — CutList cutsOverride preserves activeCutId and reflects synced revisions', () => {
  it('dispatches update-cuts (NOT cuts-loaded) so activeCutId stays on the user-selected cut', async () => {
    // Harness that flips cutsOverride mid-render — simulates Workspace's
    // sync merge running after the initial load.
    function Harness(): JSX.Element {
      const [activeCutId, setActiveCutId] = useState<string | null>(null)
      const [override, setOverride] = useState<Cut[] | undefined>(undefined)
      const onSelectCut = useCallback((cut: Cut | null): void => {
        setActiveCutId(cut?.id ?? null)
      }, [])
      return (
        <>
          <CutList
            projectId="proj_1"
            activeCutId={activeCutId}
            onSelectCut={onSelectCut}
            cutsOverride={override}
          />
          <button
            type="button"
            data-testid="simulate-sync"
            onClick={() => {
              // Sync merged a new revision into cut-002 — Workspace
              // produces a fresh array reference and passes it down.
              setOverride([
                makeCut('cut-001'),
                makeCut('cut-002', [
                  { version: 1, path: 'plots/episode-1/assets/cut-002/clean-v001.webp' }
                ]),
                makeCut('cut-003')
              ])
            }}
          >
            simulate-sync
          </button>
        </>
      )
    }

    render(<Harness />)
    // Wait for the initial cuts-loaded path to populate the list.
    await waitFor(() => {
      expect(screen.queryAllByTestId(/^status-cut-00/)).toHaveLength(3)
    })

    // User selects cut-003 (not the auto-selected first cut).
    fireEvent.click(screen.getByText('cut-003'))
    // Sync runs.
    fireEvent.click(screen.getByTestId('simulate-sync'))

    // After the override, the list still renders all 3 cuts AND
    // the active selection is still cut-003 (would be cut-001 if
    // cuts-loaded had fired instead).
    await waitFor(() => {
      expect(screen.getAllByText(/^cut-/).map((b) => b.textContent)).toContain('cut-003')
    })
    // Active row carries the `cut-list__row--active` class only when
    // it matches the activeCutId state held in Harness. We assert
    // that cut-003 is still the active button.
    const cut003Btn = screen
      .getAllByRole('button')
      .find((b) => b.textContent?.startsWith('cut-003'))
    expect(cut003Btn?.className).toMatch(/active/)
  })

  it('after sync, a CutList mutation saves the merged array (NOT the pre-sync stale state)', async () => {
    // This is the regression @re1 asked for: synced revision on
    // cut-002 must not be lost when the user adds a new cut after
    // sync. The pre-fix bug: CutList's internal state.cuts was stale,
    // so its `add cut` action constructed `next` from the stale array,
    // and `onCutsChanged(next)` saved over the synced revision.
    const onCutsChanged = vi.fn<(cuts: Cut[]) => void>()

    function Harness(): JSX.Element {
      const [override, setOverride] = useState<Cut[] | undefined>(undefined)
      const noopSelect = useCallback(() => {}, [])
      return (
        <>
          <CutList
            projectId="proj_1"
            activeCutId="cut-002"
            onSelectCut={noopSelect}
            onCutsChanged={onCutsChanged}
            cutsOverride={override}
          />
          <button
            type="button"
            data-testid="simulate-sync"
            onClick={() => {
              setOverride([
                makeCut('cut-001'),
                makeCut('cut-002', [
                  { version: 1, path: 'plots/episode-1/assets/cut-002/clean-v001.webp' }
                ]),
                makeCut('cut-003')
              ])
            }}
          >
            simulate-sync
          </button>
        </>
      )
    }

    render(<Harness />)
    await waitFor(() => {
      expect(screen.queryAllByTestId(/^status-cut-00/)).toHaveLength(3)
    })

    fireEvent.click(screen.getByTestId('simulate-sync'))
    // Wait for the override to land in CutList's reducer.
    await new Promise((resolve) => setTimeout(resolve, 20))

    // Reset onCutsChanged so we only inspect the post-sync mutation.
    onCutsChanged.mockClear()

    // User adds a new cut after sync. The "Add" button is the first
    // tool button — we can target the toolbar test id.
    const toolbar = screen.getByTestId('cut-toolbar')
    const addBtn = toolbar.querySelector('button[title="Add cut"]')
    expect(addBtn).toBeTruthy()
    fireEvent.click(addBtn!)

    expect(onCutsChanged).toHaveBeenCalledTimes(1)
    const saved = onCutsChanged.mock.calls[0][0]
    // The save must include the synced revision on cut-002.
    const cut002 = saved.find((c: Cut) => c.id === 'cut-002')
    expect(cut002?.imageState?.revisions).toHaveLength(1)
    expect(cut002?.imageState?.revisions?.[0].version).toBe(1)
    expect(cut002?.imageState?.revisions?.[0].path).toBe(
      'plots/episode-1/assets/cut-002/clean-v001.webp'
    )
    // And the new cut is also present (the add did happen).
    expect(saved.some((c: Cut) => c.id === 'cut-004')).toBe(true)
  })

  it('ignores undefined cutsOverride (initial mount + plot-switch path)', async () => {
    // When Workspace clears the override on plot change, CutList
    // must NOT dispatch and must NOT wipe its current state.cuts.
    const onCutsChanged = vi.fn<(cuts: Cut[]) => void>()
    function Harness(): JSX.Element {
      const [override, setOverride] = useState<Cut[] | undefined>([
        makeCut('cut-001'),
        makeCut('cut-002', [{ version: 1, path: 'plots/episode-1/assets/cut-002/clean-v001.webp' }])
      ])
      const noopSelect = useCallback(() => {}, [])
      return (
        <>
          <CutList
            projectId="proj_1"
            activeCutId="cut-002"
            onSelectCut={noopSelect}
            onCutsChanged={onCutsChanged}
            cutsOverride={override}
          />
          <button type="button" data-testid="clear-override" onClick={() => setOverride(undefined)}>
            clear-override
          </button>
        </>
      )
    }

    render(<Harness />)
    // Wait for either the initial load OR the override to land.
    await waitFor(() => {
      expect(screen.queryAllByTestId(/^status-cut-00/).length).toBeGreaterThan(0)
    })

    // Clearing the override should not crash and not wipe content.
    fireEvent.click(screen.getByTestId('clear-override'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    // CutList still renders cuts after the clear.
    expect(screen.queryAllByTestId(/^status-cut-00/).length).toBeGreaterThan(0)
  })
})
