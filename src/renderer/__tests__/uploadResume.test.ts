import { describe, it, expect } from 'vitest'
import {
  isStale,
  buildUploadPlan,
  getCutsToUpload,
  canTransitionToPublishing,
  canPublish,
  canPlotTransition,
  nextPlotState
} from '../uploadResume'
import type { PublishStatusFile, CutPublishEntry } from '../../main/services/publishStatus'
import type { ExportMeta } from '../exportMetadata'

function makeEntry(
  cutId: string,
  state: 'pending' | 'uploaded' | 'failed' = 'pending',
  opts: Partial<CutPublishEntry> = {}
): CutPublishEntry {
  return {
    cutId,
    state,
    cid: null,
    url: null,
    fileHash: null,
    error: null,
    protected: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...opts
  }
}

function makeStatus(cuts: CutPublishEntry[], plotState = 'draft' as const): PublishStatusFile {
  return {
    version: 1,
    plotState,
    error: null,
    publishedAt: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    cuts
  }
}

function makeMeta(cutId: string, hash = 'hash-abc'): ExportMeta {
  return {
    cutId,
    exportedAt: '2026-01-01T00:00:00.000Z',
    width: 320,
    height: 480,
    mimeType: 'image/webp',
    byteSize: 500,
    hash,
    fonts: ['sans-serif'],
    path: `plots/ep1/exports/${cutId}.webp`
  }
}

describe('isStale', () => {
  it('returns false for pending entry', () => {
    const entry = makeEntry('cut-001', 'pending')
    expect(isStale(entry, 'hash-abc')).toBe(false)
  })

  it('returns false when uploaded hash matches', () => {
    const entry = makeEntry('cut-001', 'uploaded', { fileHash: 'hash-abc' })
    expect(isStale(entry, 'hash-abc')).toBe(false)
  })

  it('returns true when uploaded hash differs', () => {
    const entry = makeEntry('cut-001', 'uploaded', { fileHash: 'hash-old' })
    expect(isStale(entry, 'hash-new')).toBe(true)
  })

  it('returns false for failed entry', () => {
    const entry = makeEntry('cut-001', 'failed', { fileHash: 'hash-old' })
    expect(isStale(entry, 'hash-new')).toBe(false)
  })
})

describe('buildUploadPlan', () => {
  it('plans fresh upload for all pending cuts', () => {
    const status = makeStatus([makeEntry('cut-001'), makeEntry('cut-002')])
    const metas = [makeMeta('cut-001'), makeMeta('cut-002')]
    const plan = buildUploadPlan(status, metas)

    expect(plan.cuts).toHaveLength(2)
    expect(plan.cuts[0].action).toBe('upload')
    expect(plan.cuts[1].action).toBe('upload')
    expect(plan.readyToPublish).toBe(false)
  })

  it('skips already-uploaded matching cuts', () => {
    const status = makeStatus([
      makeEntry('cut-001', 'uploaded', {
        fileHash: 'hash-abc',
        cid: 'cid-1',
        url: 'https://cdn/1',
        mimeType: 'image/webp',
        sizeBytes: 500
      }),
      makeEntry('cut-002', 'pending')
    ])
    const metas = [makeMeta('cut-001', 'hash-abc'), makeMeta('cut-002')]
    const plan = buildUploadPlan(status, metas)

    expect(plan.cuts[0].action).toBe('skip')
    expect(plan.cuts[1].action).toBe('upload')
  })

  it('marks stale uploads for retry', () => {
    const status = makeStatus([
      makeEntry('cut-001', 'uploaded', {
        fileHash: 'hash-old',
        cid: 'cid-1',
        url: 'https://cdn/1',
        mimeType: 'image/webp',
        sizeBytes: 500
      })
    ])
    const metas = [makeMeta('cut-001', 'hash-new')]
    const plan = buildUploadPlan(status, metas)

    expect(plan.cuts[0].action).toBe('retry')
    expect(plan.cuts[0].reason).toContain('Stale')
  })

  it('marks failed cuts for retry', () => {
    const status = makeStatus([makeEntry('cut-001', 'failed', { error: 'timeout' })])
    const metas = [makeMeta('cut-001')]
    const plan = buildUploadPlan(status, metas)

    expect(plan.cuts[0].action).toBe('retry')
    expect(plan.cuts[0].reason).toContain('timeout')
  })

  it('reports ready when all cuts are uploaded and hashes match', () => {
    const status = makeStatus([
      makeEntry('cut-001', 'uploaded', {
        fileHash: 'h1',
        cid: 'c1',
        url: 'u1',
        mimeType: 'image/webp',
        sizeBytes: 500
      }),
      makeEntry('cut-002', 'uploaded', {
        fileHash: 'h2',
        cid: 'c2',
        url: 'u2',
        mimeType: 'image/webp',
        sizeBytes: 600
      })
    ])
    const metas = [makeMeta('cut-001', 'h1'), makeMeta('cut-002', 'h2')]
    const plan = buildUploadPlan(status, metas)

    expect(plan.readyToPublish).toBe(true)
    expect(plan.blockReason).toBeNull()
  })

  it('handles missing export meta gracefully', () => {
    const status = makeStatus([makeEntry('cut-001')])
    const plan = buildUploadPlan(status, [])

    expect(plan.cuts[0].action).toBe('upload')
    expect(plan.cuts[0].reason).toContain('No export hash')
  })

  it('retries uploaded cut with matching hash but incomplete metadata', () => {
    const status = makeStatus([
      makeEntry('cut-001', 'uploaded', { fileHash: 'h1', cid: null, url: 'u1' })
    ])
    const metas = [makeMeta('cut-001', 'h1')]
    const plan = buildUploadPlan(status, metas)

    expect(plan.cuts[0].action).toBe('retry')
    expect(plan.cuts[0].reason).toContain('Incomplete upload metadata')
    expect(plan.readyToPublish).toBe(false)
  })
})

