// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { computeStripDimensions, renderPreviewStrip, generatePreviewStrip } from '../previewStrip'
import type { StripCutInput } from '../previewStrip'
import type { Cut } from '../CutList'
import type { PlottoonTerminal } from '../env'

function makeCut(id: string, width?: number, height?: number): Cut {
  return {
    id,
    canvasOverrides: width || height ? { width, height } : undefined
  }
}

function mockCanvasCreation() {
  const mockCtx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'start' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arcTo: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn()
  }
  vi.spyOn(document, 'createElement').mockReturnValue({
    width: 0,
    height: 0,
    getContext: vi.fn().mockReturnValue(mockCtx),
    toDataURL: vi.fn().mockReturnValue('data:image/png;base64,AAAA')
  } as unknown as HTMLCanvasElement)
  return mockCtx
}

beforeEach(() => {
  window.plottoon = {
    version: '1.0.0',
    terminal: {} as PlottoonTerminal,
    fs: {
      openProject: vi.fn(),
      listProjects: vi.fn().mockResolvedValue([]),
      readProjectFile: vi.fn().mockResolvedValue(''),
      writeProjectFile: vi.fn().mockResolvedValue(undefined),
      listProjectDir: vi.fn().mockResolvedValue([]),
      projectFileExists: vi.fn().mockResolvedValue(false),
      resolveProjectFilePath: vi.fn().mockResolvedValue('/mock/path'),
      readAppConfig: vi.fn(),
      writeAppConfig: vi.fn(),
      importCleanImage: vi.fn(),
      detectCleanImages: vi.fn(),
      registerAgentFile: vi.fn()
    },
    project: {} as never,
    capability: {} as never,
    actionLog: {} as never
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('computeStripDimensions', () => {
  it('computes total height from stacked cuts', () => {
    const cuts = [makeCut('c1', 320, 480), makeCut('c2', 320, 600)]
    const { width, totalHeight, offsets } = computeStripDimensions(cuts)
    expect(width).toBe(320)
    expect(totalHeight).toBe(1080)
    expect(offsets).toEqual([0, 480])
  })

  it('uses max width across cuts', () => {
    const cuts = [makeCut('c1', 320, 480), makeCut('c2', 800, 480)]
    const { width } = computeStripDimensions(cuts)
    expect(width).toBe(800)
  })

  it('uses default dimensions when no overrides', () => {
    const cuts = [makeCut('c1'), makeCut('c2')]
    const { width, totalHeight } = computeStripDimensions(cuts)
    expect(width).toBe(320)
    expect(totalHeight).toBe(960)
  })

  it('returns defaults for empty array', () => {
    const { width, totalHeight, offsets } = computeStripDimensions([])
    expect(width).toBe(320)
    expect(totalHeight).toBe(0)
    expect(offsets).toEqual([])
  })
})

describe('renderPreviewStrip', () => {
  it('returns correct strip dimensions for multiple cuts', () => {
    mockCanvasCreation()
    const inputs: StripCutInput[] = [
      { cut: makeCut('c1', 320, 480) },
      { cut: makeCut('c2', 320, 600) }
    ]

    const result = renderPreviewStrip(inputs)
    expect(result.width).toBe(320)
    expect(result.height).toBe(1080)
    expect(result.cutCount).toBe(2)
  })

  it('returns canvas for single cut', () => {
    mockCanvasCreation()
    const inputs: StripCutInput[] = [{ cut: makeCut('c1') }]
    const result = renderPreviewStrip(inputs)
    expect(result.cutCount).toBe(1)
    expect(result.canvas).toBeDefined()
  })

  it('handles empty input', () => {
    mockCanvasCreation()
    const result = renderPreviewStrip([])
    expect(result.cutCount).toBe(0)
    expect(result.height).toBe(0)
  })
})

describe('generatePreviewStrip', () => {
  it('writes preview strip to exports folder', async () => {
    mockCanvasCreation()
    const inputs: StripCutInput[] = [{ cut: makeCut('c1') }]

    const result = await generatePreviewStrip(inputs, 'proj_1', 'episode-1')

    expect(result.path).toBe('plots/episode-1/exports/preview-strip.png')
    expect(result.cutCount).toBe(1)

    const writeCalls = (window.plottoon.fs.writeProjectFile as ReturnType<typeof vi.fn>).mock.calls
    expect(writeCalls).toHaveLength(1) // only the strip write
    const lastCall = writeCalls[0]
    expect(lastCall[1]).toEqual(['plots', 'episode-1', 'exports', 'preview-strip.png'])
  })

  it('does not interfere with individual cut export paths', async () => {
    mockCanvasCreation()
    const inputs: StripCutInput[] = [{ cut: makeCut('c1') }, { cut: makeCut('c2') }]

    const result = await generatePreviewStrip(inputs, 'proj_1', 'ep1')

    // Only writes preview-strip.png, not individual cut exports
    const writeCalls = (window.plottoon.fs.writeProjectFile as ReturnType<typeof vi.fn>).mock.calls
    const stripWrites = writeCalls.filter((c: unknown[]) =>
      (c[1] as string[]).includes('preview-strip.png')
    )
    expect(stripWrites).toHaveLength(1)
    expect(result.path).toContain('preview-strip.png')
  })
})
