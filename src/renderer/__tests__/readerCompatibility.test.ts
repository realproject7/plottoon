import { describe, it, expect } from 'vitest'
import { generatePublishMarkdown, generateAltText } from '../publishGenerator'
import type { Cut } from '../CutList'

/**
 * PlotLink cartoon reader compatibility constraints (from plotlink#1214):
 *
 * 1. Image sequence: images appear as markdown image tags `![alt](url)`,
 *    one per line, separated by blank lines. Reader renders them top-to-bottom.
 * 2. Alt text: reader uses alt text for screen readers and fallback display.
 *    Must be non-empty; fallback to cut ID is acceptable.
 * 3. URL format: absolute HTTPS URLs expected. Reader fetches directly.
 * 4. Title: H1 heading at the top (# Title). Reader uses this as plot title.
 * 5. Transcript: optional, placed after horizontal rule (---). Reader treats
 *    content after --- as transcript/metadata, not rendered in image view.
 * 6. No HTML: reader strips raw HTML. Markdown only.
 * 7. Image order: reader renders images in document order. Order must match
 *    the intended reading sequence (top-to-bottom for vertical scroll).
 * 8. Spacing: blank line between each image tag is required for reader to
 *    parse them as separate block-level elements.
 */

function makeCut(id: string, opts: Partial<Cut> = {}): Cut {
  return {
    id,
    dialogue: opts.dialogue ?? `Dialogue for ${id}`,
    direction: opts.direction ?? `Direction for ${id}`,
    imageState: { status: 'done', path: `${id}.webp`, prompt: null, seed: null },
    overlays: opts.overlays ?? [],
    narration: opts.narration,
    ...opts
  }
}

function makeUrls(cutIds: string[]) {
  return cutIds.map((id) => ({ cutId: id, url: `https://cdn.example.com/plots/ep1/${id}.webp` }))
}

