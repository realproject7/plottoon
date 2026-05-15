import { describe, it, expect, vi } from 'vitest'
import { exportCutImage, isExportResult, getQualitySteps, getMaxSizeBytes } from '../imageExport'

function makeBase64(sizeBytes: number): string {
  // base64 encodes 3 bytes per 4 chars
  const chars = Math.ceil((sizeBytes * 4) / 3)
  return 'A'.repeat(chars)
}

function createMockCanvas(responses: Record<string, string>): HTMLCanvasElement {
  return {
    toDataURL: vi.fn((mimeType: string) => {
      return responses[mimeType] ?? `data:image/png;base64,${makeBase64(100)}`
    })
  } as unknown as HTMLCanvasElement
}

describe('exportCutImage', () => {
  it('exports as WebP when under 1MB', () => {
    const small = makeBase64(500_000)
    const canvas = createMockCanvas({
      'image/webp': `data:image/webp;base64,${small}`
    })

    const result = exportCutImage(canvas)
    expect(isExportResult(result)).toBe(true)
    if (isExportResult(result)) {
      expect(result.format).toBe('webp')
      expect(result.sizeBytes).toBeLessThanOrEqual(getMaxSizeBytes())
      expect(result.quality).toBe(getQualitySteps()[0])
    }
  })

  it('falls back to JPEG when WebP is not supported', () => {
    const small = makeBase64(500_000)
    const canvas = createMockCanvas({
      'image/webp': `data:image/png;base64,${small}`, // WebP not supported — returns PNG
      'image/jpeg': `data:image/jpeg;base64,${small}`
    })

    const result = exportCutImage(canvas)
    expect(isExportResult(result)).toBe(true)
    if (isExportResult(result)) {
      expect(result.format).toBe('jpeg')
    }
  })

  it('reduces quality when initial WebP exceeds 1MB', () => {
    let callCount = 0
    const canvas = {
      toDataURL: vi.fn((mimeType: string) => {
        callCount++
        if (mimeType === 'image/webp') {
          // First call (quality check) is small, second (0.92) is too big, third (0.85) fits
          if (callCount === 1) return `data:image/webp;base64,${makeBase64(100)}` // format check
          if (callCount === 2) return `data:image/webp;base64,${makeBase64(1_200_000)}` // too big
          return `data:image/webp;base64,${makeBase64(800_000)}` // fits
        }
        return `data:image/png;base64,${makeBase64(100)}`
      })
    } as unknown as HTMLCanvasElement

    const result = exportCutImage(canvas)
    expect(isExportResult(result)).toBe(true)
    if (isExportResult(result)) {
      expect(result.format).toBe('webp')
      expect(result.quality).toBe(getQualitySteps()[1]) // 0.85
      expect(result.sizeBytes).toBeLessThanOrEqual(getMaxSizeBytes())
    }
  })

  it('falls back to JPEG when all WebP qualities exceed 1MB', () => {
    const canvas = {
      toDataURL: vi.fn((mimeType: string) => {
        if (mimeType === 'image/webp') {
          return `data:image/webp;base64,${makeBase64(1_500_000)}` // always too big
        }
        return `data:image/jpeg;base64,${makeBase64(800_000)}` // JPEG fits
      })
    } as unknown as HTMLCanvasElement

    const result = exportCutImage(canvas)
    expect(isExportResult(result)).toBe(true)
    if (isExportResult(result)) {
      expect(result.format).toBe('jpeg')
      expect(result.sizeBytes).toBeLessThanOrEqual(getMaxSizeBytes())
    }
  })

  it('returns error when nothing fits under 1MB', () => {
    const canvas = {
      toDataURL: vi.fn((mimeType: string) => {
        if (mimeType === 'image/webp') {
          return `data:image/webp;base64,${makeBase64(2_000_000)}`
        }
        return `data:image/jpeg;base64,${makeBase64(2_000_000)}`
      })
    } as unknown as HTMLCanvasElement

    const result = exportCutImage(canvas)
    expect(isExportResult(result)).toBe(false)
    if (!isExportResult(result)) {
      expect(result.error).toContain('1MB')
      expect(result.lastFormat).toBe('jpeg')
      expect(result.lastSizeBytes).toBeGreaterThan(getMaxSizeBytes())
    }
  })

  it('validates output size is <= 1MB on success', () => {
    const canvas = createMockCanvas({
      'image/webp': `data:image/webp;base64,${makeBase64(900_000)}`
    })

    const result = exportCutImage(canvas)
    expect(isExportResult(result)).toBe(true)
    if (isExportResult(result)) {
      expect(result.sizeBytes).toBeLessThanOrEqual(1_048_576)
    }
  })

  it('quality steps are deterministic and ordered', () => {
    const steps = getQualitySteps()
    expect(steps.length).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).toBeLessThan(steps[i - 1])
    }
  })

  it('max size is 1MB', () => {
    expect(getMaxSizeBytes()).toBe(1_048_576)
  })
})

describe('isExportResult', () => {
  it('returns true for success result', () => {
    expect(
      isExportResult({
        dataUrl: 'data:image/webp;base64,AAA',
        format: 'webp',
        quality: 0.92,
        sizeBytes: 1000
      })
    ).toBe(true)
  })

  it('returns false for error result', () => {
    expect(
      isExportResult({
        error: 'too big',
        lastFormat: 'jpeg',
        lastQuality: 0.5,
        lastSizeBytes: 2_000_000
      })
    ).toBe(false)
  })
})
