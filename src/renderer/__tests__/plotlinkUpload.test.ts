import { describe, it, expect, vi } from 'vitest'
import {
  validateCutForUpload,
  validateAll,
  batchInputs,
  uploadCutImages,
  type CutUploadInput,
  type UploadServiceConfig,
  type UploadResponse
} from '../plotlinkUpload'
import type { ExportMeta } from '../exportMetadata'

function makeInput(
  cutId: string,
  mimeType = 'image/webp',
  size = 1000,
  magic?: number[]
): CutUploadInput {
  const bytes = new Uint8Array(size)
  const webpFull = [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]
  const magicBytes = magic ?? (mimeType === 'image/webp' ? webpFull : [0xff, 0xd8, 0xff])
  for (let i = 0; i < magicBytes.length; i++) bytes[i] = magicBytes[i]
  return {
    cutId,
    meta: {
      cutId,
      exportedAt: '2026-01-01T00:00:00.000Z',
      width: 320,
      height: 480,
      mimeType,
      byteSize: size,
      hash: 'abc123',
      fonts: ['sans-serif'],
      path: `plots/ep1/exports/${cutId}.webp`
    } satisfies ExportMeta,
    fileBytes: bytes
  }
}

function mockConfig(responseBody: UploadResponse, status = 200): UploadServiceConfig {
  const fetchFn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(responseBody)
  })
  return {
    endpoint: 'https://plotlink.example/api/upload-plot-images',
    signMessage: vi.fn().mockResolvedValue('mock-signature'),
    fetch: fetchFn
  }
}

describe('validateCutForUpload', () => {
  it('passes valid webp input', () => {
    const input = makeInput('cut-001', 'image/webp', 500)
    expect(validateCutForUpload(input)).toBeNull()
  })

  it('passes valid jpeg input', () => {
    const input = makeInput('cut-001', 'image/jpeg', 500)
    expect(validateCutForUpload(input)).toBeNull()
  })

  it('rejects unsupported MIME type', () => {
    const input = makeInput('cut-001', 'image/png', 500, [0x89, 0x50, 0x4e, 0x47])
    const err = validateCutForUpload(input)
    expect(err).not.toBeNull()
    expect(err!.reason).toContain('Unsupported MIME type')
  })

  it('rejects file exceeding 1MB', () => {
    const input = makeInput('cut-001', 'image/webp', 1_048_577)
    const err = validateCutForUpload(input)
    expect(err).not.toBeNull()
    expect(err!.reason).toContain('exceeds 1MB')
  })

  it('rejects mismatched magic bytes', () => {
    const input = makeInput('cut-001', 'image/webp', 500, [0xff, 0xd8, 0xff])
    const err = validateCutForUpload(input)
    expect(err).not.toBeNull()
    expect(err!.reason).toContain('Magic bytes do not match')
  })

  it('rejects non-WebP RIFF container (e.g. AVI)', () => {
    // RIFF header but with AVI marker at bytes 8-11 instead of WEBP
    const aviMagic = [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x41, 0x56, 0x49, 0x20]
    const input = makeInput('cut-001', 'image/webp', 500, aviMagic)
    const err = validateCutForUpload(input)
    expect(err).not.toBeNull()
    expect(err!.reason).toContain('Magic bytes do not match')
  })
})

describe('validateAll', () => {
  it('returns empty array for all valid inputs', () => {
    const inputs = [makeInput('cut-001'), makeInput('cut-002')]
    expect(validateAll(inputs)).toEqual([])
  })

  it('collects multiple validation errors', () => {
    const inputs = [
      makeInput('cut-001', 'image/png', 500, [0x89, 0x50, 0x4e, 0x47]),
      makeInput('cut-002', 'image/webp', 2_000_000)
    ]
    const errors = validateAll(inputs)
    expect(errors).toHaveLength(2)
    expect(errors[0].cutId).toBe('cut-001')
    expect(errors[1].cutId).toBe('cut-002')
  })
})

