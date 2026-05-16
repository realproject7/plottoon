import { describe, it, expect } from 'vitest'
import {
  generateTranscript,
  generateAltText,
  generatePublishMarkdown,
  generateTranscriptText
} from '../publishGenerator'
import type { Cut } from '../CutList'

function makeCut(
  id: string,
  dialogue = '',
  narration = '',
  direction = '',
  overlays?: Cut['overlays']
): Cut {
  return { id, dialogue, narration, direction, overlays }
}

describe('generateTranscript', () => {
  it('extracts dialogue and narration from cuts', () => {
    const cuts = [
      makeCut('cut-001', 'Hello!', 'The hero arrives.'),
      makeCut('cut-002', 'Goodbye.', '')
    ]
    const transcript = generateTranscript(cuts)
    expect(transcript).toHaveLength(2)
    expect(transcript[0].dialogue).toBe('Hello!')
    expect(transcript[0].narration).toBe('The hero arrives.')
    expect(transcript[1].dialogue).toBe('Goodbye.')
  })

  it('extracts SFX from overlays', () => {
    const cuts = [
      makeCut('cut-001', '', '', '', [
        { id: 'ovl-1', type: 'sfx', content: 'BOOM', x: 0, y: 0, width: 100, height: 40 },
        { id: 'ovl-2', type: 'sfx', content: 'CRASH', x: 0, y: 0, width: 100, height: 40 },
        { id: 'ovl-3', type: 'text', content: 'speech', x: 0, y: 0, width: 100, height: 40 }
      ])
    ]
    const transcript = generateTranscript(cuts)
    expect(transcript[0].sfx).toEqual(['BOOM', 'CRASH'])
  })

  it('returns empty values for cuts without content', () => {
    const transcript = generateTranscript([makeCut('cut-001')])
    expect(transcript[0].dialogue).toBe('')
    expect(transcript[0].narration).toBe('')
    expect(transcript[0].sfx).toEqual([])
  })

  it('handles empty cuts array', () => {
    expect(generateTranscript([])).toEqual([])
  })
})

describe('generateAltText', () => {
  it('includes direction, dialogue, and narration', () => {
    const cut = makeCut('cut-001', 'Watch out!', 'The villain appears.', 'Close-up on face')
    const alt = generateAltText(cut)
    expect(alt).toContain('Close-up on face')
    expect(alt).toContain('Watch out!')
    expect(alt).toContain('The villain appears')
  })

  it('includes SFX from overlays', () => {
    const cut = makeCut('cut-001', '', '', '', [
      { id: 'ovl-1', type: 'sfx', content: 'BANG', x: 0, y: 0, width: 100, height: 40 }
    ])
    const alt = generateAltText(cut)
    expect(alt).toContain('BANG')
  })

  it('falls back to cut id when no content', () => {
    const alt = generateAltText(makeCut('cut-001'))
    expect(alt).toBe('cut-001')
  })
})

