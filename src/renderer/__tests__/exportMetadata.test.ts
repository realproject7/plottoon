import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  computeHash,
  computeHashSha256,
  base64ByteLength,
  extractFonts,
  buildExportMeta,
  buildExportManifest,
  isAssetProtected,
  canOverwriteExport,
  validateExportMeta
} from '../exportMetadata'
import type { ExportMeta } from '../exportMetadata'
import type { Cut } from '../CutList'
import type { ExportResult } from '../imageExport'

function makeCut(id: string, status?: string): Cut {
  return { id, status }
}

function makeExportResult(format: 'webp' | 'jpeg' = 'webp'): ExportResult {
  return {
    dataUrl: `data:image/${format};base64,AAABBBCC`,
    format,
    quality: 0.92,
    sizeBytes: 50000
  }
}

function makeValidMeta(): ExportMeta {
  return {
    cutId: 'cut-001',
    exportedAt: '2026-05-16T12:00:00.000Z',
    width: 320,
    height: 480,
    mimeType: 'image/webp',
    byteSize: 50000,
    hash: 'abcd1234',
    fonts: ['sans-serif'],
    path: 'exports/cut-001.webp'
  }
}

describe('computeHash', () => {
  it('returns an 8-character hex string', () => {
    const hash = computeHash('data:image/webp;base64,AAABBBCCC')
    expect(hash).toMatch(/^[0-9a-f]{8}$/)
  })

  it('returns different hashes for different data', () => {
    const h1 = computeHash('data:image/webp;base64,AAAA')
    const h2 = computeHash('data:image/webp;base64,BBBB')
    expect(h1).not.toBe(h2)
  })

  it('returns same hash for same data', () => {
    const data = 'data:image/webp;base64,AAABBBCCC'
    expect(computeHash(data)).toBe(computeHash(data))
  })

  it('handles empty base64', () => {
    const hash = computeHash('data:image/webp;base64,')
    expect(hash).toMatch(/^[0-9a-f]{8}$/)
  })
})

describe('base64ByteLength', () => {
  it('computes correct byte length without padding', () => {
    // 'AAAA' = 3 bytes
    expect(base64ByteLength('AAAA')).toBe(3)
  })

  it('computes correct byte length with single padding', () => {
    // 'AAA=' = 2 bytes
    expect(base64ByteLength('AAA=')).toBe(2)
  })

  it('computes correct byte length with double padding', () => {
    // 'AA==' = 1 byte
    expect(base64ByteLength('AA==')).toBe(1)
  })

  it('returns 0 for empty string', () => {
    expect(base64ByteLength('')).toBe(0)
  })
})

describe('extractFonts', () => {
  it('always includes sans-serif', () => {
    const cut = makeCut('cut-001')
    expect(extractFonts(cut)).toContain('sans-serif')
  })

  it('extracts fontFamily from overlay styles', () => {
    const cut: Cut = {
      id: 'cut-001',
      overlays: [
        {
          id: 'ovl-1',
          type: 'text',
          content: '',
          x: 0,
          y: 0,
          width: 100,
          height: 40,
          style: { fontFamily: 'Georgia' }
        }
      ]
    }
    const fonts = extractFonts(cut)
    expect(fonts).toContain('sans-serif')
    expect(fonts).toContain('Georgia')
  })

  it('deduplicates fonts', () => {
    const cut: Cut = {
      id: 'cut-001',
      overlays: [
        {
          id: 'ovl-1',
          type: 'text',
          content: '',
          x: 0,
          y: 0,
          width: 100,
          height: 40,
          style: { fontFamily: 'Georgia' }
        },
        {
          id: 'ovl-2',
          type: 'text',
          content: '',
          x: 0,
          y: 0,
          width: 100,
          height: 40,
          style: { fontFamily: 'Georgia' }
        }
      ]
    }
    const fonts = extractFonts(cut)
    expect(fonts.filter((f) => f === 'Georgia')).toHaveLength(1)
  })
})

describe('computeHashSha256', () => {
  it('returns a 64-character hex string', async () => {
    const bytes = new Uint8Array([0, 1, 2, 3])
    const hash = await computeHashSha256(bytes)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns different hashes for different data', async () => {
    const h1 = await computeHashSha256(new Uint8Array([1, 2, 3]))
    const h2 = await computeHashSha256(new Uint8Array([4, 5, 6]))
    expect(h1).not.toBe(h2)
  })

  it('returns same hash for same data', async () => {
    const data = new Uint8Array([10, 20, 30])
    const h1 = await computeHashSha256(data)
    const h2 = await computeHashSha256(data)
    expect(h1).toBe(h2)
  })
})

