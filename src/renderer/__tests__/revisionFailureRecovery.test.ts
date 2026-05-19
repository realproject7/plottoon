// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fixture from '../../main/__tests__/fixtures/paper-chair-pilot.json'
import {
  setStatus,
  addOverlay,
  deleteOverlay,
  moveOverlay,
  deleteCut,
  duplicateCut
} from '../cutMutations'
import { isAssetProtected, canOverwriteExport } from '../exportMetadata'
import type { ExportMeta } from '../exportMetadata'
import { buildUploadPlan, getCutsToUpload, canPublish } from '../uploadResume'
import {
  createPublishStatus,
  markCutUploaded,
  markCutFailed,
  markPublishedNotIndexed,
  markPlotPublished,
  setPlotState,
  protectCut,
  isProtected as isPublishProtected
} from '../../main/services/publishStatus'
import type { PublishResultRecord, PublishStatusFile } from '../../main/services/publishStatus'
import {
  checkRetryEligibility,
  checkRetryContentEligibility,
  selectIndexEndpoint,
  buildIndexBody,
  retryIndex,
  markManualNotIndexed
} from '../../main/services/indexRecovery'
import type { Cut } from '../CutList'

const PLOT_SLUG = 'seoul-in-all-this-noise'

function loadPilotCuts(): Cut[] {
  return fixture.plots[PLOT_SLUG].cuts.map((c) => ({
    ...c,
    status: 'approved',
    imageState: { ...c.imageState, status: 'done', path: `/mock/assets/${c.id}/clean-v001.webp` }
  }))
}

function makeExportMeta(cutId: string, hash?: string): ExportMeta {
  return {
    cutId,
    exportedAt: '2026-05-19T12:00:00.000Z',
    width: 320,
    height: 480,
    mimeType: 'image/webp',
    byteSize: 500_000,
    hash: hash ?? `hash-${cutId}`,
    fonts: ['sans-serif'],
    path: `plots/${PLOT_SLUG}/exports/${cutId}.webp`
  }
}

function makePublishResult(overrides?: Partial<PublishResultRecord>): PublishResultRecord {
  return {
    txHash: '0xabc123def456',
    storylineId: 'storyline-42',
    plotIndex: 1,
    contentCid: 'QmTestCid',
    contentHash: '0xcontenthash',
    authorAddress: '0xAuthor',
    gasCostWei: '1000000',
    totalCostWei: '2000000',
    plotlinkUrl: 'https://plotlink.example/plots/42',
    walletAddress: '0xWallet',
    walletSource: 'ows',
    indexed: false,
    indexError: 'Indexing timed out',
    publishAction: 'chain-plot',
    ...overrides
  }
}

