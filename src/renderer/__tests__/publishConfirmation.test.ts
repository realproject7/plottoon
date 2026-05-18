import { describe, it, expect } from 'vitest'
import {
  createConfirmationState,
  computePayloadHash,
  buildPublishPreview,
  confirmPublish,
  isConfirmationValid,
  canPublishWithConfirmation,
  invalidateOnChange
} from '../publishConfirmation'
import type { ExportMeta } from '../exportMetadata'

function makeMeta(cutId: string, byteSize = 500): ExportMeta {
  return {
    cutId,
    exportedAt: '2026-01-01T00:00:00.000Z',
    width: 320,
    height: 480,
    mimeType: 'image/webp',
    byteSize,
    hash: `hash-${cutId}`,
    fonts: ['sans-serif'],
    path: `plots/ep1/exports/${cutId}.webp`
  }
}

async function makePreview(overrides: Partial<Parameters<typeof buildPublishPreview>[3]> = {}) {
  return buildPublishPreview(
    'Test Episode',
    '# Episode\n![cut-001](cut-001.webp)\n![cut-002](cut-002.webp)',
    [makeMeta('cut-001'), makeMeta('cut-002')],
    { hasTranscript: true, hasAltText: true, ...overrides }
  )
}

describe('buildPublishPreview', () => {
  it('builds preview with correct metadata', async () => {
    const preview = await makePreview()
    expect(preview.title).toBe('Test Episode')
    expect(preview.contentType).toBe('cartoon')
    expect(preview.imageCount).toBe(2)
    expect(preview.totalUploadedBytes).toBe(1000)
    expect(preview.hasTranscript).toBe(true)
    expect(preview.hasAltText).toBe(true)
    expect(preview.matureFlag).toBe(false)
    expect(preview.imageOrder).toEqual(['cut-001', 'cut-002'])
    expect(preview.payloadHash).toBeTruthy()
  })

  it('sets matureFlag when specified', async () => {
    const preview = await makePreview({ matureFlag: true })
    expect(preview.matureFlag).toBe(true)
  })

  it('computes different hash for different content', async () => {
    const preview1 = await makePreview()
    const preview2 = await buildPublishPreview(
      'Different Title',
      '# Different',
      [makeMeta('cut-001')],
      {
        hasTranscript: false,
        hasAltText: false
      }
    )
    expect(preview1.payloadHash).not.toBe(preview2.payloadHash)
  })

  it('computes same hash for identical content', async () => {
    const preview1 = await makePreview()
    const preview2 = await makePreview()
    expect(preview1.payloadHash).toBe(preview2.payloadHash)
  })
})