describe('getCutsToUpload', () => {
  it('returns only upload and retry cuts', () => {
    const status = makeStatus([
      makeEntry('cut-001', 'uploaded', {
        fileHash: 'h1',
        cid: 'c1',
        url: 'u1',
        mimeType: 'image/webp',
        sizeBytes: 500
      }),
      makeEntry('cut-002', 'pending'),
      makeEntry('cut-003', 'failed', { error: 'err' })
    ])
    const metas = [makeMeta('cut-001', 'h1'), makeMeta('cut-002'), makeMeta('cut-003')]
    const plan = buildUploadPlan(status, metas)
    const toUpload = getCutsToUpload(plan)

    expect(toUpload).toEqual(['cut-002', 'cut-003'])
  })
})

describe('canTransitionToPublishing', () => {
  it('returns true when all cuts uploaded with full metadata', () => {
    const status = makeStatus([
      makeEntry('cut-001', 'uploaded', {
        cid: 'c1',
        url: 'u1',
        fileHash: 'h1',
        mimeType: 'image/webp',
        sizeBytes: 500
      }),
      makeEntry('cut-002', 'uploaded', {
        cid: 'c2',
        url: 'u2',
        fileHash: 'h2',
        mimeType: 'image/webp',
        sizeBytes: 600
      })
    ])
    expect(canTransitionToPublishing(status)).toBe(true)
  })

  it('returns false when a cut is still pending', () => {
    const status = makeStatus([
      makeEntry('cut-001', 'uploaded', {
        cid: 'c1',
        url: 'u1',
        fileHash: 'h1',
        mimeType: 'image/webp',
        sizeBytes: 500
      }),
      makeEntry('cut-002', 'pending')
    ])
    expect(canTransitionToPublishing(status)).toBe(false)
  })

  it('returns false when a cut is missing metadata', () => {
    const status = makeStatus([
      makeEntry('cut-001', 'uploaded', {
        cid: null,
        url: 'u1',
        fileHash: 'h1',
        mimeType: 'image/webp',
        sizeBytes: 500
      })
    ])
    expect(canTransitionToPublishing(status)).toBe(false)
  })

  it('returns false when already published', () => {
    const status = makeStatus(
      [
        makeEntry('cut-001', 'uploaded', {
          cid: 'c1',
          url: 'u1',
          fileHash: 'h1',
          mimeType: 'image/webp',
          sizeBytes: 500
        })
      ],
      'published'
    )
    expect(canTransitionToPublishing(status)).toBe(false)
  })
})