describe('PlotLink cartoon reader compatibility', () => {
  describe('image sequence format', () => {
    it('produces one image tag per cut, separated by blank lines', () => {
      const cuts = [makeCut('cut-001'), makeCut('cut-002'), makeCut('cut-003')]
      const urls = makeUrls(['cut-001', 'cut-002', 'cut-003'])
      const md = generatePublishMarkdown({ cuts, urls, plotTitle: 'Episode 1' })

      const lines = md.split('\n')
      const imageLines = lines.filter((l) => l.startsWith('!['))
      expect(imageLines).toHaveLength(3)

      for (const imgLine of imageLines) {
        const idx = lines.indexOf(imgLine)
        expect(lines[idx + 1]).toBe('')
      }
    })

    it('preserves document order matching cut array order', () => {
      const cuts = [makeCut('cut-003'), makeCut('cut-001'), makeCut('cut-002')]
      const urls = makeUrls(['cut-003', 'cut-001', 'cut-002'])
      const md = generatePublishMarkdown({ cuts, urls, plotTitle: 'Ep' })

      const imageLines = md.split('\n').filter((l) => l.startsWith('!['))
      expect(imageLines[0]).toContain('cut-003.webp')
      expect(imageLines[1]).toContain('cut-001.webp')
      expect(imageLines[2]).toContain('cut-002.webp')
    })
  })

  describe('alt text', () => {
    it('generates non-empty alt text for cuts with direction', () => {
      const cut = makeCut('cut-001', { direction: 'Wide shot of city skyline at dusk' })
      const alt = generateAltText(cut)
      expect(alt.length).toBeGreaterThan(0)
      expect(alt).toContain('Wide shot of city skyline at dusk')
    })

    it('falls back to cut ID when no content is available', () => {
      const cut: Cut = {
        id: 'cut-007',
        dialogue: '',
        direction: '',
        imageState: { status: 'done', path: 'cut-007.webp', prompt: null, seed: null },
        overlays: []
      }
      const alt = generateAltText(cut)
      expect(alt).toBe('cut-007')
      expect(alt.length).toBeGreaterThan(0)
    })

    it('includes dialogue and narration in alt text', () => {
      const cut = makeCut('cut-001', {
        direction: 'Close-up',
        dialogue: 'Hello world',
        narration: 'The hero speaks'
      })
      const alt = generateAltText(cut)
      expect(alt).toContain('Dialogue: "Hello world"')
      expect(alt).toContain('Narration: The hero speaks')
    })

    it('passes through raw input as-is (sanitization is caller responsibility)', () => {
      const cut = makeCut('cut-001', {
        direction: 'Scene with <b>bold</b> text',
        dialogue: 'Said something'
      })
      const alt = generateAltText(cut)
      expect(alt).toContain('Scene with <b>bold</b> text')
    })
  })

  describe('URL format', () => {
    it('uses absolute HTTPS URLs in image tags', () => {
      const cuts = [makeCut('cut-001')]
      const urls = [{ cutId: 'cut-001', url: 'https://cdn.example.com/img/cut-001.webp' }]
      const md = generatePublishMarkdown({ cuts, urls, plotTitle: 'Ep' })

      const imageLines = md.split('\n').filter((l) => l.startsWith('!['))
      expect(imageLines[0]).toMatch(/\(https:\/\//)
    })

    it('uses placeholder URLs in dry-run mode when cut has no URL entry', () => {
      const cuts = [makeCut('cut-001')]
      const urls: { cutId: string; url: string }[] = []
      const md = generatePublishMarkdown({ cuts, urls, plotTitle: 'Ep', dryRun: true })

      const imageLines = md.split('\n').filter((l) => l.startsWith('!['))
      expect(imageLines[0]).toContain('[PLACEHOLDER:cut-001]')
    })
  })

  describe('title heading', () => {
    it('starts with H1 title', () => {
      const cuts = [makeCut('cut-001')]
      const urls = makeUrls(['cut-001'])
      const md = generatePublishMarkdown({ cuts, urls, plotTitle: 'My Episode Title' })

      const firstLine = md.split('\n')[0]
      expect(firstLine).toBe('# My Episode Title')
    })

    it('has blank line after title before first image', () => {
      const cuts = [makeCut('cut-001')]
      const urls = makeUrls(['cut-001'])
      const md = generatePublishMarkdown({ cuts, urls, plotTitle: 'Title' })

      const lines = md.split('\n')
      expect(lines[0]).toBe('# Title')
      expect(lines[1]).toBe('')
      expect(lines[2]).toMatch(/^!\[/)
    })
  })

  describe('transcript section', () => {
    it('places transcript after horizontal rule separator', () => {
      const cuts = [makeCut('cut-001', { dialogue: 'Hello' })]
      const urls = makeUrls(['cut-001'])
      const md = generatePublishMarkdown({
        cuts,
        urls,
        plotTitle: 'Ep',
        includeTranscript: true
      })

      const lines = md.split('\n')
      const hrIdx = lines.indexOf('---')
      expect(hrIdx).toBeGreaterThan(0)

      const afterHr = lines.slice(hrIdx + 1)
      expect(afterHr.some((l) => l.includes('Transcript'))).toBe(true)
    })

    it('transcript does not appear in image section', () => {
      const cuts = [makeCut('cut-001', { dialogue: 'Secret words' })]
      const urls = makeUrls(['cut-001'])
      const md = generatePublishMarkdown({
        cuts,
        urls,
        plotTitle: 'Ep',
        includeTranscript: true
      })

      const lines = md.split('\n')
      const hrIdx = lines.indexOf('---')
      const imageSectionLines = lines.slice(0, hrIdx)
      const imageSection = imageSectionLines.join('\n')
      expect(imageSection).not.toContain('**Dialogue:**')
    })

    it('omits transcript section when includeTranscript is false', () => {
      const cuts = [makeCut('cut-001', { dialogue: 'Hello' })]
      const urls = makeUrls(['cut-001'])
      const md = generatePublishMarkdown({
        cuts,
        urls,
        plotTitle: 'Ep',
        includeTranscript: false
      })

      expect(md).not.toContain('---')
      expect(md).not.toContain('Transcript')
    })
  })

  describe('no raw HTML in output', () => {
    it('markdown output uses only markdown syntax, no HTML tags', () => {
      const cuts = [
        makeCut('cut-001', { direction: 'A scene', dialogue: 'Words' }),
        makeCut('cut-002', { direction: 'Another scene', narration: 'Narrated' })
      ]
      const urls = makeUrls(['cut-001', 'cut-002'])
      const md = generatePublishMarkdown({
        cuts,
        urls,
        plotTitle: 'Clean Episode',
        includeTranscript: true
      })

      expect(md).not.toMatch(/<(?!!)[\w]/)
    })
  })

  describe('spacing between block elements', () => {
    it('every image tag is followed by a blank line', () => {
      const cuts = [makeCut('cut-001'), makeCut('cut-002'), makeCut('cut-003')]
      const urls = makeUrls(['cut-001', 'cut-002', 'cut-003'])
      const md = generatePublishMarkdown({ cuts, urls, plotTitle: 'Ep' })

      const lines = md.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('![')) {
          expect(lines[i + 1]).toBe('')
        }
      }
    })

    it('title is followed by a blank line', () => {
      const cuts = [makeCut('cut-001')]
      const urls = makeUrls(['cut-001'])
      const md = generatePublishMarkdown({ cuts, urls, plotTitle: 'Ep' })
      const lines = md.split('\n')
      expect(lines[1]).toBe('')
    })
  })
})

describe('reader compatibility fixture', () => {
  it('full cartoon markdown matches expected structure', () => {
    const cuts = [
      makeCut('cut-001', {
        direction: 'Wide establishing shot',
        dialogue: 'Welcome to the story'
      }),
      makeCut('cut-002', {
        direction: 'Close-up on protagonist',
        dialogue: 'I have something to say',
        narration: 'The tension builds'
      }),
      makeCut('cut-003', {
        direction: 'Action panel with motion lines',
        overlays: [{ type: 'sfx', content: 'WHOOSH', x: 0, y: 0, width: 100, height: 50 }]
      })
    ]
    const urls = makeUrls(['cut-001', 'cut-002', 'cut-003'])
    const md = generatePublishMarkdown({
      cuts,
      urls,
      plotTitle: 'Test Episode: Reader Verify',
      includeTranscript: true
    })

    // Structure verification
    const lines = md.split('\n')

    // Starts with H1
    expect(lines[0]).toBe('# Test Episode: Reader Verify')
    expect(lines[1]).toBe('')

    // Three images in order
    const imageLines = lines.filter((l) => l.startsWith('!['))
    expect(imageLines).toHaveLength(3)
    expect(imageLines[0]).toContain('cdn.example.com/plots/ep1/cut-001.webp')
    expect(imageLines[1]).toContain('cdn.example.com/plots/ep1/cut-002.webp')
    expect(imageLines[2]).toContain('cdn.example.com/plots/ep1/cut-003.webp')

    // HR separator exists
    expect(lines).toContain('---')

    // Transcript section after HR
    const hrIdx = lines.indexOf('---')
    const transcriptSection = lines.slice(hrIdx).join('\n')
    expect(transcriptSection).toContain('## Transcript')
    expect(transcriptSection).toContain('### cut-001')
    expect(transcriptSection).toContain('### cut-002')
    expect(transcriptSection).toContain('### cut-003')
    expect(transcriptSection).toContain('SFX: WHOOSH')
  })
})
