// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exportSingleCut, exportPlot } from '../exportPipeline'
import type { Cut } from '../CutList'
import type { PlottoonTerminal } from '../env'

function makeBase64(sizeBytes: number): string {
  const chars = Math.ceil((sizeBytes * 4) / 3)
  return 'A'.repeat(chars)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-05-16T12:00:00.000Z'))

  window.plottoon = {
    version: '1.0.0',
    terminal: {} as PlottoonTerminal,
    fs: {
      openProject: vi.fn(),
      listProjects: vi.fn().mockResolvedValue([]),
      readProjectFile: vi.fn().mockResolvedValue(''),
      writeProjectFile: vi.fn().mockResolvedValue(undefined),
      writeProjectFileBinary: vi.fn().mockResolvedValue(undefined),
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
  vi.useRealTimers()
})

// Mock document.createElement to return a canvas with a mock context
function mockCanvasCreation(dataUrl: string) {
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
    width: 320,
    height: 480,
    getContext: vi.fn().mockReturnValue(mockCtx),
    toDataURL: vi.fn().mockReturnValue(dataUrl)
  } as unknown as HTMLCanvasElement)
}

describe('exportSingleCut', () => {
  it('exports a cut and writes image + metadata files', async () => {
    const small = makeBase64(500_000)
    mockCanvasCreation(`data:image/webp;base64,${small}`)

    const cut: Cut = { id: 'cut-001', status: 'draft' }
    const result = await exportSingleCut({
      cut,
      projectId: 'proj_1',
      plotSlug: 'episode-1'
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.meta.cutId).toBe('cut-001')
      expect(result.meta.mimeType).toBe('image/webp')
      expect(result.meta.byteSize).toBeGreaterThan(0)
      expect(result.meta.hash).toMatch(/^[0-9a-f]{8}$/)
      expect(result.meta.path).toContain('exports/cut-001')
    }

    // Image written via binary API
    const binaryCalls = (window.plottoon.fs.writeProjectFileBinary as ReturnType<typeof vi.fn>).mock
      .calls
    expect(binaryCalls).toHaveLength(1)
    expect(binaryCalls[0][1]).toEqual(
      expect.arrayContaining(['exports', expect.stringContaining('cut-001')])
    )
    // Metadata written via text API
    const textCalls = (window.plottoon.fs.writeProjectFile as ReturnType<typeof vi.fn>).mock.calls
    expect(textCalls).toHaveLength(1)
    expect(textCalls[0][1]).toEqual(expect.arrayContaining(['exports', 'cut-001.meta.json']))
  })

  it('blocks export of protected cut without force', async () => {
    const cut: Cut = { id: 'cut-001', status: 'exported' }
    const result = await exportSingleCut({
      cut,
      projectId: 'proj_1',
      plotSlug: 'ep1'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('cannot be overwritten')
      expect(result.cutId).toBe('cut-001')
    }
    // Should not write anything
    expect(window.plottoon.fs.writeProjectFile).not.toHaveBeenCalled()
  })

  it('allows export of protected cut with forceOverwrite', async () => {
    const small = makeBase64(500_000)
    mockCanvasCreation(`data:image/webp;base64,${small}`)

    const cut: Cut = { id: 'cut-001', status: 'exported' }
    const result = await exportSingleCut({
      cut,
      projectId: 'proj_1',
      plotSlug: 'ep1',
      forceOverwrite: true
    })

    expect(result.ok).toBe(true)
    expect(window.plottoon.fs.writeProjectFileBinary).toHaveBeenCalled()
  })

  it('writes metadata with correct dimensions, hash, and timestamp', async () => {
    const small = makeBase64(500_000)
    mockCanvasCreation(`data:image/webp;base64,${small}`)

    const cut: Cut = { id: 'cut-001', canvasOverrides: { width: 800, height: 1200 } }
    const result = await exportSingleCut({
      cut,
      projectId: 'proj_1',
      plotSlug: 'ep1'
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.meta.width).toBe(800)
      expect(result.meta.height).toBe(1200)
      expect(result.meta.exportedAt).toBe('2026-05-16T12:00:00.000Z')
    }
  })
})

describe('exportPlot', () => {
  it('exports multiple cuts and writes manifest', async () => {
    const small = makeBase64(500_000)
    mockCanvasCreation(`data:image/webp;base64,${small}`)

    const cuts: Cut[] = [
      { id: 'cut-001', status: 'draft' },
      { id: 'cut-002', status: 'draft' }
    ]

    const result = await exportPlot({
      cuts,
      projectId: 'proj_1',
      plotSlug: 'ep1'
    })

    // 2 binary image writes + 2 text meta writes + 1 text manifest
    expect(result.results).toHaveLength(2)
    expect(result.results.every((r) => r.ok)).toBe(true)
    expect(result.manifest).not.toBeNull()
    expect(result.manifest!.cuts).toHaveLength(2)
    expect(result.manifest!.version).toBe(1)

    const binaryCalls = (window.plottoon.fs.writeProjectFileBinary as ReturnType<typeof vi.fn>).mock
      .calls
    expect(binaryCalls).toHaveLength(2) // 2 images
    const textCalls = (window.plottoon.fs.writeProjectFile as ReturnType<typeof vi.fn>).mock.calls
    expect(textCalls).toHaveLength(3) // 2 metas + 1 manifest
  })

  it('skips protected cuts and exports unprotected ones', async () => {
    const small = makeBase64(500_000)
    mockCanvasCreation(`data:image/webp;base64,${small}`)

    const cuts: Cut[] = [
      { id: 'cut-001', status: 'exported' },
      { id: 'cut-002', status: 'draft' }
    ]

    const result = await exportPlot({
      cuts,
      projectId: 'proj_1',
      plotSlug: 'ep1'
    })

    expect(result.results[0].ok).toBe(false)
    expect(result.results[1].ok).toBe(true)
    expect(result.manifest!.cuts).toHaveLength(1)
    expect(result.manifest!.cuts[0].cutId).toBe('cut-002')
  })

  it('does not write manifest when all cuts fail', async () => {
    const cuts: Cut[] = [
      { id: 'cut-001', status: 'exported' },
      { id: 'cut-002', status: 'published' }
    ]

    const result = await exportPlot({
      cuts,
      projectId: 'proj_1',
      plotSlug: 'ep1'
    })

    expect(result.results.every((r) => !r.ok)).toBe(true)
    expect(result.manifest).toBeNull()
    expect(window.plottoon.fs.writeProjectFile).not.toHaveBeenCalled()
  })
})
