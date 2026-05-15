// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import {
  checkExportCapabilities,
  checkFormat,
  checkFontRender,
  checkExportBlockers
} from '../exportChecks'
import type { Overlay } from '../CutList'

describe('checkExportBlockers', () => {
  it('returns empty when no overlays overflow', () => {
    const overlays: Overlay[] = [
      { id: 'ovl-1', type: 'text', content: 'OK', x: 0, y: 0, width: 200, height: 100 }
    ]
    expect(checkExportBlockers(overlays)).toEqual([])
  })

  it('returns text-overflow blocker when overflow exists', () => {
    const overlays: Overlay[] = [
      {
        id: 'ovl-1',
        type: 'text',
        content:
          'This extremely long text will definitely overflow the tiny bounds of this small overlay widget',
        x: 0,
        y: 0,
        width: 80,
        height: 20
      }
    ]
    const blockers = checkExportBlockers(overlays)
    expect(blockers).toHaveLength(1)
    expect(blockers[0].type).toBe('text-overflow')
  })

  it('returns empty for empty overlay list', () => {
    expect(checkExportBlockers([])).toEqual([])
  })
})

describe('checkExportCapabilities', () => {
  it('returns a result with all expected fields', () => {
    const result = checkExportCapabilities()
    expect(result).toHaveProperty('webp')
    expect(result).toHaveProperty('jpeg')
    expect(result).toHaveProperty('fontRender')
    expect(result).toHaveProperty('fontSample')
    expect(typeof result.webp).toBe('boolean')
    expect(typeof result.jpeg).toBe('boolean')
    expect(typeof result.fontRender).toBe('boolean')
    expect(result.fontSample).toBe('PlotToon')
  })
})

describe('checkFormat', () => {
  it('returns true when toDataURL returns matching MIME type', () => {
    const canvas = {
      toDataURL: vi.fn().mockReturnValue('data:image/webp;base64,AAAA')
    } as unknown as HTMLCanvasElement
    expect(checkFormat(canvas, 'image/webp')).toBe(true)
  })

  it('returns true for JPEG when toDataURL returns jpeg MIME', () => {
    const canvas = {
      toDataURL: vi.fn().mockReturnValue('data:image/jpeg;base64,AAAA')
    } as unknown as HTMLCanvasElement
    expect(checkFormat(canvas, 'image/jpeg')).toBe(true)
  })

  it('returns false when toDataURL returns different MIME type', () => {
    const canvas = {
      toDataURL: vi.fn().mockReturnValue('data:image/png;base64,AAAA')
    } as unknown as HTMLCanvasElement
    expect(checkFormat(canvas, 'image/webp')).toBe(false)
  })

  it('returns false when toDataURL returns null', () => {
    const canvas = {
      toDataURL: vi.fn().mockReturnValue(null)
    } as unknown as HTMLCanvasElement
    expect(checkFormat(canvas, 'image/webp')).toBe(false)
  })

  it('returns false when toDataURL throws', () => {
    const canvas = {
      toDataURL: vi.fn().mockImplementation(() => {
        throw new Error('not supported')
      })
    } as unknown as HTMLCanvasElement
    expect(checkFormat(canvas, 'image/webp')).toBe(false)
  })
})

describe('checkFontRender', () => {
  it('returns true when fillText produces non-blank pixels', () => {
    const pixels = new Uint8ClampedArray(64 * 24 * 4)
    pixels[3] = 255
    const ctx = {
      clearRect: vi.fn(),
      fillText: vi.fn(),
      getImageData: vi.fn().mockReturnValue({ data: pixels }),
      fillStyle: '',
      font: ''
    }
    const canvas = {
      width: 64,
      height: 24,
      getContext: vi.fn().mockReturnValue(ctx)
    } as unknown as HTMLCanvasElement

    expect(checkFontRender(canvas)).toBe(true)
    expect(ctx.fillText).toHaveBeenCalledWith('PlotToon', 4, 18)
  })

  it('returns false when all pixels are blank', () => {
    const pixels = new Uint8ClampedArray(64 * 24 * 4)
    const ctx = {
      clearRect: vi.fn(),
      fillText: vi.fn(),
      getImageData: vi.fn().mockReturnValue({ data: pixels }),
      fillStyle: '',
      font: ''
    }
    const canvas = {
      width: 64,
      height: 24,
      getContext: vi.fn().mockReturnValue(ctx)
    } as unknown as HTMLCanvasElement

    expect(checkFontRender(canvas)).toBe(false)
  })

  it('returns false when getContext returns null', () => {
    const canvas = {
      width: 64,
      height: 24,
      getContext: vi.fn().mockReturnValue(null)
    } as unknown as HTMLCanvasElement

    expect(checkFontRender(canvas)).toBe(false)
  })

  it('sets correct font and fill style before rendering', () => {
    const pixels = new Uint8ClampedArray(64 * 24 * 4)
    pixels[7] = 128
    const ctx = {
      clearRect: vi.fn(),
      fillText: vi.fn(),
      getImageData: vi.fn().mockReturnValue({ data: pixels }),
      fillStyle: '',
      font: ''
    }
    const canvas = {
      width: 64,
      height: 24,
      getContext: vi.fn().mockReturnValue(ctx)
    } as unknown as HTMLCanvasElement

    checkFontRender(canvas)
    expect(ctx.fillStyle).toBe('#000000')
    expect(ctx.font).toBe('16px sans-serif')
  })
})
