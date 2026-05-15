const MAX_SIZE_BYTES = 1_048_576 // 1 MB
const QUALITY_STEPS = [0.92, 0.85, 0.75, 0.65, 0.5]

export interface ExportResult {
  dataUrl: string
  format: 'webp' | 'jpeg'
  quality: number
  sizeBytes: number
}

export interface ExportError {
  error: string
  lastFormat: 'webp' | 'jpeg'
  lastQuality: number
  lastSizeBytes: number
}

function dataUrlSize(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1]
  if (!base64) return 0
  return Math.ceil((base64.length * 3) / 4)
}

function isFormatSupported(canvas: HTMLCanvasElement, mimeType: string): boolean {
  try {
    const url = canvas.toDataURL(mimeType, 0.5)
    return typeof url === 'string' && url.startsWith(`data:${mimeType}`)
  } catch {
    return false
  }
}

function tryExport(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number
): { dataUrl: string; sizeBytes: number } | null {
  const dataUrl = canvas.toDataURL(mimeType, quality)
  if (!dataUrl.startsWith(`data:${mimeType}`)) return null
  return { dataUrl, sizeBytes: dataUrlSize(dataUrl) }
}

export function exportCutImage(canvas: HTMLCanvasElement): ExportResult | ExportError {
  // Try WebP first
  const webpSupported = isFormatSupported(canvas, 'image/webp')

  if (webpSupported) {
    for (const quality of QUALITY_STEPS) {
      const result = tryExport(canvas, 'image/webp', quality)
      if (result && result.sizeBytes <= MAX_SIZE_BYTES) {
        return { dataUrl: result.dataUrl, format: 'webp', quality, sizeBytes: result.sizeBytes }
      }
    }
  }

  // Fall back to JPEG
  const jpegSupported = isFormatSupported(canvas, 'image/jpeg')
  if (jpegSupported) {
    for (const quality of QUALITY_STEPS) {
      const result = tryExport(canvas, 'image/jpeg', quality)
      if (result && result.sizeBytes <= MAX_SIZE_BYTES) {
        return { dataUrl: result.dataUrl, format: 'jpeg', quality, sizeBytes: result.sizeBytes }
      }
    }
  }

  // Could not fit under 1MB or no supported format
  const lastQuality = QUALITY_STEPS[QUALITY_STEPS.length - 1]
  const last = tryExport(canvas, 'image/jpeg', lastQuality)
  const lastSize = last?.sizeBytes ?? 0
  return {
    error: last
      ? `Export exceeds 1MB (${Math.round(lastSize / 1024)}KB at quality ${lastQuality})`
      : 'Neither WebP nor JPEG encoding is supported',
    lastFormat: 'jpeg',
    lastQuality,
    lastSizeBytes: lastSize
  }
}

export function isExportResult(result: ExportResult | ExportError): result is ExportResult {
  return 'dataUrl' in result && !('error' in result)
}

export function getQualitySteps(): readonly number[] {
  return QUALITY_STEPS
}

export function getMaxSizeBytes(): number {
  return MAX_SIZE_BYTES
}
