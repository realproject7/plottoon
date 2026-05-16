import { describe, it, expect } from 'vitest'
import {
  checkCutStatus,
  checkCleanImages,
  checkFinalExports,
  checkImageSize,
  checkTextOverflow,
  checkTranscript,
  checkAltText,
  validatePublishReadiness
} from '../publishReadiness'
import type { Cut } from '../CutList'
import type { ExportMeta } from '../exportMetadata'

function makeCut(
  id: string,
  opts: {
    status?: string
    dialogue?: string
    narration?: string
    direction?: string
    imagePath?: string
    imageStatus?: string
    overlays?: Cut['overlays']
  } = {}
): Cut {
  return {
    id,
    status: opts.status,
    dialogue: opts.dialogue,
    narration: opts.narration,
    direction: opts.direction,
    imageState: opts.imagePath
      ? { status: opts.imageStatus ?? 'done', path: opts.imagePath }
      : opts.imageStatus
        ? { status: opts.imageStatus }
        : undefined,
    overlays: opts.overlays
  }
}

function makeExportMeta(cutId: string, byteSize: number): ExportMeta {
  return {
    cutId,
    exportedAt: '2026-05-16T12:00:00.000Z',
    width: 320,
    height: 480,
    mimeType: 'image/webp',
    byteSize,
    hash: 'abcd1234',
    fonts: ['sans-serif'],
    path: `exports/${cutId}.webp`
  }
}

describe('checkCutStatus', () => {
  it('passes when all cuts are approved or beyond', () => {
    const cuts = [
      makeCut('c1', { status: 'approved' }),
      makeCut('c2', { status: 'exported' }),
      makeCut('c3', { status: 'published' })
    ]
    const result = checkCutStatus(cuts)
    expect(result.level).toBe('pass')
  })

  it('blocks when cuts are not approved', () => {
    const cuts = [
      makeCut('c1', { status: 'approved' }),
      makeCut('c2', { status: 'draft' }),
      makeCut('c3', { status: 'planned' })
    ]
    const result = checkCutStatus(cuts)
    expect(result.level).toBe('block')
    expect(result.message).toContain('c2')
    expect(result.message).toContain('c3')
  })

  it('blocks when status is undefined', () => {
    const result = checkCutStatus([makeCut('c1')])
    expect(result.level).toBe('block')
  })
})

describe('checkCleanImages', () => {
  it('passes when all cuts have done images', () => {
    const cuts = [
      makeCut('c1', { imagePath: 'assets/c1.webp', imageStatus: 'done' }),
      makeCut('c2', { imagePath: 'assets/c2.webp', imageStatus: 'done' })
    ]
    expect(checkCleanImages(cuts).level).toBe('pass')
  })

  it('blocks when cuts have no image', () => {
    const cuts = [
      makeCut('c1'),
      makeCut('c2', { imagePath: 'assets/c2.webp', imageStatus: 'done' })
    ]
    const result = checkCleanImages(cuts)
    expect(result.level).toBe('block')
    expect(result.message).toContain('c1')
  })

  it('blocks when image status is pending', () => {
    const cuts = [makeCut('c1', { imageStatus: 'pending' })]
    expect(checkCleanImages(cuts).level).toBe('block')
  })
})

describe('checkFinalExports', () => {
  it('passes when all cuts have export manifest entries', () => {
    const cuts = [
      makeCut('c1', { imagePath: 'assets/c1.webp', imageStatus: 'done' }),
      makeCut('c2', { imagePath: 'assets/c2.webp', imageStatus: 'done' })
    ]
    const metas = [makeExportMeta('c1', 500_000), makeExportMeta('c2', 500_000)]
    expect(checkFinalExports(cuts, metas).level).toBe('pass')
  })

  it('blocks when cuts are missing from export manifest', () => {
    const cuts = [
      makeCut('c1', { imagePath: 'assets/c1.webp', imageStatus: 'done' }),
      makeCut('c2', { imagePath: 'assets/c2.webp', imageStatus: 'done' })
    ]
    const metas = [makeExportMeta('c1', 500_000)]
    const result = checkFinalExports(cuts, metas)
    expect(result.level).toBe('block')
    expect(result.message).toContain('c2')
  })

  it('blocks when clean image exists but no final export', () => {
    const cuts = [makeCut('c1', { imagePath: 'assets/c1.webp', imageStatus: 'done' })]
    const result = checkFinalExports(cuts, [])
    expect(result.level).toBe('block')
    expect(result.message).toContain('c1')
  })

  it('passes with empty cuts array', () => {
    expect(checkFinalExports([], []).level).toBe('pass')
  })
})