describe('batchInputs', () => {
  it('returns single batch for <= 20 inputs', () => {
    const inputs = Array.from({ length: 5 }, (_, i) => makeInput(`cut-${i}`))
    const batches = batchInputs(inputs)
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(5)
  })

  it('splits into multiple batches of 20', () => {
    const inputs = Array.from({ length: 45 }, (_, i) => makeInput(`cut-${i}`))
    const batches = batchInputs(inputs)
    expect(batches).toHaveLength(3)
    expect(batches[0]).toHaveLength(20)
    expect(batches[1]).toHaveLength(20)
    expect(batches[2]).toHaveLength(5)
  })

  it('preserves order across batches', () => {
    const inputs = Array.from({ length: 25 }, (_, i) => makeInput(`cut-${i}`))
    const batches = batchInputs(inputs)
    expect(batches[0][0].cutId).toBe('cut-0')
    expect(batches[0][19].cutId).toBe('cut-19')
    expect(batches[1][0].cutId).toBe('cut-20')
    expect(batches[1][4].cutId).toBe('cut-24')
  })

  it('returns empty array for empty input', () => {
    expect(batchInputs([])).toEqual([])
  })
})

describe('uploadCutImages', () => {
  it('uploads successfully and returns per-cut results', async () => {
    const inputs = [makeInput('cut-001'), makeInput('cut-002')]
    const config = mockConfig({
      results: [
        {
          index: 0,
          url: 'https://cdn.example/a.webp',
          cid: 'cid-a',
          mimeType: 'image/webp',
          sizeBytes: 500
        },
        {
          index: 1,
          url: 'https://cdn.example/b.webp',
          cid: 'cid-b',
          mimeType: 'image/webp',
          sizeBytes: 600
        }
      ]
    })

    const { results, validationErrors } = await uploadCutImages(inputs, config)

    expect(validationErrors).toEqual([])
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({
      cutId: 'cut-001',
      success: true,
      url: 'https://cdn.example/a.webp',
      cid: 'cid-a',
      mimeType: 'image/webp',
      sizeBytes: 500
    })
    expect(results[1]).toEqual({
      cutId: 'cut-002',
      success: true,
      url: 'https://cdn.example/b.webp',
      cid: 'cid-b',
      mimeType: 'image/webp',
      sizeBytes: 600
    })
  })

  it('handles partial failure in response', async () => {
    const inputs = [makeInput('cut-001'), makeInput('cut-002')]
    const config = mockConfig({
      results: [
        {
          index: 0,
          url: 'https://cdn.example/a.webp',
          cid: 'cid-a',
          mimeType: 'image/webp',
          sizeBytes: 500
        },
        { index: 1, error: 'corrupt file' }
      ]
    })

    const { results } = await uploadCutImages(inputs, config)

    expect(results[0].success).toBe(true)
    expect(results[1].success).toBe(false)
    expect(results[1].error).toBe('corrupt file')
  })

  it('maps response items by index, not array position', async () => {
    const inputs = [makeInput('cut-001'), makeInput('cut-002')]
    const config = mockConfig({
      results: [
        {
          index: 1,
          url: 'https://cdn.example/b.webp',
          cid: 'cid-b',
          mimeType: 'image/webp',
          sizeBytes: 600
        },
        {
          index: 0,
          url: 'https://cdn.example/a.webp',
          cid: 'cid-a',
          mimeType: 'image/webp',
          sizeBytes: 500
        }
      ]
    })

    const { results } = await uploadCutImages(inputs, config)

    expect(results[0].cutId).toBe('cut-001')
    expect(results[0].cid).toBe('cid-a')
    expect(results[1].cutId).toBe('cut-002')
    expect(results[1].cid).toBe('cid-b')
  })

  it('returns validation errors and skips invalid inputs', async () => {
    const inputs = [
      makeInput('cut-001', 'image/png', 500, [0x89, 0x50, 0x4e, 0x47]),
      makeInput('cut-002', 'image/webp', 500)
    ]
    const config = mockConfig({
      results: [
        {
          index: 0,
          url: 'https://cdn.example/b.webp',
          cid: 'cid-b',
          mimeType: 'image/webp',
          sizeBytes: 500
        }
      ]
    })

    const { results, validationErrors } = await uploadCutImages(inputs, config)

    expect(validationErrors).toHaveLength(1)
    expect(validationErrors[0].cutId).toBe('cut-001')
    expect(results).toHaveLength(1)
    expect(results[0].cutId).toBe('cut-002')
    expect(results[0].success).toBe(true)
  })

  it('returns empty results when all inputs fail validation', async () => {
    const inputs = [makeInput('cut-001', 'image/png', 500, [0x89, 0x50, 0x4e, 0x47])]
    const config = mockConfig({ results: [] })

    const { results, validationErrors } = await uploadCutImages(inputs, config)

    expect(validationErrors).toHaveLength(1)
    expect(results).toEqual([])
    expect(config.fetch).not.toHaveBeenCalled()
  })

  it('handles HTTP 401 as auth failure for all cuts in batch', async () => {
    const inputs = [makeInput('cut-001'), makeInput('cut-002')]
    const config = mockConfig({ results: [] }, 401)

    const { results } = await uploadCutImages(inputs, config)

    expect(results).toHaveLength(2)
    expect(results.every((r) => !r.success)).toBe(true)
    expect(results[0].error).toContain('Signature invalid')
  })

  it('handles HTTP 429 rate limit for all cuts in batch', async () => {
    const inputs = [makeInput('cut-001')]
    const config = mockConfig({ results: [] }, 429)

    const { results } = await uploadCutImages(inputs, config)

    expect(results[0].success).toBe(false)
    expect(results[0].error).toContain('Rate limited')
  })

  it('calls signMessage with numeric timestamp format', async () => {
    const inputs = [makeInput('cut-001')]
    const config = mockConfig({
      results: [
        {
          index: 0,
          url: 'https://cdn.example/a.webp',
          cid: 'cid-a',
          mimeType: 'image/webp',
          sizeBytes: 500
        }
      ]
    })

    await uploadCutImages(inputs, config)

    const signMessage = config.signMessage as ReturnType<typeof vi.fn>
    expect(signMessage).toHaveBeenCalledTimes(1)
    const msg = signMessage.mock.calls[0][0] as string
    expect(msg).toMatch(/^PlotLink: Upload plot images\nTimestamp: \d+$/)
  })

  it('sends message and signature as FormData fields', async () => {
    const inputs = [makeInput('cut-001')]
    const config = mockConfig({
      results: [
        {
          index: 0,
          url: 'https://cdn.example/a.webp',
          cid: 'cid-a',
          mimeType: 'image/webp',
          sizeBytes: 500
        }
      ]
    })

    await uploadCutImages(inputs, config)

    const fetchFn = config.fetch as ReturnType<typeof vi.fn>
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('https://plotlink.example/api/upload-plot-images')
    expect(init.headers).toBeUndefined()
    const body = init.body as FormData
    expect(body.get('message')).toMatch(/^PlotLink: Upload plot images\nTimestamp: \d+$/)
    expect(body.get('signature')).toBe('mock-signature')
  })

  it('regression: request fails without message/signature FormData fields', async () => {
    const inputs = [makeInput('cut-001')]
    const config = mockConfig({
      results: [
        {
          index: 0,
          url: 'https://cdn.example/a.webp',
          cid: 'cid-a',
          mimeType: 'image/webp',
          sizeBytes: 500
        }
      ]
    })

    await uploadCutImages(inputs, config)

    const fetchFn = config.fetch as ReturnType<typeof vi.fn>
    const [, init] = fetchFn.mock.calls[0]
    const body = init.body as FormData
    const messageField = body.get('message')
    const signatureField = body.get('signature')
    expect(messageField).not.toBeNull()
    expect(signatureField).not.toBeNull()
    expect(typeof messageField).toBe('string')
    expect(typeof signatureField).toBe('string')
  })

  it('handles missing response item for an index', async () => {
    const inputs = [makeInput('cut-001'), makeInput('cut-002')]
    const config = mockConfig({
      results: [
        {
          index: 0,
          url: 'https://cdn.example/a.webp',
          cid: 'cid-a',
          mimeType: 'image/webp',
          sizeBytes: 500
        }
      ]
    })

    const { results } = await uploadCutImages(inputs, config)

    expect(results[1].success).toBe(false)
    expect(results[1].error).toBe('No response for this index')
  })

  it('treats incomplete success response (missing required fields) as failure', async () => {
    const inputs = [makeInput('cut-001'), makeInput('cut-002')]
    const config = mockConfig({
      results: [
        { index: 0, url: 'https://cdn.example/a.webp' },
        {
          index: 1,
          url: 'https://cdn.example/b.webp',
          cid: 'cid-b',
          mimeType: 'image/webp',
          sizeBytes: 600
        }
      ]
    })

    const { results } = await uploadCutImages(inputs, config)

    expect(results[0].success).toBe(false)
    expect(results[0].error).toContain('Incomplete response')
    expect(results[1].success).toBe(true)
  })
})
