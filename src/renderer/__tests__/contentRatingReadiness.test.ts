import { describe, it, expect } from 'vitest'
import { checkContentRating, validatePublishReadiness } from '../publishReadiness'
import type { Cut } from '../CutList'
import type { ExportMeta } from '../exportMetadata'

function makeCut(id: string): Cut {
  return {
    id,
    dialogue: 'Dialogue',
    direction: 'Direction',
    imageState: { status: 'done', path: `${id}.webp`, prompt: null, seed: null },
    overlays: [],
    status: 'approved'
  }
}

function makeExportMeta(cutId: string): ExportMeta {
  return {
    cutId,
    exportedAt: '2026-01-01T00:00:00.000Z',
    width: 320,
    height: 480,
    mimeType: 'image/webp',
    byteSize: 500_000,
    hash: `hash-${cutId}`,
    fonts: ['sans-serif'],
    path: `exports/${cutId}.webp`
  }
}

describe('checkContentRating', () => {
  it('passes for all-ages rating', () => {
    const check = checkContentRating('all-ages')
    expect(check.level).toBe('pass')
    expect(check.message).toContain('all-ages')
  })

  it('passes for teen rating', () => {
    const check = checkContentRating('teen')
    expect(check.level).toBe('pass')
    expect(check.message).toContain('teen')
  })

  it('passes for mature rating', () => {
    const check = checkContentRating('mature')
    expect(check.level).toBe('pass')
    expect(check.message).toContain('mature')
  })

  it('blocks for undefined rating', () => {
    const check = checkContentRating(undefined)
    expect(check.level).toBe('block')
    expect(check.message).toContain('required')
  })

  it('blocks for invalid rating value', () => {
    const check = checkContentRating('nsfw')
    expect(check.level).toBe('block')
  })
})

describe('validatePublishReadiness with content rating', () => {
  it('does not include content rating check when opts not provided', () => {
    const cuts = [makeCut('c1')]
    const metas = [makeExportMeta('c1')]
    const report = validatePublishReadiness(cuts, metas)

    const ratingCheck = report.checks.find((c) => c.id === 'content-rating')
    expect(ratingCheck).toBeUndefined()
  })

  it('blocks when contentRating is undefined in opts', () => {
    const cuts = [makeCut('c1')]
    const metas = [makeExportMeta('c1')]
    const report = validatePublishReadiness(cuts, metas, { contentRating: undefined })

    const ratingCheck = report.checks.find((c) => c.id === 'content-rating')
    expect(ratingCheck).toBeDefined()
    expect(ratingCheck!.level).toBe('block')
    expect(report.ready).toBe(false)
  })

  it('passes when contentRating is valid', () => {
    const cuts = [makeCut('c1')]
    const metas = [makeExportMeta('c1')]
    const report = validatePublishReadiness(cuts, metas, { contentRating: 'all-ages' })

    const ratingCheck = report.checks.find((c) => c.id === 'content-rating')
    expect(ratingCheck).toBeDefined()
    expect(ratingCheck!.level).toBe('pass')
  })

  it('blocks when contentRating is invalid string', () => {
    const cuts = [makeCut('c1')]
    const metas = [makeExportMeta('c1')]
    const report = validatePublishReadiness(cuts, metas, { contentRating: 'explicit' })

    const ratingCheck = report.checks.find((c) => c.id === 'content-rating')
    expect(ratingCheck!.level).toBe('block')
    expect(report.ready).toBe(false)
  })
})
