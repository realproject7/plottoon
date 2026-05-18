import { describe, it, expect, vi } from 'vitest'
import {
  checkRetryEligibility,
  checkRetryContentEligibility,
  selectIndexEndpoint,
  buildIndexBody,
  retryIndex,
  markManualNotIndexed
} from '../services/indexRecovery'
import type { PublishStatusFile, PublishResultRecord } from '../services/publishStatus'

function makeResult(overrides?: Partial<PublishResultRecord>): PublishResultRecord {
  return {
    txHash: '0xtx123',
    storylineId: '0xstory1',
    plotIndex: 1,
    contentCid: 'bafyabc',
    contentHash: '0xhash',
    authorAddress: '0xauthor',
    gasCostWei: '1000',
    plotlinkUrl: null,
    walletAddress: '0xwallet',
    walletSource: 'plottoon-writer',
    indexed: false,
    indexError: 'Index failed after retries',
    ...overrides
  }
}

function makeStatus(overrides?: Partial<PublishStatusFile>): PublishStatusFile {
  return {
    version: 1,
    plotState: 'published-not-indexed',
    error: 'Indexing failed',
    publishedAt: '2026-05-18T00:00:00Z',
    updatedAt: '2026-05-18T00:00:00Z',
    cuts: [],
    publishResult: makeResult(),
    ...overrides
  }
}

describe('checkRetryEligibility', () => {
  it('returns eligible for published-not-indexed with txHash', () => {
    const status = makeStatus()
    const result = checkRetryEligibility(status)
    expect(result.eligible).toBe(true)
    expect(result.reason).toBeNull()
  })

  it('rejects when plot is not published-not-indexed', () => {
    const status = makeStatus({ plotState: 'published' })
    const result = checkRetryEligibility(status)
    expect(result.eligible).toBe(false)
    expect(result.reason).toContain('not in published-not-indexed')
  })

  it('rejects when no publish result', () => {
    const status = makeStatus({ publishResult: null })
    const result = checkRetryEligibility(status)
    expect(result.eligible).toBe(false)
    expect(result.reason).toContain('No publish result')
  })

  it('rejects when txHash is missing', () => {
    const status = makeStatus({ publishResult: makeResult({ txHash: null }) })
    const result = checkRetryEligibility(status)
    expect(result.eligible).toBe(false)
    expect(result.reason).toContain('Missing txHash')
  })
})

describe('checkRetryContentEligibility', () => {
  it('returns eligible when txHash and fallback content present', () => {
    const status = makeStatus()
    const result = checkRetryContentEligibility(status, '# Episode 1')
    expect(result.eligible).toBe(true)
  })

  it('rejects when fallback content is null', () => {
    const status = makeStatus()
    const result = checkRetryContentEligibility(status, null)
    expect(result.eligible).toBe(false)
    expect(result.reason).toContain('Missing fallback content')
  })

  it('rejects when fallback content is empty string', () => {
    const status = makeStatus()
    const result = checkRetryContentEligibility(status, '')
    expect(result.eligible).toBe(false)
    expect(result.reason).toContain('Missing fallback content')
  })

  it('rejects when fallback content is whitespace only', () => {
    const status = makeStatus()
    const result = checkRetryContentEligibility(status, '   ')
    expect(result.eligible).toBe(false)
    expect(result.reason).toContain('Missing fallback content')
  })

  it('still rejects when base eligibility fails even with content', () => {
    const status = makeStatus({ plotState: 'published' })
    const result = checkRetryContentEligibility(status, '# Content')
    expect(result.eligible).toBe(false)
    expect(result.reason).toContain('not in published-not-indexed')
  })
})

describe('selectIndexEndpoint', () => {
  it('selects storyline endpoint for genesis plot (plotIndex=0)', () => {
    const result = makeResult({ plotIndex: 0 })
    const { url, isStoryline } = selectIndexEndpoint(result, 'https://plotlink.xyz')
    expect(isStoryline).toBe(true)
    expect(url).toBe('https://plotlink.xyz/api/index/storyline')
  })

  it('selects storyline endpoint when storylineId is null', () => {
    const result = makeResult({ storylineId: null })
    const { isStoryline } = selectIndexEndpoint(result, 'https://plotlink.xyz')
    expect(isStoryline).toBe(true)
  })

  it('selects plot endpoint for chained plots', () => {
    const result = makeResult({ storylineId: '0xstory1', plotIndex: 2 })
    const { url, isStoryline } = selectIndexEndpoint(result, 'https://plotlink.xyz')
    expect(isStoryline).toBe(false)
    expect(url).toBe('https://plotlink.xyz/api/index/plot')
  })
})

