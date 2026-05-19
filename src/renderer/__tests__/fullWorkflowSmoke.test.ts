// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fixture from '../../main/__tests__/fixtures/paper-chair-pilot.json'
import { exportPlot } from '../exportPipeline'
import type { ExportMeta } from '../exportMetadata'
import { renderPreviewStrip, computeStripDimensions } from '../previewStrip'
import {
  generatePublishMarkdown,
  generateTranscript,
  generateTranscriptText,
  generateAltText
} from '../publishGenerator'
import { buildTranscriptArtifact, transcriptCoverage, hasAltTextForAll } from '../transcriptArtifact'
import { validatePublishReadiness } from '../publishReadiness'
import {
  buildCartoonPayload,
  validatePayload,
  publishCartoon
} from '../cartoonPublish'
import type { Cut } from '../CutList'
import type { PlottoonTerminal } from '../env'

const PLOT_SLUG = 'seoul-in-all-this-noise'
const PLOT_TITLE = fixture.plots[PLOT_SLUG].plotTitle

function loadPilotCuts(): Cut[] {
  return fixture.plots[PLOT_SLUG].cuts.map((c) => ({
    ...c,
    status: 'approved',
    imageState: { ...c.imageState, status: 'done', path: `/mock/assets/${c.id}/clean-v001.webp` },
    overlays: (c.overlays ?? []).map((o) => ({
      ...o,
      height: Math.max(o.height, 80)
    }))
  }))
}

