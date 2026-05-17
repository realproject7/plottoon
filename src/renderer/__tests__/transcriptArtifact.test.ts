import { describe, it, expect } from 'vitest'
import {
  buildTranscriptArtifact,
  hasTranscriptContent,
  hasAltTextForAll,
  transcriptCoverage,
  serializeTranscriptArtifact,
  parseTranscriptArtifact
} from '../transcriptArtifact'
import type { Cut } from '../CutList'

function makeCut(id: string, opts: Partial<Cut> = {}): Cut {
  return {
    id,
    dialogue: opts.dialogue ?? '',
    direction: opts.direction ?? '',
    imageState: { status: 'done', path: `${id}.webp`, prompt: null, seed: null },
    overlays: opts.overlays ?? [],
    narration: opts.narration
  }
}

describe('buildTranscriptArtifact', () => {
  it('builds artifact from cuts with dialogue and narration', () => {
    const cuts = [
      makeCut('cut-001', { dialogue: 'Hello', direction: 'Wide shot' }),
      makeCut('cut-002', { narration: 'The scene unfolds', direction: 'Close-up' })
    ]
    const artifact = buildTranscriptArtifact(cuts, 'Test Episode')

    expect(artifact.plotTitle).toBe('Test Episode')
    expect(artifact.generatedAt).toBeTruthy()
    expect(artifact.entries).toHaveLength(2)
    expect(artifact.entries[0].cutId).toBe('cut-001')
    expect(artifact.entries[0].dialogue).toBe('Hello')
    expect(artifact.entries[0].altText).toContain('Wide shot')
    expect(artifact.entries[1].narration).toBe('The scene unfolds')
  })

  it('includes SFX from overlays', () => {
    const cuts = [
      makeCut('cut-001', {
        direction: 'Action',
        overlays: [{ type: 'sfx', content: 'BOOM', x: 0, y: 0, width: 100, height: 50 }]
      })
    ]
    const artifact = buildTranscriptArtifact(cuts, 'Ep')
    expect(artifact.entries[0].sfx).toEqual(['BOOM'])
  })

  it('generates alt text per cut', () => {
    const cuts = [makeCut('cut-001', { direction: 'Establishing shot', dialogue: 'Hi there' })]
    const artifact = buildTranscriptArtifact(cuts, 'Ep')
    expect(artifact.entries[0].altText).toContain('Establishing shot')
    expect(artifact.entries[0].altText).toContain('Hi there')
  })
})

describe('hasTranscriptContent', () => {
  it('returns true when any entry has dialogue', () => {
    const cuts = [makeCut('cut-001', { dialogue: 'Words' })]
    const artifact = buildTranscriptArtifact(cuts, 'Ep')
    expect(hasTranscriptContent(artifact)).toBe(true)
  })

  it('returns true when any entry has narration', () => {
    const cuts = [makeCut('cut-001', { narration: 'Narrated' })]
    const artifact = buildTranscriptArtifact(cuts, 'Ep')
    expect(hasTranscriptContent(artifact)).toBe(true)
  })

  it('returns true when any entry has SFX', () => {
    const cuts = [
      makeCut('cut-001', {
        overlays: [{ type: 'sfx', content: 'CRASH', x: 0, y: 0, width: 50, height: 50 }]
      })
    ]
    const artifact = buildTranscriptArtifact(cuts, 'Ep')
    expect(hasTranscriptContent(artifact)).toBe(true)
  })

  it('returns false when no entries have content', () => {
    const cuts = [makeCut('cut-001'), makeCut('cut-002')]
    const artifact = buildTranscriptArtifact(cuts, 'Ep')
    expect(hasTranscriptContent(artifact)).toBe(false)
  })
})

describe('hasAltTextForAll', () => {
  it('returns true when all cuts have descriptive alt text', () => {
    const cuts = [
      makeCut('cut-001', { direction: 'A scene' }),
      makeCut('cut-002', { direction: 'Another scene' })
    ]
    const artifact = buildTranscriptArtifact(cuts, 'Ep')
    expect(hasAltTextForAll(artifact)).toBe(true)
  })

  it('returns false when any cut falls back to ID', () => {
    const cuts = [makeCut('cut-001', { direction: 'A scene' }), makeCut('cut-002')]
    const artifact = buildTranscriptArtifact(cuts, 'Ep')
    expect(hasAltTextForAll(artifact)).toBe(false)
  })
})

describe('transcriptCoverage', () => {
  it('reports coverage statistics', () => {
    const cuts = [
      makeCut('cut-001', { direction: 'Scene', dialogue: 'Hi' }),
      makeCut('cut-002', { direction: 'Scene 2' }),
      makeCut('cut-003')
    ]
    const artifact = buildTranscriptArtifact(cuts, 'Ep')
    const coverage = transcriptCoverage(artifact)

    expect(coverage.total).toBe(3)
    expect(coverage.withContent).toBe(1)
    expect(coverage.withAltText).toBe(2)
  })
})

describe('serialize and parse', () => {
  it('round-trips artifact through JSON', () => {
    const cuts = [makeCut('cut-001', { dialogue: 'Hello', direction: 'Shot' })]
    const artifact = buildTranscriptArtifact(cuts, 'Ep')

    const json = serializeTranscriptArtifact(artifact)
    const parsed = parseTranscriptArtifact(json)

    expect(parsed).not.toBeNull()
    expect(parsed!.plotTitle).toBe('Ep')
    expect(parsed!.entries).toHaveLength(1)
    expect(parsed!.entries[0].dialogue).toBe('Hello')
  })

  it('returns null for invalid JSON', () => {
    expect(parseTranscriptArtifact('not json')).toBeNull()
  })

  it('returns null for missing required fields', () => {
    expect(parseTranscriptArtifact(JSON.stringify({ plotTitle: 'X' }))).toBeNull()
    expect(parseTranscriptArtifact(JSON.stringify({ entries: [] }))).toBeNull()
  })
})