describe('buildIndexBody', () => {
  it('builds storyline body with txHash and fallback content', () => {
    const result = makeResult()
    const body = buildIndexBody(result, true, 'markdown content', {
      contentType: 'cartoon',
      isNsfw: 'false'
    })
    expect(body.txHash).toBe('0xtx123')
    expect(body.content).toBe('markdown content')
    expect(body.contentType).toBe('cartoon')
    expect(body.isNsfw).toBe('false')
  })

  it('builds plot body with storylineId', () => {
    const result = makeResult()
    const body = buildIndexBody(result, false, null)
    expect(body.txHash).toBe('0xtx123')
    expect(body.storylineId).toBe('0xstory1')
    expect(body).not.toHaveProperty('content')
  })

  it('omits fallback content when null', () => {
    const result = makeResult()
    const body = buildIndexBody(result, true, null)
    expect(body.txHash).toBe('0xtx123')
    expect(body).not.toHaveProperty('content')
  })
})

describe('retryIndex', () => {
  it('returns success on first attempt', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true })
    })
    const result = await retryIndex({ txHash: '0x1' }, 'https://plotlink.xyz/api/index/storyline', {
      plotlinkBaseUrl: 'https://plotlink.xyz',
      indexRetries: 2,
      indexRetryDelayMs: 0,
      fetch: mockFetch
    })
    expect(result.success).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('retries and succeeds on second attempt', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true })
      })
    const result = await retryIndex({ txHash: '0x1' }, 'https://plotlink.xyz/api/index/plot', {
      plotlinkBaseUrl: 'https://plotlink.xyz',
      indexRetries: 2,
      indexRetryDelayMs: 0,
      fetch: mockFetch
    })
    expect(result.success).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('returns error after all retries exhausted', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))
    const result = await retryIndex({ txHash: '0x1' }, 'https://plotlink.xyz/api/index/storyline', {
      plotlinkBaseUrl: 'https://plotlink.xyz',
      indexRetries: 1,
      indexRetryDelayMs: 0,
      fetch: mockFetch
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('failed after all attempts')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('treats cached storyline response as success', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, cached: true })
    })
    const result = await retryIndex({ txHash: '0x1' }, 'https://plotlink.xyz/api/index/storyline', {
      plotlinkBaseUrl: 'https://plotlink.xyz',
      indexRetries: 2,
      indexRetryDelayMs: 0,
      fetch: mockFetch
    })
    expect(result.success).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('treats cached plot response as success', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, cached: true })
    })
    const result = await retryIndex({ txHash: '0x1' }, 'https://plotlink.xyz/api/index/plot', {
      plotlinkBaseUrl: 'https://plotlink.xyz',
      indexRetries: 2,
      indexRetryDelayMs: 0,
      fetch: mockFetch
    })
    expect(result.success).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('rejects ok:true without cached:true as not successful', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true })
    })
    const result = await retryIndex({ txHash: '0x1' }, 'https://plotlink.xyz/api/index/storyline', {
      plotlinkBaseUrl: 'https://plotlink.xyz',
      indexRetries: 0,
      indexRetryDelayMs: 0,
      fetch: mockFetch
    })
    expect(result.success).toBe(false)
  })
})

describe('markManualNotIndexed', () => {
  it('preserves publish result while setting not-indexed state', () => {
    const status = makeStatus({
      plotState: 'published',
      publishResult: makeResult({ indexed: true, indexError: null })
    })
    const result = markManualNotIndexed(status, 'Manually flagged for reindex')
    expect(result.plotState).toBe('published-not-indexed')
    expect(result.error).toBe('Manually flagged for reindex')
    expect(result.publishResult!.indexed).toBe(false)
    expect(result.publishResult!.indexError).toBe('Manually flagged for reindex')
  })

  it('does not modify tx/content metadata', () => {
    const status = makeStatus()
    const original = status.publishResult!
    const result = markManualNotIndexed(status, 'test reason')
    expect(result.publishResult!.txHash).toBe(original.txHash)
    expect(result.publishResult!.contentCid).toBe(original.contentCid)
    expect(result.publishResult!.contentHash).toBe(original.contentHash)
    expect(result.publishResult!.authorAddress).toBe(original.authorAddress)
  })

  it('sets indexed to false and indexError for previously indexed publishes', () => {
    const status = makeStatus({
      plotState: 'published',
      publishResult: makeResult({ indexed: true, indexError: null })
    })
    const result = markManualNotIndexed(status, 'Bad metadata on PlotLink')
    expect(result.publishResult!.indexed).toBe(false)
    expect(result.publishResult!.indexError).toBe('Bad metadata on PlotLink')
    expect(result.publishResult!.gasCostWei).toBe('1000')
  })
})