describe('buildExportMeta', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-16T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('builds complete metadata from cut and export result', async () => {
    const cut = makeCut('cut-001')
    const result = makeExportResult('webp')
    const meta = await buildExportMeta(cut, result, 'exports/cut-001.webp')

    expect(meta.cutId).toBe('cut-001')
    expect(meta.exportedAt).toBe('2026-05-16T12:00:00.000Z')
    expect(meta.width).toBe(320)
    expect(meta.height).toBe(480)
    expect(meta.mimeType).toBe('image/webp')
    expect(meta.byteSize).toBe(6)
    expect(meta.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(meta.fonts).toContain('sans-serif')
    expect(meta.path).toBe('exports/cut-001.webp')
  })

  it('uses canvasOverrides for dimensions', async () => {
    const cut: Cut = { id: 'cut-001', canvasOverrides: { width: 800, height: 1200 } }
    const meta = await buildExportMeta(cut, makeExportResult(), 'exports/cut-001.webp')
    expect(meta.width).toBe(800)
    expect(meta.height).toBe(1200)
  })

  it('computes byteSize and SHA-256 hash from explicit base64 when provided', async () => {
    const cut = makeCut('cut-001')
    const result = makeExportResult('webp')
    const base64 = 'AAAA' // 3 bytes
    const meta = await buildExportMeta(cut, result, 'exports/cut-001.webp', base64)
    expect(meta.byteSize).toBe(3)
    expect(meta.hash).toMatch(/^[0-9a-f]{64}$/)
    const expectedHash = await computeHashSha256(
      Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    )
    expect(meta.hash).toBe(expectedHash)
  })

  it('sets correct MIME type for JPEG', async () => {
    const meta = await buildExportMeta(
      makeCut('cut-001'),
      makeExportResult('jpeg'),
      'exports/cut-001.jpg'
    )
    expect(meta.mimeType).toBe('image/jpeg')
  })
})

describe('buildExportManifest', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-16T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('builds manifest with version and timestamp', () => {
    const manifest = buildExportManifest([makeValidMeta()])
    expect(manifest.version).toBe(1)
    expect(manifest.exportedAt).toBe('2026-05-16T12:00:00.000Z')
    expect(manifest.cuts).toHaveLength(1)
  })

  it('builds empty manifest', () => {
    const manifest = buildExportManifest([])
    expect(manifest.cuts).toEqual([])
  })
})

describe('isAssetProtected', () => {
  it.each(['exported', 'uploaded', 'published'])('returns true for %s', (status) => {
    expect(isAssetProtected(makeCut('c', status))).toBe(true)
  })

  it.each(['planned', 'draft', 'needs_revision', 'approved', undefined])(
    'returns false for %s',
    (status) => {
      expect(isAssetProtected(makeCut('c', status))).toBe(false)
    }
  )
})

describe('canOverwriteExport', () => {
  it('allows overwrite for unprotected cuts', () => {
    expect(canOverwriteExport(makeCut('c', 'draft'), false)).toBe(true)
  })

  it('blocks overwrite for protected cuts without force', () => {
    expect(canOverwriteExport(makeCut('c', 'exported'), false)).toBe(false)
  })

  it('allows overwrite for protected cuts with force', () => {
    expect(canOverwriteExport(makeCut('c', 'exported'), true)).toBe(true)
  })

  it('allows overwrite for uploaded cuts with force', () => {
    expect(canOverwriteExport(makeCut('c', 'uploaded'), true)).toBe(true)
  })

  it('allows overwrite for published cuts with force', () => {
    expect(canOverwriteExport(makeCut('c', 'published'), true)).toBe(true)
  })
})

describe('validateExportMeta', () => {
  it('returns empty array for valid meta', () => {
    expect(validateExportMeta(makeValidMeta())).toEqual([])
  })

  it('detects missing cutId', () => {
    const meta = { ...makeValidMeta(), cutId: '' }
    expect(validateExportMeta(meta)).toContain('cutId is required')
  })

  it('detects zero width', () => {
    const meta = { ...makeValidMeta(), width: 0 }
    expect(validateExportMeta(meta)).toContain('width must be positive')
  })

  it('detects zero byteSize', () => {
    const meta = { ...makeValidMeta(), byteSize: 0 }
    expect(validateExportMeta(meta)).toContain('byteSize must be positive')
  })

  it('detects missing hash', () => {
    const meta = { ...makeValidMeta(), hash: '' }
    expect(validateExportMeta(meta)).toContain('hash is required')
  })

  it('detects multiple errors', () => {
    const meta = { ...makeValidMeta(), cutId: '', path: '', byteSize: -1 }
    const errors = validateExportMeta(meta)
    expect(errors.length).toBeGreaterThanOrEqual(3)
  })
})