describe('canPublish', () => {
  it('allows publish when all uploaded and hashes match', () => {
    const status = makeStatus([
      makeEntry('cut-001', 'uploaded', {
        cid: 'c1',
        url: 'u1',
        fileHash: 'h1',
        mimeType: 'image/webp',
        sizeBytes: 500
      }),
      makeEntry('cut-002', 'uploaded', {
        cid: 'c2',
        url: 'u2',
        fileHash: 'h2',
        mimeType: 'image/webp',
        sizeBytes: 600
      })
    ])
    const metas = [makeMeta('cut-001', 'h1'), makeMeta('cut-002', 'h2')]
    const result = canPublish(status, metas)

    expect(result.allowed).toBe(true)
    expect(result.reason).toBeNull()
  })

  it('blocks publish when cuts have stale hashes', () => {
    const status = makeStatus([
      makeEntry('cut-001', 'uploaded', {
        cid: 'c1',
        url: 'u1',
        fileHash: 'h-old',
        mimeType: 'image/webp',
        sizeBytes: 500
      })
    ])
    const metas = [makeMeta('cut-001', 'h-new')]
    const result = canPublish(status, metas)

    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('stale')
  })

  it('blocks publish when cuts are not uploaded', () => {
    const status = makeStatus([makeEntry('cut-001', 'pending')])
    const metas = [makeMeta('cut-001')]
    const result = canPublish(status, metas)

    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('not uploaded')
  })

  it('blocks publish when cuts are missing required metadata', () => {
    const status = makeStatus([
      makeEntry('cut-001', 'uploaded', {
        cid: null,
        url: 'u1',
        fileHash: 'h1',
        mimeType: 'image/webp',
        sizeBytes: 500
      })
    ])
    const metas = [makeMeta('cut-001', 'h1')]
    const result = canPublish(status, metas)

    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('missing required metadata')
  })
})

describe('canPlotTransition', () => {
  it('allows draft → ready', () => {
    expect(canPlotTransition('draft', 'ready')).toBe(true)
  })

  it('allows ready → publishing', () => {
    expect(canPlotTransition('ready', 'publishing')).toBe(true)
  })

  it('allows publishing → published', () => {
    expect(canPlotTransition('publishing', 'published')).toBe(true)
  })

  it('allows publishing → failed', () => {
    expect(canPlotTransition('publishing', 'failed')).toBe(true)
  })

  it('allows failed → ready', () => {
    expect(canPlotTransition('failed', 'ready')).toBe(true)
  })

  it('blocks published → anything', () => {
    expect(canPlotTransition('published', 'draft')).toBe(false)
    expect(canPlotTransition('published', 'ready')).toBe(false)
  })

  it('blocks draft → publishing directly', () => {
    expect(canPlotTransition('draft', 'publishing')).toBe(false)
  })
})

describe('nextPlotState', () => {
  it('suggests ready when all uploads complete', () => {
    const status = makeStatus([
      makeEntry('cut-001', 'uploaded', {
        fileHash: 'h1',
        cid: 'c1',
        url: 'u1',
        mimeType: 'image/webp',
        sizeBytes: 500
      })
    ])
    const metas = [makeMeta('cut-001', 'h1')]
    expect(nextPlotState(status, metas)).toBe('ready')
  })

  it('suggests draft when ready but uploads become stale', () => {
    const status = makeStatus(
      [makeEntry('cut-001', 'uploaded', { fileHash: 'h-old', cid: 'c1', url: 'u1' })],
      'ready'
    )
    const metas = [makeMeta('cut-001', 'h-new')]
    expect(nextPlotState(status, metas)).toBe('draft')
  })

  it('returns null when no transition needed', () => {
    const status = makeStatus([makeEntry('cut-001', 'pending')])
    const metas = [makeMeta('cut-001')]
    expect(nextPlotState(status, metas)).toBeNull()
  })
})