function makeSmallBase64(): string {
  return 'A'.repeat(Math.ceil((500_000 * 4) / 3))
}

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

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-05-19T12:00:00.000Z'))

  window.plottoon = {
    version: '1.0.0',
    terminal: {} as PlottoonTerminal,
    fs: {
      openProject: vi.fn(),
      listProjects: vi.fn().mockResolvedValue([]),
      readProjectFile: vi.fn().mockResolvedValue(''),
      writeProjectFile: vi.fn().mockResolvedValue(undefined),
      writeProjectFileBinary: vi.fn().mockResolvedValue(undefined),
      regeneratePlotText: vi.fn().mockResolvedValue(undefined),
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

describe('Full local workflow smoke test (Paper Chair pilot)', () => {
  describe('Phase 1: Cut planning from fixture', () => {
    it('loads 5 cuts from pilot fixture', () => {
      const cuts = loadPilotCuts()
      expect(cuts).toHaveLength(5)
      expect(cuts.every((c) => c.status === 'approved')).toBe(true)
    })

    it('all cuts have unique ordered ids', () => {
      const cuts = loadPilotCuts()
      const ids = cuts.map((c) => c.id)
      expect(new Set(ids).size).toBe(5)
      for (let i = 0; i < cuts.length; i++) {
        expect(cuts[i].id).toBe(`cut-00${i + 1}`)
      }
    })

    it('all cuts have done imageState after mock import', () => {
      const cuts = loadPilotCuts()
      for (const cut of cuts) {
        expect(cut.imageState?.status).toBe('done')
        expect(cut.imageState?.path).toContain(cut.id)
      }
    })
  })

  describe('Phase 2: Export pipeline', () => {
    it('exports all 5 cuts under 1MB each', async () => {
      const small = makeSmallBase64()
      mockCanvasCreation(`data:image/webp;base64,${small}`)
      const cuts = loadPilotCuts()

      const result = await exportPlot({
        cuts,
        projectId: 'paper-chair',
        plotSlug: PLOT_SLUG,
        forceOverwrite: true
      })

      expect(result.results).toHaveLength(5)
      expect(result.results.every((r) => r.ok)).toBe(true)
      for (const r of result.results) {
        if (r.ok) {
          expect(r.meta.byteSize).toBeLessThanOrEqual(1_048_576)
          expect(r.meta.byteSize).toBeGreaterThan(0)
        }
      }
    })

    it('produces a manifest with all 5 cuts', async () => {
      const small = makeSmallBase64()
      mockCanvasCreation(`data:image/webp;base64,${small}`)
      const cuts = loadPilotCuts()

      const result = await exportPlot({
        cuts,
        projectId: 'paper-chair',
        plotSlug: PLOT_SLUG,
        forceOverwrite: true
      })

      expect(result.manifest).not.toBeNull()
      expect(result.manifest!.cuts).toHaveLength(5)
      expect(result.manifest!.version).toBe(1)
    })

    it('writes 5 binary image files and 5 meta files plus manifest', async () => {
      const small = makeSmallBase64()
      mockCanvasCreation(`data:image/webp;base64,${small}`)
      const cuts = loadPilotCuts()

      await exportPlot({
        cuts,
        projectId: 'paper-chair',
        plotSlug: PLOT_SLUG,
        forceOverwrite: true
      })

      const binaryCalls = (
        window.plottoon.fs.writeProjectFileBinary as ReturnType<typeof vi.fn>
      ).mock.calls
      expect(binaryCalls).toHaveLength(5)

      const textCalls = (
        window.plottoon.fs.writeProjectFile as ReturnType<typeof vi.fn>
      ).mock.calls
      expect(textCalls).toHaveLength(6) // 5 metas + 1 manifest
    })
  })

  describe('Phase 3: Preview strip', () => {
    it('computes correct strip dimensions for 5 cuts', () => {
      const cuts = loadPilotCuts()
      const dims = computeStripDimensions(cuts)
      expect(dims.width).toBe(320)
      expect(dims.totalHeight).toBe(480 * 5)
      expect(dims.offsets).toHaveLength(5)
      expect(dims.offsets[0]).toBe(0)
      expect(dims.offsets[4]).toBe(480 * 4)
    })

    it('renders preview strip canvas from all cuts', () => {
      mockCanvasCreation('data:image/png;base64,AAAA')
      const cuts = loadPilotCuts()
      const inputs = cuts.map((cut) => ({ cut }))
      const result = renderPreviewStrip(inputs)

      expect(result.cutCount).toBe(5)
      expect(result.width).toBe(320)
      expect(result.height).toBe(480 * 5)
    })
  })

  describe('Phase 4: Markdown and transcript generation', () => {
    it('generates publish markdown with placeholder URLs in dry-run', () => {
      const cuts = loadPilotCuts()
      const urls = cuts.map((c) => ({ cutId: c.id, url: '' }))
      const md = generatePublishMarkdown({
        cuts,
        urls,
        plotTitle: PLOT_TITLE,
        dryRun: true,
        includeTranscript: true
      })

      expect(md).toContain(`# ${PLOT_TITLE}`)
      expect(md).toContain('![')
      expect(md).toContain('## Transcript')
      for (const cut of cuts) {
        expect(md).toContain(cut.id)
      }
    })

    it('generates transcript entries for all 5 cuts', () => {
      const cuts = loadPilotCuts()
      const transcript = generateTranscript(cuts)

      expect(transcript).toHaveLength(5)
      expect(transcript[0].dialogue).toBe('Placeholder dialogue line one.')
      expect(transcript[1].narration).toBe('Placeholder narration for cut two.')
      expect(transcript[2].sfx).toEqual(['CHATTER'])
    })

    it('generates human-readable transcript text', () => {
      const cuts = loadPilotCuts()
      const text = generateTranscriptText(cuts)

      expect(text).toContain('[cut-001]')
      expect(text).toContain('Dialogue: Placeholder dialogue line one.')
      expect(text).toContain('Narration: Placeholder narration for cut two.')
      expect(text).toContain('SFX: CHATTER')
    })

    it('generates alt text for each cut', () => {
      const cuts = loadPilotCuts()
      for (const cut of cuts) {
        const alt = generateAltText(cut)
        expect(alt).not.toBe(cut.id)
        expect(alt.length).toBeGreaterThan(10)
      }
    })
  })

  describe('Phase 5: Transcript artifact', () => {
    it('builds transcript artifact with coverage for all cuts', () => {
      const cuts = loadPilotCuts()
      const artifact = buildTranscriptArtifact(cuts, PLOT_TITLE)

      expect(artifact.plotTitle).toBe(PLOT_TITLE)
      expect(artifact.entries).toHaveLength(5)
      expect(artifact.generatedAt).toBe('2026-05-19T12:00:00.000Z')
    })

    it('reports transcript coverage with content and alt text', () => {
      const cuts = loadPilotCuts()
      const artifact = buildTranscriptArtifact(cuts, PLOT_TITLE)
      const coverage = transcriptCoverage(artifact)

      expect(coverage.total).toBe(5)
      expect(coverage.withContent).toBeGreaterThanOrEqual(3)
      expect(hasAltTextForAll(artifact)).toBe(true)
    })
  })

  describe('Phase 6: Publish readiness', () => {
    it('reports ready when all cuts are approved with mock exports', async () => {
      const small = makeSmallBase64()
      mockCanvasCreation(`data:image/webp;base64,${small}`)
      const cuts = loadPilotCuts()

      const result = await exportPlot({
        cuts,
        projectId: 'paper-chair',
        plotSlug: PLOT_SLUG,
        forceOverwrite: true
      })

      const metas: ExportMeta[] = result.results
        .filter((r): r is { ok: true; meta: ExportMeta } => r.ok)
        .map((r) => r.meta)

      const readiness = validatePublishReadiness(cuts, metas, {
        contentRating: 'all-ages'
      })

      expect(readiness.ready).toBe(true)
      const blocks = readiness.checks.filter((c) => c.level === 'block')
      expect(blocks).toHaveLength(0)
    })

    it('all exported images pass size check', async () => {
      const small = makeSmallBase64()
      mockCanvasCreation(`data:image/webp;base64,${small}`)
      const cuts = loadPilotCuts()

      const result = await exportPlot({
        cuts,
        projectId: 'paper-chair',
        plotSlug: PLOT_SLUG,
        forceOverwrite: true
      })

      const metas: ExportMeta[] = result.results
        .filter((r): r is { ok: true; meta: ExportMeta } => r.ok)
        .map((r) => r.meta)

      for (const meta of metas) {
        expect(meta.byteSize).toBeLessThanOrEqual(1_048_576)
      }
    })
  })

  describe('Phase 7: Mock publish (dry-run)', () => {
    it('builds a valid cartoon payload', () => {
      const cuts = loadPilotCuts()
      const urls = cuts.map((c) => ({
        cutId: c.id,
        url: `https://plotlink.example/mock/${c.id}.webp`
      }))

      const payload = buildCartoonPayload(cuts, urls, {
        type: 'new',
        title: PLOT_TITLE
      }, {
        plotTitle: PLOT_TITLE,
        isDryRun: false,
        includeTranscript: false
      })

      expect(payload.contentType).toBe('cartoon')
      expect(payload.imageCount).toBe(5)
      expect(payload.plotTitle).toBe(PLOT_TITLE)
      expect(payload.markdown).toContain(`# ${PLOT_TITLE}`)

      const errors = validatePayload(payload)
      expect(errors).toHaveLength(0)
    })

    it('executes mock publish successfully', async () => {
      const cuts = loadPilotCuts()
      const urls = cuts.map((c) => ({
        cutId: c.id,
        url: `https://plotlink.example/mock/${c.id}.webp`
      }))

      const payload = buildCartoonPayload(cuts, urls, {
        type: 'new',
        title: PLOT_TITLE
      }, {
        plotTitle: PLOT_TITLE,
        isDryRun: true,
        includeTranscript: false
      })

      const result = await publishCartoon(payload, { mode: 'mock' })

      expect(result.success).toBe(true)
      expect(result.isDryRun).toBe(true)
      expect(result.publishId).toMatch(/^mock-pub-/)
      expect(result.storylineId).toMatch(/^mock-storyline-/)
      expect(result.plotUrl).toContain('plotlink.example')
    })

    it('dry-run payload validates without real URLs', () => {
      const cuts = loadPilotCuts()
      const urls = cuts.map((c) => ({ cutId: c.id, url: '' }))

      const payload = buildCartoonPayload(cuts, urls, {
        type: 'new',
        title: PLOT_TITLE
      }, {
        plotTitle: PLOT_TITLE,
        isDryRun: true
      })

      const errors = validatePayload(payload)
      expect(errors).toHaveLength(0)
    })

    it('persist callback is invoked on mock publish', async () => {
      const cuts = loadPilotCuts()
      const urls = cuts.map((c) => ({
        cutId: c.id,
        url: `https://plotlink.example/mock/${c.id}.webp`
      }))

      const payload = buildCartoonPayload(cuts, urls, {
        type: 'new',
        title: PLOT_TITLE
      }, {
        plotTitle: PLOT_TITLE,
        isDryRun: true
      })

      const persistFn = vi.fn().mockResolvedValue(undefined)
      await publishCartoon(payload, { mode: 'mock', persist: persistFn })

      expect(persistFn).toHaveBeenCalledTimes(1)
      expect(persistFn.mock.calls[0][0].success).toBe(true)
    })
  })

  describe('End-to-end: full pipeline integration', () => {
    it('runs the complete workflow from fixture to mock publish', async () => {
      const small = makeSmallBase64()
      mockCanvasCreation(`data:image/webp;base64,${small}`)

      // 1. Load and prepare cuts
      const cuts = loadPilotCuts()
      expect(cuts).toHaveLength(5)

      // 2. Export all cuts
      const exportResult = await exportPlot({
        cuts,
        projectId: 'paper-chair',
        plotSlug: PLOT_SLUG,
        forceOverwrite: true
      })
      expect(exportResult.results.every((r) => r.ok)).toBe(true)
      expect(exportResult.manifest).not.toBeNull()

      const metas: ExportMeta[] = exportResult.results
        .filter((r): r is { ok: true; meta: ExportMeta } => r.ok)
        .map((r) => r.meta)

      // 3. Verify all exports under 1MB
      for (const meta of metas) {
        expect(meta.byteSize).toBeLessThanOrEqual(1_048_576)
      }

      // 4. Preview strip dimensions
      const dims = computeStripDimensions(cuts)
      expect(dims.totalHeight).toBe(480 * 5)

      // 5. Generate markdown (dry-run)
      const urls = cuts.map((c) => ({ cutId: c.id, url: `[PLACEHOLDER:${c.id}]` }))
      const md = generatePublishMarkdown({
        cuts,
        urls,
        plotTitle: PLOT_TITLE,
        dryRun: true,
        includeTranscript: true
      })
      expect(md).toContain(`# ${PLOT_TITLE}`)

      // 6. Generate transcript
      const transcript = generateTranscript(cuts)
      expect(transcript).toHaveLength(5)
      const text = generateTranscriptText(cuts)
      expect(text.length).toBeGreaterThan(0)

      // 7. Build transcript artifact
      const artifact = buildTranscriptArtifact(cuts, PLOT_TITLE)
      expect(artifact.entries).toHaveLength(5)
      const coverage = transcriptCoverage(artifact)
      expect(coverage.withContent).toBeGreaterThanOrEqual(3)

      // 8. Readiness check
      const readiness = validatePublishReadiness(cuts, metas, {
        contentRating: 'all-ages'
      })
      expect(readiness.ready).toBe(true)

      // 9. Mock publish
      const mockUrls = cuts.map((c) => ({
        cutId: c.id,
        url: `https://plotlink.example/mock/${c.id}.webp`
      }))
      const payload = buildCartoonPayload(cuts, mockUrls, {
        type: 'new',
        title: PLOT_TITLE
      }, {
        plotTitle: PLOT_TITLE,
        isDryRun: true,
        includeTranscript: false
      })
      const publishResult = await publishCartoon(payload, { mode: 'mock' })
      expect(publishResult.success).toBe(true)
      expect(publishResult.isDryRun).toBe(true)
    })
  })
})
