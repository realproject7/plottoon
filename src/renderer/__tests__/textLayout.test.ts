import { describe, it, expect } from 'vitest'
import {
  wrapText,
  computeLayout,
  detectOverflow,
  detectAllOverflows,
  hasUnresolvedOverflow,
  parseLayoutConfig
} from '../textLayout'
import type { Overlay } from '../CutList'

function makeOverlay(
  content: string,
  width = 180,
  height = 60,
  style?: Record<string, string>
): Overlay {
  return { id: 'ovl-1', type: 'text', content, x: 0, y: 0, width, height, style }
}

describe('parseLayoutConfig', () => {
  it('returns defaults when no style provided', () => {
    const config = parseLayoutConfig()
    expect(config.fontSize).toBe(13)
    expect(config.lineHeight).toBe(1.4)
    expect(config.paddingX).toBeGreaterThan(0)
    expect(config.paddingY).toBeGreaterThan(0)
  })

  it('parses fontSize from style', () => {
    const config = parseLayoutConfig({ fontSize: '18px' })
    expect(config.fontSize).toBe(18)
  })

  it('parses padding from style', () => {
    const config = parseLayoutConfig({ padding: '10px 20px' })
    expect(config.paddingY).toBe(10)
    expect(config.paddingX).toBe(20)
  })

  it('uses single padding value for both axes', () => {
    const config = parseLayoutConfig({ padding: '16px' })
    expect(config.paddingY).toBe(16)
    expect(config.paddingX).toBe(16)
  })
})

describe('wrapText', () => {
  it('returns empty array for empty content', () => {
    expect(wrapText('', 100, 20)).toEqual([])
  })

  it('returns empty array for zero width', () => {
    expect(wrapText('Hello', 0, 20)).toEqual([])
  })

  it('keeps short text on one line', () => {
    expect(wrapText('Hello', 200, 30)).toEqual(['Hello'])
  })

  it('wraps text at word boundaries', () => {
    const lines = wrapText('Hello world this is a test', 100, 12)
    expect(lines.length).toBeGreaterThan(1)
    lines.forEach((line) => {
      expect(line.length).toBeLessThanOrEqual(12)
    })
  })

  it('breaks long words that exceed line width', () => {
    const lines = wrapText('Supercalifragilisticexpialidocious', 100, 10)
    expect(lines.length).toBeGreaterThan(1)
    lines.forEach((line) => {
      expect(line.length).toBeLessThanOrEqual(10)
    })
  })

  it('handles whitespace-only content', () => {
    expect(wrapText('   ', 100, 20)).toEqual([])
  })

  it('handles single word', () => {
    expect(wrapText('Word', 200, 20)).toEqual(['Word'])
  })

  it('handles multiple spaces between words', () => {
    const lines = wrapText('Hello    world', 200, 30)
    expect(lines).toEqual(['Hello world'])
  })
})

describe('computeLayout', () => {
  it('computes lines for content that fits', () => {
    const overlay = makeOverlay('Hi', 180, 60, { fontSize: '13px', padding: '8px 12px' })
    const result = computeLayout(overlay)
    expect(result.lines.length).toBe(1)
    expect(result.overflow).toBe(false)
  })

  it('detects overflow when text exceeds bounds', () => {
    const overlay = makeOverlay(
      'This is a very long text that should definitely overflow the small overlay bounds and wrap many times',
      100,
      30,
      { fontSize: '13px', padding: '4px' }
    )
    const result = computeLayout(overlay)
    expect(result.overflow).toBe(true)
    expect(result.lines.length).toBeGreaterThan(1)
  })

  it('returns correct y positions for wrapped lines', () => {
    const overlay = makeOverlay('Line one and line two', 100, 200, {
      fontSize: '13px',
      padding: '8px 12px'
    })
    const result = computeLayout(overlay)
    if (result.lines.length > 1) {
      expect(result.lines[1].y).toBeGreaterThan(result.lines[0].y)
    }
  })

  it('handles empty content', () => {
    const overlay = makeOverlay('', 180, 60)
    const result = computeLayout(overlay)
    expect(result.lines).toEqual([])
    expect(result.overflow).toBe(false)
  })
})

describe('detectOverflow', () => {
  it('returns false for empty content', () => {
    expect(detectOverflow(makeOverlay(''))).toBe(false)
  })

  it('returns false when text fits', () => {
    expect(detectOverflow(makeOverlay('Short', 200, 100))).toBe(false)
  })

  it('returns true when text overflows', () => {
    expect(
      detectOverflow(
        makeOverlay(
          'This text is way too long to fit in this tiny overlay and will certainly overflow the bounds',
          80,
          20
        )
      )
    ).toBe(true)
  })
})

describe('detectAllOverflows', () => {
  it('returns overflow status for each overlay', () => {
    const overlays: Overlay[] = [
      makeOverlay('Short', 200, 100),
      makeOverlay(
        'This is extremely long text that will overflow this small overlay easily',
        80,
        20
      )
    ]
    overlays[0].id = 'ovl-1'
    overlays[1].id = 'ovl-2'

    const results = detectAllOverflows(overlays)
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({ overlayId: 'ovl-1', overflow: false })
    expect(results[1]).toEqual({ overlayId: 'ovl-2', overflow: true })
  })

  it('returns empty array for no overlays', () => {
    expect(detectAllOverflows([])).toEqual([])
  })
})

describe('hasUnresolvedOverflow', () => {
  it('returns false when no overlays overflow', () => {
    expect(hasUnresolvedOverflow([makeOverlay('OK', 200, 100)])).toBe(false)
  })

  it('returns true when any overlay overflows', () => {
    const overlays: Overlay[] = [
      makeOverlay('Short', 200, 100),
      makeOverlay(
        'This extremely long text will definitely overflow the tiny bounds of this overlay',
        80,
        20
      )
    ]
    expect(hasUnresolvedOverflow(overlays)).toBe(true)
  })

  it('returns false for empty array', () => {
    expect(hasUnresolvedOverflow([])).toBe(false)
  })
})