describe('computePayloadHash', () => {
  it('is deterministic and produces SHA-256 hex output', async () => {
    const input = {
      title: 'test',
      contentType: 'cartoon' as const,
      imageCount: 1,
      totalUploadedBytes: 500,
      hasTranscript: true,
      hasAltText: true,
      matureFlag: false,
      markdown: '# test',
      imageOrder: ['cut-001'],
      imageIdentities: [{ cutId: 'cut-001', hash: 'h1', mimeType: 'image/webp', byteSize: 500 }]
    }
    const hash1 = await computePayloadHash(input)
    const hash2 = await computePayloadHash(input)
    expect(hash1).toBe(hash2)
    expect(hash1).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when markdown changes', async () => {
    const base = {
      title: 'test',
      contentType: 'cartoon' as const,
      imageCount: 1,
      totalUploadedBytes: 500,
      hasTranscript: true,
      hasAltText: true,
      matureFlag: false,
      imageOrder: ['cut-001'],
      imageIdentities: [{ cutId: 'cut-001', hash: 'h1', mimeType: 'image/webp', byteSize: 500 }]
    }
    const h1 = await computePayloadHash({ ...base, markdown: '# version 1' })
    const h2 = await computePayloadHash({ ...base, markdown: '# version 2' })
    expect(h1).not.toBe(h2)
  })

  it('changes when image order changes', async () => {
    const ids = [
      { cutId: 'cut-001', hash: 'h1', mimeType: 'image/webp', byteSize: 500 },
      { cutId: 'cut-002', hash: 'h2', mimeType: 'image/webp', byteSize: 500 }
    ]
    const base = {
      title: 'test',
      contentType: 'cartoon' as const,
      imageCount: 2,
      totalUploadedBytes: 1000,
      hasTranscript: true,
      hasAltText: true,
      matureFlag: false,
      markdown: '# test',
      imageIdentities: ids
    }
    const h1 = await computePayloadHash({ ...base, imageOrder: ['cut-001', 'cut-002'] })
    const h2 = await computePayloadHash({ ...base, imageOrder: ['cut-002', 'cut-001'] })
    expect(h1).not.toBe(h2)
  })

  it('changes when image identities change', async () => {
    const base = {
      title: 'test',
      contentType: 'cartoon' as const,
      imageCount: 1,
      totalUploadedBytes: 500,
      hasTranscript: true,
      hasAltText: true,
      matureFlag: false,
      markdown: '# test',
      imageOrder: ['cut-001']
    }
    const h1 = await computePayloadHash({
      ...base,
      imageIdentities: [
        { cutId: 'cut-001', hash: 'hash-v1', mimeType: 'image/webp', byteSize: 500 }
      ]
    })
    const h2 = await computePayloadHash({
      ...base,
      imageIdentities: [
        { cutId: 'cut-001', hash: 'hash-v2', mimeType: 'image/webp', byteSize: 500 }
      ]
    })
    expect(h1).not.toBe(h2)
  })

  it('changes when title changes', async () => {
    const base = {
      contentType: 'cartoon' as const,
      imageCount: 1,
      totalUploadedBytes: 500,
      hasTranscript: true,
      hasAltText: true,
      matureFlag: false,
      markdown: '# test',
      imageOrder: ['cut-001'],
      imageIdentities: [{ cutId: 'cut-001', hash: 'h1', mimeType: 'image/webp', byteSize: 500 }]
    }
    const h1 = await computePayloadHash({ ...base, title: 'Title A' })
    const h2 = await computePayloadHash({ ...base, title: 'Title B' })
    expect(h1).not.toBe(h2)
  })

  it('changes when content rating (matureFlag) changes', async () => {
    const base = {
      title: 'test',
      contentType: 'cartoon' as const,
      imageCount: 1,
      totalUploadedBytes: 500,
      hasTranscript: true,
      hasAltText: true,
      markdown: '# test',
      imageOrder: ['cut-001'],
      imageIdentities: [{ cutId: 'cut-001', hash: 'h1', mimeType: 'image/webp', byteSize: 500 }]
    }
    const h1 = await computePayloadHash({ ...base, matureFlag: false })
    const h2 = await computePayloadHash({ ...base, matureFlag: true })
    expect(h1).not.toBe(h2)
  })

  it('changes when transcript availability changes', async () => {
    const base = {
      title: 'test',
      contentType: 'cartoon' as const,
      imageCount: 1,
      totalUploadedBytes: 500,
      hasAltText: true,
      matureFlag: false,
      markdown: '# test',
      imageOrder: ['cut-001'],
      imageIdentities: [{ cutId: 'cut-001', hash: 'h1', mimeType: 'image/webp', byteSize: 500 }]
    }
    const h1 = await computePayloadHash({ ...base, hasTranscript: true })
    const h2 = await computePayloadHash({ ...base, hasTranscript: false })
    expect(h1).not.toBe(h2)
  })

  it('changes when alt-text availability changes', async () => {
    const base = {
      title: 'test',
      contentType: 'cartoon' as const,
      imageCount: 1,
      totalUploadedBytes: 500,
      hasTranscript: true,
      matureFlag: false,
      markdown: '# test',
      imageOrder: ['cut-001'],
      imageIdentities: [{ cutId: 'cut-001', hash: 'h1', mimeType: 'image/webp', byteSize: 500 }]
    }
    const h1 = await computePayloadHash({ ...base, hasAltText: true })
    const h2 = await computePayloadHash({ ...base, hasAltText: false })
    expect(h1).not.toBe(h2)
  })
})

describe('createConfirmationState', () => {
  it('creates unconfirmed state', () => {
    const state = createConfirmationState(false)
    expect(state.confirmed).toBe(false)
    expect(state.confirmedAt).toBeNull()
    expect(state.payloadHash).toBeNull()
    expect(state.isDryRun).toBe(false)
  })

  it('sets isDryRun flag', () => {
    const state = createConfirmationState(true)
    expect(state.isDryRun).toBe(true)
  })
})

describe('confirmPublish', () => {
  it('sets confirmed state with payload hash', async () => {
    const state = createConfirmationState(false)
    const preview = await makePreview()
    const confirmed = confirmPublish(state, preview)

    expect(confirmed.confirmed).toBe(true)
    expect(confirmed.confirmedAt).toBeTruthy()
    expect(confirmed.payloadHash).toBe(preview.payloadHash)
  })
})

