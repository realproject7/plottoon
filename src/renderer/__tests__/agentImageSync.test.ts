// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildSyncRequests, mergeAdoptedRevisions } from '../agentImageSync'
import type { Cut } from '../CutList'

function cut(id: string, overrides: Partial<Cut['imageState']> = {}): Cut {
  return {
    id,
    status: 'draft',
    imageState: {
      status: 'pending',
      revisions: [],
      ...overrides
    }
  } as Cut
}

describe('#278 buildSyncRequests', () => {
  it('emits (cutId, knownVersions) for every cut', () => {
    const cuts: Cut[] = [
      cut('cut-001', { revisions: [{ version: 1, path: 'a.webp', createdAt: 'x' }] }),
      cut('cut-002', { revisions: [] })
    ]
    expect(buildSyncRequests(cuts)).toEqual([
      { cutId: 'cut-001', knownVersions: [1] },
      { cutId: 'cut-002', knownVersions: [] }
    ])
  })

  it('treats a cut without imageState as knownVersions=[]', () => {
    const cuts = [{ id: 'cut-001' } as Cut]
    expect(buildSyncRequests(cuts)).toEqual([{ cutId: 'cut-001', knownVersions: [] }])
  })
})

describe('#278 mergeAdoptedRevisions', () => {
  it('returns the input unchanged when there are no adopted revisions', () => {
    const cuts = [cut('cut-001')]
    expect(mergeAdoptedRevisions(cuts, [])).toBe(cuts)
  })

  it('appends a new revision and points imageState.path at it (newest wins)', () => {
    const cuts = [cut('cut-001')]
    const merged = mergeAdoptedRevisions(cuts, [
      {
        cutId: 'cut-001',
        version: 1,
        filename: 'clean-v001.webp',
        relativePath: 'plots/p/assets/cut-001/clean-v001.webp',
        createdAt: '2026-05-25T00:00:00.000Z',
        sizeBytes: 1024
      }
    ])
    expect(merged[0].imageState?.revisions).toHaveLength(1)
    expect(merged[0].imageState?.revisions?.[0].version).toBe(1)
    expect(merged[0].imageState?.path).toBe('plots/p/assets/cut-001/clean-v001.webp')
    expect(merged[0].imageState?.status).toBe('done')
    expect(merged[0].imageState?.generationBackend).toBe('agent')
  })

  it('NEVER overwrites an existing revision with the same version', () => {
    const cuts = [
      cut('cut-001', {
        path: 'plots/p/assets/cut-001/clean-v001.webp',
        revisions: [
          {
            version: 1,
            path: 'plots/p/assets/cut-001/clean-v001.webp',
            createdAt: 'old'
          }
        ]
      })
    ]
    const merged = mergeAdoptedRevisions(cuts, [
      {
        cutId: 'cut-001',
        version: 1,
        filename: 'clean-v001.webp',
        relativePath: 'plots/p/assets/cut-001/clean-v001.webp',
        createdAt: '2026-05-25T00:00:00.000Z',
        sizeBytes: 1024
      }
    ])
    expect(merged[0].imageState?.revisions).toHaveLength(1)
    expect(merged[0].imageState?.revisions?.[0].createdAt).toBe('old')
  })

  it('appends multiple new versions and uses the highest as current path', () => {
    const cuts = [cut('cut-001')]
    const merged = mergeAdoptedRevisions(cuts, [
      {
        cutId: 'cut-001',
        version: 2,
        filename: 'clean-v002.webp',
        relativePath: 'plots/p/assets/cut-001/clean-v002.webp',
        createdAt: 't2',
        sizeBytes: 1
      },
      {
        cutId: 'cut-001',
        version: 3,
        filename: 'clean-v003.webp',
        relativePath: 'plots/p/assets/cut-001/clean-v003.webp',
        createdAt: 't3',
        sizeBytes: 1
      }
    ])
    expect(merged[0].imageState?.revisions?.map((r) => r.version)).toEqual([2, 3])
    expect(merged[0].imageState?.path).toBe('plots/p/assets/cut-001/clean-v003.webp')
  })

  it('preserves manual-import revisions when adding new agent revisions', () => {
    const cuts = [
      cut('cut-001', {
        path: 'plots/p/assets/cut-001/clean-v001.png',
        generationBackend: 'manual',
        revisions: [
          {
            version: 1,
            path: 'plots/p/assets/cut-001/clean-v001.png',
            createdAt: 'manual-time'
          }
        ]
      })
    ]
    const merged = mergeAdoptedRevisions(cuts, [
      {
        cutId: 'cut-001',
        version: 2,
        filename: 'clean-v002.webp',
        relativePath: 'plots/p/assets/cut-001/clean-v002.webp',
        createdAt: 'agent-time',
        sizeBytes: 1024
      }
    ])
    // Both revisions present, in version order.
    expect(merged[0].imageState?.revisions?.map((r) => r.version)).toEqual([1, 2])
    // Original generationBackend ('manual') is preserved — we don't
    // rewrite it just because the agent contributed a new revision.
    expect(merged[0].imageState?.generationBackend).toBe('manual')
    // Current image flips to the newer revision (matches manual import).
    expect(merged[0].imageState?.path).toBe('plots/p/assets/cut-001/clean-v002.webp')
  })

  it('leaves cuts with no adopted revisions untouched (reference equality)', () => {
    const cuts = [cut('cut-001'), cut('cut-002')]
    const merged = mergeAdoptedRevisions(cuts, [
      {
        cutId: 'cut-002',
        version: 1,
        filename: 'clean-v001.webp',
        relativePath: 'plots/p/assets/cut-002/clean-v001.webp',
        createdAt: 't',
        sizeBytes: 1
      }
    ])
    // cut-001 was untouched — same object reference.
    expect(merged[0]).toBe(cuts[0])
    // cut-002 was rewritten.
    expect(merged[1]).not.toBe(cuts[1])
  })

  it('handles a multi-cut adoption batch without bleeding revisions across cuts', () => {
    const cuts = [cut('cut-001'), cut('cut-002')]
    const merged = mergeAdoptedRevisions(cuts, [
      {
        cutId: 'cut-001',
        version: 1,
        filename: 'clean-v001.webp',
        relativePath: 'cut-001/clean-v001.webp',
        createdAt: 't',
        sizeBytes: 1
      },
      {
        cutId: 'cut-002',
        version: 1,
        filename: 'clean-v001.webp',
        relativePath: 'cut-002/clean-v001.webp',
        createdAt: 't',
        sizeBytes: 1
      }
    ])
    expect(merged[0].imageState?.path).toBe('cut-001/clean-v001.webp')
    expect(merged[1].imageState?.path).toBe('cut-002/clean-v001.webp')
  })
})