function fullyUploadedStatus(cutIds: string[]): PublishStatusFile {
  let status = createPublishStatus(cutIds)
  for (const cutId of cutIds) {
    status = markCutUploaded(
      status,
      cutId,
      `cid-${cutId}`,
      `https://cdn.example/${cutId}.webp`,
      `hash-${cutId}`,
      'image/webp',
      500_000
    )
  }
  return status
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-05-19T12:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Revision and failure recovery (issue #55)', () => {
  describe('Cut revision preserves other cuts', () => {
    it('setStatus on one cut does not change other cuts', () => {
      const cuts: Cut[] = [
        { id: 'cut-001', status: 'planned' },
        { id: 'cut-002', status: 'planned' },
        { id: 'cut-003', status: 'planned' }
      ]
      const updated = setStatus(cuts, 'cut-001', 'draft')
      expect(updated[0].status).toBe('draft')
      expect(updated[1]).toBe(cuts[1])
      expect(updated[2]).toBe(cuts[2])
    })

    it('addOverlay to one cut does not change other cuts', () => {
      const cuts = loadPilotCuts()
      const overlay = {
        id: 'ovl-new',
        type: 'text',
        content: 'New text',
        x: 10,
        y: 10,
        width: 100,
        height: 40
      }
      const updated = addOverlay(cuts, 'cut-001', overlay)
      expect(updated[0].overlays).toHaveLength((cuts[0].overlays?.length ?? 0) + 1)
      for (let i = 1; i < cuts.length; i++) {
        expect(updated[i]).toBe(cuts[i])
      }
    })

    it('deleteOverlay from one cut does not change other cuts', () => {
      const cuts = loadPilotCuts()
      const overlayId = cuts[0].overlays?.[0]?.id
      if (!overlayId) return
      const updated = deleteOverlay(cuts, 'cut-001', overlayId)
      expect(updated[0].overlays).toHaveLength((cuts[0].overlays?.length ?? 0) - 1)
      for (let i = 1; i < cuts.length; i++) {
        expect(updated[i]).toBe(cuts[i])
      }
    })

    it('moveOverlay on one cut does not change other cuts', () => {
      const cuts = loadPilotCuts()
      const overlayId = cuts[0].overlays?.[0]?.id
      if (!overlayId) return
      const updated = moveOverlay(cuts, 'cut-001', overlayId, 200, 200)
      const movedOverlay = updated[0].overlays?.find((o) => o.id === overlayId)
      expect(movedOverlay?.x).toBe(200)
      expect(movedOverlay?.y).toBe(200)
      for (let i = 1; i < cuts.length; i++) {
        expect(updated[i]).toBe(cuts[i])
      }
    })

    it('deleteCut does not affect remaining cuts', () => {
      const cuts: Cut[] = [
        { id: 'cut-001', status: 'draft', dialogue: 'one' },
        { id: 'cut-002', status: 'draft', dialogue: 'two' },
        { id: 'cut-003', status: 'draft', dialogue: 'three' }
      ]
      const updated = deleteCut(cuts, 'cut-002')
      expect(updated).toHaveLength(2)
      expect(updated[0]).toBe(cuts[0])
      expect(updated[1]).toBe(cuts[2])
    })

    it('duplicateCut does not mutate source cut', () => {
      const cuts: Cut[] = [
        {
          id: 'cut-001',
          status: 'draft',
          dialogue: 'original',
          overlays: [
            { id: 'ovl-001', type: 'text', content: 'hello', x: 0, y: 0, width: 100, height: 40 }
          ]
        }
      ]
      const updated = duplicateCut(cuts, 'cut-001')
      expect(updated).toHaveLength(2)
      expect(updated[0].dialogue).toBe('original')
      expect(updated[1].id).not.toBe('cut-001')
      expect(updated[1].status).toBe('planned')
      updated[1].overlays![0].content = 'modified'
      expect(updated[0].overlays![0].content).toBe('hello')
    })

    it('markCutUploaded does not affect other cuts in publish status', () => {
      const status = createPublishStatus(['cut-001', 'cut-002', 'cut-003'])
      const updated = markCutUploaded(
        status,
        'cut-002',
        'cid-2',
        'url-2',
        'hash-2',
        'image/webp',
        500_000
      )

      expect(updated.cuts[1].state).toBe('uploaded')
      expect(updated.cuts[1].cid).toBe('cid-2')
      expect(updated.cuts[0].state).toBe('pending')
      expect(updated.cuts[0].cid).toBeNull()
      expect(updated.cuts[2].state).toBe('pending')
      expect(updated.cuts[2].cid).toBeNull()
    })
  })

  describe('Upload resume after partial failure', () => {
    it('buildUploadPlan identifies failed cuts for retry', () => {
      let status = createPublishStatus(['cut-001', 'cut-002', 'cut-003'])
      status = markCutUploaded(
        status,
        'cut-001',
        'cid-1',
        'url-1',
        'hash-cut-001',
        'image/webp',
        500_000
      )
      status = markCutFailed(status, 'cut-002', 'Network timeout')

      const metas = ['cut-001', 'cut-002', 'cut-003'].map((id) => makeExportMeta(id))
      const plan = buildUploadPlan(status, metas)

      const actions = new Map(plan.cuts.map((c) => [c.cutId, c.action]))
      expect(actions.get('cut-001')).toBe('skip')
      expect(actions.get('cut-002')).toBe('retry')
      expect(actions.get('cut-003')).toBe('upload')
      expect(plan.readyToPublish).toBe(false)
    })

    it('getCutsToUpload returns only non-skip cuts', () => {
      let status = createPublishStatus(['cut-001', 'cut-002', 'cut-003'])
      status = markCutUploaded(
        status,
        'cut-001',
        'cid-1',
        'url-1',
        'hash-cut-001',
        'image/webp',
        500_000
      )
      status = markCutFailed(status, 'cut-002', 'Server error')

      const metas = ['cut-001', 'cut-002', 'cut-003'].map((id) => makeExportMeta(id))
      const plan = buildUploadPlan(status, metas)
      const toUpload = getCutsToUpload(plan)

      expect(toUpload).toContain('cut-002')
      expect(toUpload).toContain('cut-003')
      expect(toUpload).not.toContain('cut-001')
    })

    it('resume after re-uploading failed cut yields ready plan', () => {
      let status = createPublishStatus(['cut-001', 'cut-002'])
      status = markCutUploaded(
        status,
        'cut-001',
        'cid-1',
        'url-1',
        'hash-cut-001',
        'image/webp',
        500_000
      )
      status = markCutFailed(status, 'cut-002', 'Timeout')

      status = markCutUploaded(
        status,
        'cut-002',
        'cid-2',
        'url-2',
        'hash-cut-002',
        'image/webp',
        500_000
      )

      const metas = ['cut-001', 'cut-002'].map((id) => makeExportMeta(id))
      const plan = buildUploadPlan(status, metas)

      expect(plan.readyToPublish).toBe(true)
      expect(plan.blockReason).toBeNull()
    })

    it('stale upload triggers retry when export hash changes', () => {
      let status = createPublishStatus(['cut-001'])
      status = markCutUploaded(
        status,
        'cut-001',
        'cid-1',
        'url-1',
        'old-hash',
        'image/webp',
        500_000
      )

      const metas = [makeExportMeta('cut-001', 'new-hash')]
      const plan = buildUploadPlan(status, metas)

      expect(plan.cuts[0].action).toBe('retry')
      expect(plan.cuts[0].reason).toContain('Stale')
    })

    it('canPublish blocks when uploads are stale', () => {
      let status = createPublishStatus(['cut-001'])
      status = markCutUploaded(
        status,
        'cut-001',
        'cid-1',
        'url-1',
        'old-hash',
        'image/webp',
        500_000
      )

      const metas = [makeExportMeta('cut-001', 'new-hash')]
      const result = canPublish(status, metas)

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('stale')
    })

    it('canPublish allows when all uploads match current exports', () => {
      const cutIds = ['cut-001', 'cut-002']
      const status = fullyUploadedStatus(cutIds)
      const metas = cutIds.map((id) => makeExportMeta(id))

      const result = canPublish(status, metas)
      expect(result.allowed).toBe(true)
      expect(result.reason).toBeNull()
    })
  })

  describe('Protected assets require explicit replacement', () => {
    it('isAssetProtected returns true for exported/uploaded/published', () => {
      expect(isAssetProtected({ id: 'c', status: 'exported' })).toBe(true)
      expect(isAssetProtected({ id: 'c', status: 'uploaded' })).toBe(true)
      expect(isAssetProtected({ id: 'c', status: 'published' })).toBe(true)
    })

    it('isAssetProtected returns false for draft/planned/approved', () => {
      expect(isAssetProtected({ id: 'c', status: 'draft' })).toBe(false)
      expect(isAssetProtected({ id: 'c', status: 'planned' })).toBe(false)
      expect(isAssetProtected({ id: 'c', status: 'approved' })).toBe(false)
    })

    it('canOverwriteExport blocks without force flag', () => {
      const cut: Cut = { id: 'cut-001', status: 'exported' }
      expect(canOverwriteExport(cut, false)).toBe(false)
    })

    it('canOverwriteExport allows with force flag', () => {
      const cut: Cut = { id: 'cut-001', status: 'exported' }
      expect(canOverwriteExport(cut, true)).toBe(true)
    })

    it('deleteCut refuses to delete protected cut', () => {
      const cuts: Cut[] = [
        { id: 'cut-001', status: 'exported' },
        { id: 'cut-002', status: 'draft' }
      ]
      const result = deleteCut(cuts, 'cut-001')
      expect(result).toHaveLength(2)
      expect(result).toBe(cuts)
    })

    it('setStatus refuses to transition protected cut', () => {
      const cuts: Cut[] = [{ id: 'cut-001', status: 'exported' }]
      const result = setStatus(cuts, 'cut-001', 'draft')
      expect(result[0].status).toBe('exported')
    })

    it('protectCut in publish status prevents modification', () => {
      let status = createPublishStatus(['cut-001'])
      status = protectCut(status, 'cut-001')
      expect(isPublishProtected(status, 'cut-001')).toBe(true)
    })

    it('protectCut is idempotent', () => {
      let status = createPublishStatus(['cut-001'])
      status = protectCut(status, 'cut-001')
      const again = protectCut(status, 'cut-001')
      expect(again).toBe(status)
    })
  })

  describe('Recovery from published-not-indexed', () => {
    it('markPublishedNotIndexed sets correct state', () => {
      let status = fullyUploadedStatus(['cut-001', 'cut-002'])
      status = setPlotState(status, 'publishing')
      const result = makePublishResult()
      status = markPublishedNotIndexed(status, result)

      expect(status.plotState).toBe('published-not-indexed')
      expect(status.publishResult).not.toBeNull()
      expect(status.publishResult!.txHash).toBe('0xabc123def456')
      expect(status.publishResult!.indexed).toBe(false)
      expect(status.error).toBe('Indexing timed out')
    })

    it('checkRetryEligibility passes for published-not-indexed with txHash', () => {
      let status = fullyUploadedStatus(['cut-001'])
      status = markPublishedNotIndexed(status, makePublishResult())

      const eligibility = checkRetryEligibility(status)
      expect(eligibility.eligible).toBe(true)
      expect(eligibility.reason).toBeNull()
    })

    it('checkRetryEligibility rejects non-published-not-indexed state', () => {
      const status = fullyUploadedStatus(['cut-001'])
      const eligibility = checkRetryEligibility(status)
      expect(eligibility.eligible).toBe(false)
      expect(eligibility.reason).toContain('not in published-not-indexed')
    })

    it('checkRetryEligibility rejects missing txHash', () => {
      let status = fullyUploadedStatus(['cut-001'])
      status = markPublishedNotIndexed(status, makePublishResult({ txHash: null }))

      const eligibility = checkRetryEligibility(status)
      expect(eligibility.eligible).toBe(false)
      expect(eligibility.reason).toContain('Missing txHash')
    })

    it('checkRetryContentEligibility requires non-empty content', () => {
      let status = fullyUploadedStatus(['cut-001'])
      status = markPublishedNotIndexed(status, makePublishResult())

      expect(checkRetryContentEligibility(status, null).eligible).toBe(false)
      expect(checkRetryContentEligibility(status, '').eligible).toBe(false)
      expect(checkRetryContentEligibility(status, '  ').eligible).toBe(false)
      expect(checkRetryContentEligibility(status, 'markdown content').eligible).toBe(true)
    })

    it('selectIndexEndpoint chooses storyline for create-storyline action', () => {
      const result = makePublishResult({ publishAction: 'create-storyline', plotIndex: 0 })
      const endpoint = selectIndexEndpoint(result, 'https://plotlink.example')
      expect(endpoint.isStoryline).toBe(true)
      expect(endpoint.url).toContain('/api/index/storyline')
    })

    it('selectIndexEndpoint chooses plot for chain-plot action', () => {
      const result = makePublishResult({ publishAction: 'chain-plot', plotIndex: 1 })
      const endpoint = selectIndexEndpoint(result, 'https://plotlink.example')
      expect(endpoint.isStoryline).toBe(false)
      expect(endpoint.url).toContain('/api/index/plot')
    })

    it('buildIndexBody includes txHash but not new transaction data', () => {
      const result = makePublishResult()
      const body = buildIndexBody(result, false, 'markdown content')

      expect(body.txHash).toBe('0xabc123def456')
      expect(body.storylineId).toBe('storyline-42')
      expect(body.content).toBe('markdown content')
      expect(body).not.toHaveProperty('walletAddress')
      expect(body).not.toHaveProperty('gasCostWei')
    })

    it('retryIndex succeeds on first attempt with success response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true })
      })
      const result = await retryIndex(
        { txHash: '0xabc' },
        'https://plotlink.example/api/index/plot',
        {
          plotlinkBaseUrl: 'https://plotlink.example',
          indexRetries: 3,
          indexRetryDelayMs: 0,
          fetch: mockFetch
        }
      )

      expect(result.success).toBe(true)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('retryIndex succeeds on cached response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, cached: true })
      })
      const result = await retryIndex(
        { txHash: '0xabc' },
        'https://plotlink.example/api/index/plot',
        {
          plotlinkBaseUrl: 'https://plotlink.example',
          indexRetries: 1,
          indexRetryDelayMs: 0,
          fetch: mockFetch
        }
      )

      expect(result.success).toBe(true)
    })

    it('retryIndex retries on failure then succeeds', async () => {
      vi.useRealTimers()
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true }) })

      const result = await retryIndex(
        { txHash: '0xabc' },
        'https://plotlink.example/api/index/plot',
        {
          plotlinkBaseUrl: 'https://plotlink.example',
          indexRetries: 2,
          indexRetryDelayMs: 0,
          fetch: mockFetch
        }
      )

      expect(result.success).toBe(true)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('retryIndex exhausts all attempts and fails', async () => {
      vi.useRealTimers()
      const mockFetch = vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) })

      const result = await retryIndex(
        { txHash: '0xabc' },
        'https://plotlink.example/api/index/plot',
        {
          plotlinkBaseUrl: 'https://plotlink.example',
          indexRetries: 2,
          indexRetryDelayMs: 0,
          fetch: mockFetch
        }
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('failed after all attempts')
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('full recovery: published-not-indexed → retry → published', async () => {
      vi.useRealTimers()
      const cutIds = ['cut-001', 'cut-002']
      let status = fullyUploadedStatus(cutIds)
      status = setPlotState(status, 'publishing')

      const publishResult = makePublishResult()
      status = markPublishedNotIndexed(status, publishResult)
      expect(status.plotState).toBe('published-not-indexed')

      const eligibility = checkRetryEligibility(status)
      expect(eligibility.eligible).toBe(true)

      const endpoint = selectIndexEndpoint(status.publishResult!, 'https://plotlink.example')
      const body = buildIndexBody(status.publishResult!, endpoint.isStoryline, 'markdown content')

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true })
      })
      const indexResult = await retryIndex(body, endpoint.url, {
        plotlinkBaseUrl: 'https://plotlink.example',
        indexRetries: 3,
        indexRetryDelayMs: 0,
        fetch: mockFetch
      })
      expect(indexResult.success).toBe(true)

      status = markPlotPublished(status, {
        ...status.publishResult!,
        indexed: true,
        indexError: null
      })
      expect(status.plotState).toBe('published')
      expect(status.publishResult!.indexed).toBe(true)
      expect(status.publishResult!.indexError).toBeNull()
    })
  })

  describe('Retry indexing does not create duplicate on-chain publish', () => {
    it('retryIndex sends existing txHash, not a new transaction', async () => {
      const publishResult = makePublishResult()
      const body = buildIndexBody(publishResult, false, 'markdown')

      expect(body.txHash).toBe(publishResult.txHash)
      expect(body).not.toHaveProperty('sign')
      expect(body).not.toHaveProperty('broadcast')
      expect(body).not.toHaveProperty('encodedData')

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true })
      })

      await retryIndex(body, 'https://plotlink.example/api/index/plot', {
        plotlinkBaseUrl: 'https://plotlink.example',
        indexRetries: 1,
        indexRetryDelayMs: 0,
        fetch: mockFetch
      })

      const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body as string)
      expect(sentBody.txHash).toBe('0xabc123def456')
      expect(sentBody).not.toHaveProperty('sign')
      expect(sentBody).not.toHaveProperty('rawTransaction')
    })

    it('cached index response is treated as success without re-publish', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, cached: true })
      })

      const result = await retryIndex(
        { txHash: '0xabc' },
        'https://plotlink.example/api/index/storyline',
        {
          plotlinkBaseUrl: 'https://plotlink.example',
          indexRetries: 1,
          indexRetryDelayMs: 0,
          fetch: mockFetch
        }
      )

      expect(result.success).toBe(true)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('markManualNotIndexed preserves txHash for safe retry', () => {
      let status = fullyUploadedStatus(['cut-001'])
      status = markPlotPublished(status, makePublishResult({ indexed: true, indexError: null }))

      status = markManualNotIndexed(status, 'Manual reindex requested')
      expect(status.plotState).toBe('published-not-indexed')
      expect(status.publishResult!.txHash).toBe('0xabc123def456')
      expect(status.publishResult!.indexed).toBe(false)
    })
  })
})