describe('checkTextOverflow', () => {
  it('passes when no overlays overflow', () => {
    const cuts = [
      makeCut('c1', {
        overlays: [{ id: 'o1', type: 'text', content: 'Hi', x: 0, y: 0, width: 200, height: 100 }]
      })
    ]
    expect(checkTextOverflow(cuts).level).toBe('pass')
  })

  it('blocks when overlays overflow', () => {
    const cuts = [
      makeCut('c1', {
        overlays: [
          {
            id: 'o1',
            type: 'text',
            content:
              'This extremely long text will definitely overflow the tiny bounds of this small overlay',
            x: 0,
            y: 0,
            width: 80,
            height: 20
          }
        ]
      })
    ]
    expect(checkTextOverflow(cuts).level).toBe('block')
  })

  it('passes when no overlays exist', () => {
    expect(checkTextOverflow([makeCut('c1')]).level).toBe('pass')
  })
})

describe('checkImageSize', () => {
  it('passes when all images are under 1MB', () => {
    const metas = [makeExportMeta('c1', 500_000), makeExportMeta('c2', 900_000)]
    expect(checkImageSize(metas).level).toBe('pass')
  })

  it('blocks when any image exceeds 1MB', () => {
    const metas = [makeExportMeta('c1', 500_000), makeExportMeta('c2', 1_200_000)]
    const result = checkImageSize(metas)
    expect(result.level).toBe('block')
    expect(result.message).toContain('c2')
    expect(result.message).toContain('1MB')
  })

  it('passes for empty metas', () => {
    expect(checkImageSize([]).level).toBe('pass')
  })
})

describe('checkTranscript', () => {
  it('passes when all cuts have dialogue or narration', () => {
    const cuts = [makeCut('c1', { dialogue: 'Hello' }), makeCut('c2', { narration: 'Scene opens' })]
    expect(checkTranscript(cuts).level).toBe('pass')
  })

  it('warns when some cuts lack content', () => {
    const cuts = [makeCut('c1', { dialogue: 'Hello' }), makeCut('c2')]
    const result = checkTranscript(cuts)
    expect(result.level).toBe('warn')
    expect(result.message).toContain('c2')
  })

  it('blocks when no cuts have content', () => {
    const cuts = [makeCut('c1'), makeCut('c2')]
    expect(checkTranscript(cuts).level).toBe('block')
  })
})

describe('checkAltText', () => {
  it('passes when all cuts have descriptive alt text', () => {
    const cuts = [makeCut('c1', { direction: 'Wide shot' }), makeCut('c2', { dialogue: 'Hello' })]
    expect(checkAltText(cuts).level).toBe('pass')
  })

  it('warns when cuts fall back to ID-only alt text', () => {
    const cuts = [makeCut('c1', { direction: 'Scene' }), makeCut('c2')]
    const result = checkAltText(cuts)
    expect(result.level).toBe('warn')
    expect(result.message).toContain('c2')
  })
})

describe('validatePublishReadiness', () => {
  it('returns ready when all checks pass', () => {
    const cuts = [
      makeCut('c1', {
        status: 'approved',
        dialogue: 'Hello',
        direction: 'Wide shot',
        imagePath: 'assets/c1.webp',
        imageStatus: 'done'
      })
    ]
    const metas = [makeExportMeta('c1', 500_000)]
    const report = validatePublishReadiness(cuts, metas)
    expect(report.ready).toBe(true)
    expect(report.checks.every((c) => c.level !== 'block')).toBe(true)
  })

  it('returns not ready when any check blocks', () => {
    const cuts = [makeCut('c1', { status: 'draft', dialogue: 'Hi', direction: 'Shot' })]
    const report = validatePublishReadiness(cuts)
    expect(report.ready).toBe(false)
  })

  it('returns ready with warnings but no blocks', () => {
    const cuts = [
      makeCut('c1', {
        status: 'approved',
        dialogue: 'Hello',
        imagePath: 'assets/c1.webp',
        imageStatus: 'done'
      }),
      makeCut('c2', {
        status: 'approved',
        direction: 'Scene',
        imagePath: 'assets/c2.webp',
        imageStatus: 'done'
      })
    ]
    const metas = [makeExportMeta('c1', 500_000), makeExportMeta('c2', 500_000)]
    const report = validatePublishReadiness(cuts, metas)
    expect(report.ready).toBe(true)
    expect(report.checks.some((c) => c.level === 'warn')).toBe(true)
  })

  it('includes all seven checks', () => {
    const report = validatePublishReadiness([makeCut('c1')])
    expect(report.checks).toHaveLength(7)
    const ids = report.checks.map((c) => c.id)
    expect(ids).toContain('cut-status')
    expect(ids).toContain('clean-images')
    expect(ids).toContain('final-exports')
    expect(ids).toContain('image-size')
    expect(ids).toContain('text-overflow')
    expect(ids).toContain('transcript')
    expect(ids).toContain('alt-text')
  })

  it('provides actionable messages for blocked checks', () => {
    const cuts = [makeCut('c1', { status: 'draft' })]
    const report = validatePublishReadiness(cuts)
    const blocked = report.checks.filter((c) => c.level === 'block')
    for (const check of blocked) {
      expect(check.message.length).toBeGreaterThan(0)
      expect(check.label.length).toBeGreaterThan(0)
    }
  })
})