describe('isConfirmationValid', () => {
  it('returns true when confirmed and hash matches', async () => {
    const state = createConfirmationState(false)
    const preview = await makePreview()
    const confirmed = confirmPublish(state, preview)

    expect(isConfirmationValid(confirmed, preview)).toBe(true)
  })

  it('returns false when not confirmed', async () => {
    const state = createConfirmationState(false)
    const preview = await makePreview()
    expect(isConfirmationValid(state, preview)).toBe(false)
  })

  it('returns false when payload hash changed', async () => {
    const state = createConfirmationState(false)
    const preview1 = await makePreview()
    const confirmed = confirmPublish(state, preview1)

    const preview2 = await buildPublishPreview(
      'Changed Title',
      '# Changed',
      [makeMeta('cut-001')],
      {
        hasTranscript: true,
        hasAltText: true
      }
    )

    expect(isConfirmationValid(confirmed, preview2)).toBe(false)
  })
})

describe('canPublishWithConfirmation', () => {
  it('allows dry-run without confirmation', async () => {
    const state = createConfirmationState(true)
    const preview = await makePreview()
    const result = canPublishWithConfirmation(state, preview)

    expect(result.allowed).toBe(true)
    expect(result.reason).toBeNull()
  })

  it('blocks real publish without confirmation', async () => {
    const state = createConfirmationState(false)
    const preview = await makePreview()
    const result = canPublishWithConfirmation(state, preview)

    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('requires explicit user confirmation')
  })

  it('allows real publish with valid confirmation', async () => {
    const state = createConfirmationState(false)
    const preview = await makePreview()
    const confirmed = confirmPublish(state, preview)
    const result = canPublishWithConfirmation(confirmed, preview)

    expect(result.allowed).toBe(true)
  })

  it('blocks real publish when payload changed after confirmation', async () => {
    const state = createConfirmationState(false)
    const preview1 = await makePreview()
    const confirmed = confirmPublish(state, preview1)

    const preview2 = await buildPublishPreview(
      'Changed',
      '# Changed',
      [makeMeta('cut-001'), makeMeta('cut-002'), makeMeta('cut-003')],
      { hasTranscript: true, hasAltText: true }
    )
    const result = canPublishWithConfirmation(confirmed, preview2)

    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('Payload changed since confirmation')
  })

  it('invalidates confirmation when cut export hash changes', async () => {
    const meta1 = makeMeta('cut-001', 500)
    const meta2 = makeMeta('cut-002', 500)
    const preview1 = await buildPublishPreview(
      'Test Episode',
      '# Episode\n![cut-001](cut-001.webp)\n![cut-002](cut-002.webp)',
      [meta1, meta2],
      { hasTranscript: true, hasAltText: true }
    )

    const state = createConfirmationState(false)
    const confirmed = confirmPublish(state, preview1)

    const meta1Changed: ExportMeta = { ...meta1, hash: 'completely-different-hash' }
    const preview2 = await buildPublishPreview(
      'Test Episode',
      '# Episode\n![cut-001](cut-001.webp)\n![cut-002](cut-002.webp)',
      [meta1Changed, meta2],
      { hasTranscript: true, hasAltText: true }
    )

    expect(preview1.payloadHash).not.toBe(preview2.payloadHash)
    const result = canPublishWithConfirmation(confirmed, preview2)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('Payload changed since confirmation')
  })
})

describe('invalidateOnChange', () => {
  it('returns same state when payload unchanged', async () => {
    const state = createConfirmationState(false)
    const preview = await makePreview()
    const confirmed = confirmPublish(state, preview)
    const result = invalidateOnChange(confirmed, preview)

    expect(result).toBe(confirmed)
  })

  it('invalidates confirmation when payload changes', async () => {
    const state = createConfirmationState(false)
    const preview1 = await makePreview()
    const confirmed = confirmPublish(state, preview1)

    const preview2 = await buildPublishPreview('New Title', '# New', [makeMeta('cut-003')], {
      hasTranscript: false,
      hasAltText: false
    })
    const result = invalidateOnChange(confirmed, preview2)

    expect(result.confirmed).toBe(false)
    expect(result.confirmedAt).toBeNull()
    expect(result.payloadHash).toBeNull()
  })

  it('preserves isDryRun on invalidation', async () => {
    const state = createConfirmationState(true)
    const preview1 = await makePreview()
    const confirmed = confirmPublish(state, preview1)

    const preview2 = await buildPublishPreview('New', '# New', [makeMeta('cut-001')], {
      hasTranscript: false,
      hasAltText: false
    })
    const result = invalidateOnChange(confirmed, preview2)

    expect(result.isDryRun).toBe(true)
  })

  it('does nothing when not yet confirmed', async () => {
    const state = createConfirmationState(false)
    const preview = await makePreview()
    const result = invalidateOnChange(state, preview)

    expect(result).toBe(state)
  })
})
