import { describe, it, expect } from 'vitest'
import { generatePlotText } from '../services/plotTextGenerator'
import { createEmptyCutsFile } from '../services/cutsSchema'
import type { CutsFile } from '../services/cutsSchema'

function sampleCutsFile(): CutsFile {
  return {
    version: 1,
    plotTitle: 'Episode 1',
    synopsis: 'The hero awakens.',
    cuts: [
      {
        id: 'cut-001',
        order: 0,
        dialogue: 'Where am I?',
        direction: 'Close-up on face, eyes opening slowly',
        imageState: {
          status: 'done',
          path: 'assets/cut-001.png',
          prompt: 'anime close-up',
          seed: 42
        },
        overlays: [
          {
            id: 'ovl-1',
            type: 'text',
            content: 'Where am I?',
            x: 10,
            y: 20,
            width: 200,
            height: 40
          },
          { id: 'ovl-2', type: 'sfx', content: 'WHOOSH', x: 50, y: 100, width: 80, height: 30 }
        ]
      },
      {
        id: 'cut-002',
        order: 1,
        dialogue: '',
        direction: 'Wide shot of ruined city',
        imageState: {
          status: 'pending',
          path: null,
          prompt: null,
          seed: null
        },
        overlays: [],
        canvasOverrides: {
          width: 800,
          height: 1200,
          backgroundColor: '#111'
        }
      }
    ],
    publishState: {
      published: false,
      exportedAt: null,
      format: null
    }
  }
}

describe('generatePlotText', () => {
  it('includes title as heading', () => {
    const result = generatePlotText(sampleCutsFile())
    expect(result).toContain('# Episode 1')
  })

  it('includes synopsis as blockquote', () => {
    const result = generatePlotText(sampleCutsFile())
    expect(result).toContain('> The hero awakens.')
  })

  it('includes cut count and version', () => {
    const result = generatePlotText(sampleCutsFile())
    expect(result).toContain('**Cuts:** 2')
    expect(result).toContain('**Version:** 1')
  })

  it('includes direction for each cut', () => {
    const result = generatePlotText(sampleCutsFile())
    expect(result).toContain('**Direction:** Close-up on face, eyes opening slowly')
    expect(result).toContain('**Direction:** Wide shot of ruined city')
  })

  it('includes dialogue in quotes', () => {
    const result = generatePlotText(sampleCutsFile())
    expect(result).toContain('**Dialogue:** "Where am I?"')
  })

  it('omits dialogue section when empty', () => {
    const result = generatePlotText(sampleCutsFile())
    const cut2Section = result.split('### Cut 2')[1]
    expect(cut2Section).not.toContain('**Dialogue:**')
  })

  it('shows SFX overlays', () => {
    const result = generatePlotText(sampleCutsFile())
    expect(result).toContain('**SFX:**')
    expect(result).toContain('[SFX] "WHOOSH"')
  })

  it('shows text overlays', () => {
    const result = generatePlotText(sampleCutsFile())
    expect(result).toContain('**Overlays:**')
    expect(result).toContain('[Text] "Where am I?"')
  })

  it('shows canvas overrides', () => {
    const result = generatePlotText(sampleCutsFile())
    expect(result).toContain('**Canvas:** width=800, height=1200, bg=#111')
  })

  it('shows done image status with path', () => {
    const result = generatePlotText(sampleCutsFile())
    expect(result).toContain('Image: ✅ done (assets/cut-001.png)')
  })

  it('shows pending image status', () => {
    const result = generatePlotText(sampleCutsFile())
    expect(result).toContain('Image: ⬜ pending')
  })

  it('shows failed image status with error message', () => {
    const data = sampleCutsFile()
    data.cuts[0].imageState = {
      status: 'failed',
      path: null,
      prompt: 'test',
      seed: null,
      errorMessage: 'GPU out of memory'
    }
    const result = generatePlotText(data)
    expect(result).toContain('Image: ❌ failed — GPU out of memory')
  })

  it('shows generating image status', () => {
    const data = sampleCutsFile()
    data.cuts[0].imageState = {
      status: 'generating',
      path: null,
      prompt: 'test',
      seed: 1
    }
    const result = generatePlotText(data)
    expect(result).toContain('Image: ⏳ generating')
  })

  it('shows publish status', () => {
    const result = generatePlotText(sampleCutsFile())
    expect(result).toContain('## Publish Status')
    expect(result).toContain('- Published: no')
  })

  it('shows publish details when published', () => {
    const data = sampleCutsFile()
    data.publishState = {
      published: true,
      exportedAt: '2026-01-15T10:00:00Z',
      format: 'webtoon-vertical'
    }
    const result = generatePlotText(data)
    expect(result).toContain('- Published: yes')
    expect(result).toContain('- Exported at: 2026-01-15T10:00:00Z')
    expect(result).toContain('- Format: webtoon-vertical')
  })

  it('shows empty state for zero cuts', () => {
    const data = createEmptyCutsFile('Empty Plot')
    const result = generatePlotText(data)
    expect(result).toContain('*No cuts defined yet.*')
    expect(result).toContain('**Cuts:** 0')
  })

  it('is deterministic — same input produces identical output', () => {
    const data = sampleCutsFile()
    const first = generatePlotText(data)
    const second = generatePlotText(data)
    expect(first).toBe(second)
  })

  it('sorts cuts by order regardless of array position', () => {
    const data = sampleCutsFile()
    data.cuts = [data.cuts[1], data.cuts[0]]
    const result = generatePlotText(data)
    const cut1Pos = result.indexOf('### Cut 1')
    const cut2Pos = result.indexOf('### Cut 2')
    expect(cut1Pos).toBeLessThan(cut2Pos)
  })

  it('uses cut IDs in headings', () => {
    const result = generatePlotText(sampleCutsFile())
    expect(result).toContain('### Cut 1 — `cut-001`')
    expect(result).toContain('### Cut 2 — `cut-002`')
  })

  it('omits synopsis blockquote when synopsis is empty', () => {
    const data = createEmptyCutsFile('No Synopsis', '')
    const result = generatePlotText(data)
    expect(result).not.toContain('> ')
  })
})
