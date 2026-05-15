import { describe, it, expect, vi } from 'vitest'
import { renderCut } from '../flattenRenderer'
import type { Cut } from '../CutList'

function createMockCtx() {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const record = (method: string) =>
    vi.fn((...args: unknown[]) => {
      calls.push({ method, args })
    })
  return {
    calls,
    ctx: {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textAlign: 'start' as CanvasTextAlign,
      textBaseline: 'alphabetic' as CanvasTextBaseline,
      fillRect: record('fillRect'),
      strokeRect: record('strokeRect'),
      fillText: record('fillText'),
      drawImage: record('drawImage'),
      save: record('save'),
      restore: record('restore'),
      beginPath: record('beginPath'),
      closePath: record('closePath'),
      moveTo: record('moveTo'),
      lineTo: record('lineTo'),
      arcTo: record('arcTo'),
      fill: record('fill'),
      stroke: record('stroke'),
      setLineDash: record('setLineDash')
    } as unknown as CanvasRenderingContext2D
  }
}

describe('renderCut', () => {
  it('renders background fill for a blank cut', () => {
    const { ctx, calls } = createMockCtx()
    const cut: Cut = { id: 'cut-001' }

    renderCut(ctx, cut)

    const fillRects = calls.filter((c) => c.method === 'fillRect')
    expect(fillRects.length).toBeGreaterThanOrEqual(1)
    expect(fillRects[0].args).toEqual([0, 0, 320, 480])
  })

  it('uses canvasOverrides for dimensions', () => {
    const { ctx, calls } = createMockCtx()
    const cut: Cut = { id: 'cut-001', canvasOverrides: { width: 800, height: 1200 } }

    renderCut(ctx, cut)

    const fillRects = calls.filter((c) => c.method === 'fillRect')
    expect(fillRects[0].args).toEqual([0, 0, 800, 1200])
  })

  it('uses custom background color', () => {
    const { ctx } = createMockCtx()
    const cut: Cut = {
      id: 'cut-001',
      canvasOverrides: { backgroundColor: '#111111' }
    }

    renderCut(ctx, cut)

    // fillStyle is set before fillRect
    expect(ctx.fillStyle).not.toBe('')
  })

  it('draws background image when provided', () => {
    const { ctx, calls } = createMockCtx()
    const cut: Cut = { id: 'cut-001' }
    const img = {} as HTMLImageElement

    renderCut(ctx, cut, { backgroundImage: img })

    const drawImages = calls.filter((c) => c.method === 'drawImage')
    expect(drawImages).toHaveLength(1)
    expect(drawImages[0].args[0]).toBe(img)
  })

  it('does not draw background image when null', () => {
    const { ctx, calls } = createMockCtx()
    const cut: Cut = { id: 'cut-001' }

    renderCut(ctx, cut, { backgroundImage: null })

    const drawImages = calls.filter((c) => c.method === 'drawImage')
    expect(drawImages).toHaveLength(0)
  })

  it('renders overlays in array order (z-index)', () => {
    const { ctx, calls } = createMockCtx()
    const cut: Cut = {
      id: 'cut-001',
      overlays: [
        {
          id: 'ovl-1',
          type: 'text',
          content: 'First',
          x: 10,
          y: 10,
          width: 100,
          height: 40,
          style: { background: '#ffffff' }
        },
        {
          id: 'ovl-2',
          type: 'text',
          content: 'Second',
          x: 20,
          y: 20,
          width: 100,
          height: 40,
          style: { background: '#ff0000' }
        }
      ]
    }

    renderCut(ctx, cut)

    // Each overlay triggers save/restore — verify order
    const saveRestorePairs = calls
      .map((c, i) => ({ ...c, idx: i }))
      .filter((c) => c.method === 'save' || c.method === 'restore')
    expect(saveRestorePairs.length).toBe(4) // 2 saves + 2 restores

    // First overlay's save should come before second overlay's save
    const saves = saveRestorePairs.filter((c) => c.method === 'save')
    expect(saves[0].idx).toBeLessThan(saves[1].idx)
  })

  it('renders overlay text content', () => {
    const { ctx, calls } = createMockCtx()
    const cut: Cut = {
      id: 'cut-001',
      overlays: [
        {
          id: 'ovl-1',
          type: 'text',
          content: 'Hello',
          x: 10,
          y: 10,
          width: 200,
          height: 60,
          style: { fontSize: '13px', padding: '8px 12px' }
        }
      ]
    }

    renderCut(ctx, cut)

    const fillTexts = calls.filter((c) => c.method === 'fillText')
    expect(fillTexts.length).toBeGreaterThanOrEqual(1)
    expect(fillTexts[0].args[0]).toBe('Hello')
  })

  it('renders overlay with border', () => {
    const { ctx, calls } = createMockCtx()
    const cut: Cut = {
      id: 'cut-001',
      overlays: [
        {
          id: 'ovl-1',
          type: 'text',
          content: '',
          x: 10,
          y: 10,
          width: 100,
          height: 40,
          style: { border: '2px solid #222222' }
        }
      ]
    }

    renderCut(ctx, cut)

    const strokeRects = calls.filter((c) => c.method === 'strokeRect')
    expect(strokeRects.length).toBeGreaterThanOrEqual(1)
  })

  it('renders overlay with dashed border', () => {
    const { ctx, calls } = createMockCtx()
    const cut: Cut = {
      id: 'cut-001',
      overlays: [
        {
          id: 'ovl-1',
          type: 'text',
          content: '',
          x: 10,
          y: 10,
          width: 100,
          height: 40,
          style: { border: '1px dashed #aaaaaa' }
        }
      ]
    }

    renderCut(ctx, cut)

    const setLineDash = calls.filter((c) => c.method === 'setLineDash')
    expect(setLineDash.length).toBeGreaterThanOrEqual(1)
    // First call should set a dash pattern
    expect((setLineDash[0].args[0] as number[]).length).toBeGreaterThan(0)
  })

  it('renders tail anchor triangle', () => {
    const { ctx, calls } = createMockCtx()
    const cut: Cut = {
      id: 'cut-001',
      overlays: [
        {
          id: 'ovl-1',
          type: 'text',
          content: '',
          x: 50,
          y: 50,
          width: 100,
          height: 40,
          tailAnchor: { x: 100, y: 120 },
          style: { background: '#ffffff' }
        }
      ]
    }

    renderCut(ctx, cut)

    // Tail draws moveTo, lineTo, lineTo, closePath, fill
    const moveTos = calls.filter((c) => c.method === 'moveTo')
    const lineTos = calls.filter((c) => c.method === 'lineTo')
    expect(moveTos.length).toBeGreaterThanOrEqual(1)
    expect(lineTos.length).toBeGreaterThanOrEqual(2)
  })

  it('renders cut with no overlays', () => {
    const { ctx, calls } = createMockCtx()
    const cut: Cut = { id: 'cut-001', overlays: [] }

    renderCut(ctx, cut)

    // Only background fill, no overlay save/restore
    const saves = calls.filter((c) => c.method === 'save')
    expect(saves).toHaveLength(0)
  })

  it('handles overlays with rounded border radius', () => {
    const { ctx, calls } = createMockCtx()
    const cut: Cut = {
      id: 'cut-001',
      overlays: [
        {
          id: 'ovl-1',
          type: 'text',
          content: '',
          x: 10,
          y: 10,
          width: 180,
          height: 60,
          style: { background: '#ffffff', borderRadius: '16px', border: '2px solid #222' }
        }
      ]
    }

    renderCut(ctx, cut)

    // roundRect uses arcTo
    const arcTos = calls.filter((c) => c.method === 'arcTo')
    expect(arcTos.length).toBeGreaterThanOrEqual(4) // 4 corners x 2 (fill + stroke)
  })
})