describe('generatePublishMarkdown', () => {
  it('generates image-only markdown by default', () => {
    const cuts = [
      makeCut('cut-001', 'Hello!', 'Opening scene.', 'Wide shot'),
      makeCut('cut-002', 'Goodbye.', '', 'Close-up')
    ]
    const urls = [
      { cutId: 'cut-001', url: 'https://cdn.example.com/cut-001.webp' },
      { cutId: 'cut-002', url: 'https://cdn.example.com/cut-002.webp' }
    ]

    const md = generatePublishMarkdown({ cuts, urls, plotTitle: 'Episode 1' })

    expect(md).toContain('# Episode 1')
    expect(md).toContain('![')
    expect(md).toContain('https://cdn.example.com/cut-001.webp')
    expect(md).toContain('https://cdn.example.com/cut-002.webp')
    expect(md).not.toContain('## Transcript')
  })

  it('includes transcript when includeTranscript is true', () => {
    const cuts = [
      makeCut('cut-001', 'Hello!', 'Opening scene.', 'Wide shot'),
      makeCut('cut-002', 'Goodbye.', '', 'Close-up')
    ]
    const urls = [
      { cutId: 'cut-001', url: 'https://cdn.example.com/cut-001.webp' },
      { cutId: 'cut-002', url: 'https://cdn.example.com/cut-002.webp' }
    ]

    const md = generatePublishMarkdown({
      cuts,
      urls,
      plotTitle: 'Episode 1',
      includeTranscript: true
    })

    expect(md).toContain('## Transcript')
    expect(md).toContain('Hello!')
    expect(md).toContain('Opening scene.')
  })

  it('orders images in cut array order', () => {
    const cuts = [makeCut('cut-001', '', '', 'First'), makeCut('cut-002', '', '', 'Second')]
    const urls = [
      { cutId: 'cut-001', url: 'https://cdn.example.com/1.webp' },
      { cutId: 'cut-002', url: 'https://cdn.example.com/2.webp' }
    ]

    const md = generatePublishMarkdown({ cuts, urls, plotTitle: 'Test' })
    const firstIdx = md.indexOf('1.webp')
    const secondIdx = md.indexOf('2.webp')
    expect(firstIdx).toBeLessThan(secondIdx)
  })

  it('throws when URLs are missing and not dry-run', () => {
    const cuts = [makeCut('cut-001'), makeCut('cut-002')]
    const urls = [{ cutId: 'cut-001', url: 'https://cdn.example.com/1.webp' }]

    expect(() => generatePublishMarkdown({ cuts, urls, plotTitle: 'Test' })).toThrow(
      'Missing required URLs for cuts: cut-002'
    )
  })

  it('throws when URL is empty string', () => {
    const cuts = [makeCut('cut-001')]
    const urls = [{ cutId: 'cut-001', url: '' }]

    expect(() => generatePublishMarkdown({ cuts, urls, plotTitle: 'Test' })).toThrow(
      'Missing required URLs for cuts: cut-001'
    )
  })

  it('throws when URL is whitespace only', () => {
    const cuts = [makeCut('cut-001')]
    const urls = [{ cutId: 'cut-001', url: '   ' }]

    expect(() => generatePublishMarkdown({ cuts, urls, plotTitle: 'Test' })).toThrow(
      'Missing required URLs for cuts: cut-001'
    )
  })

  it('uses placeholders in dry-run mode', () => {
    const cuts = [makeCut('cut-001', 'Hi'), makeCut('cut-002')]
    const urls: { cutId: string; url: string }[] = []

    const md = generatePublishMarkdown({ cuts, urls, plotTitle: 'Test', dryRun: true })

    expect(md).toContain('[PLACEHOLDER:cut-001]')
    expect(md).toContain('[PLACEHOLDER:cut-002]')
  })

  it('includes SFX in transcript section when includeTranscript is true', () => {
    const cuts = [
      makeCut('cut-001', '', '', '', [
        { id: 'ovl-1', type: 'sfx', content: 'WHOOSH', x: 0, y: 0, width: 100, height: 40 }
      ])
    ]
    const md = generatePublishMarkdown({
      cuts,
      urls: [{ cutId: 'cut-001', url: 'https://cdn.example.com/1.webp' }],
      plotTitle: 'Test',
      includeTranscript: true
    })
    expect(md).toContain('WHOOSH')
  })
})

describe('generateTranscriptText', () => {
  it('generates plain text transcript', () => {
    const cuts = [
      makeCut('cut-001', 'Hello!', 'The hero speaks.'),
      makeCut('cut-002', '', '', '', [
        { id: 'ovl-1', type: 'sfx', content: 'BOOM', x: 0, y: 0, width: 100, height: 40 }
      ])
    ]
    const text = generateTranscriptText(cuts)
    expect(text).toContain('[cut-001]')
    expect(text).toContain('Dialogue: Hello!')
    expect(text).toContain('Narration: The hero speaks.')
    expect(text).toContain('[cut-002]')
    expect(text).toContain('SFX: BOOM')
  })
})
