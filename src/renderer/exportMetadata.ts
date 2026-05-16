import type { Cut } from './CutList'
import type { ExportResult } from './imageExport'

export interface ExportMeta {
  cutId: string
  exportedAt: string
  width: number
  height: number
  mimeType: string
  byteSize: number
  hash: string
  fonts: string[]
  path: string
}

export interface ExportManifest {
  version: number
  exportedAt: string
  cuts: ExportMeta[]
}

const DEFAULT_WIDTH = 320
const DEFAULT_HEIGHT = 480

export function computeHash(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    hash = ((hash << 5) - hash + ch) | 0
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function base64ByteLength(base64: string): number {
  let padding = 0
  if (base64.endsWith('==')) padding = 2
  else if (base64.endsWith('=')) padding = 1
  return Math.floor((base64.length * 3) / 4) - padding
}

export function extractFonts(cut: Cut): string[] {
  const fonts = new Set<string>()
  fonts.add('sans-serif')
  for (const overlay of cut.overlays ?? []) {
    const fontFamily = overlay.style?.fontFamily
    if (fontFamily) fonts.add(fontFamily)
  }
  return [...fonts]
}

export function buildExportMeta(
  cut: Cut,
  exportResult: ExportResult,
  outputPath: string,
  base64?: string
): ExportMeta {
  const width = cut.canvasOverrides?.width ?? DEFAULT_WIDTH
  const height = cut.canvasOverrides?.height ?? DEFAULT_HEIGHT
  const mimeType = exportResult.format === 'webp' ? 'image/webp' : 'image/jpeg'

  const actualBase64 = base64 ?? (exportResult.dataUrl.split(',')[1] ?? '')

  return {
    cutId: cut.id,
    exportedAt: new Date().toISOString(),
    width,
    height,
    mimeType,
    byteSize: base64ByteLength(actualBase64),
    hash: computeHash(actualBase64),
    fonts: extractFonts(cut),
    path: outputPath
  }
}

export function buildExportManifest(metas: ExportMeta[]): ExportManifest {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    cuts: metas
  }
}

export function isAssetProtected(cut: Cut): boolean {
  const status = cut.status ?? ''
  return status === 'exported' || status === 'uploaded' || status === 'published'
}

export function canOverwriteExport(cut: Cut, forceOverwrite: boolean): boolean {
  if (!isAssetProtected(cut)) return true
  return forceOverwrite
}

export function validateExportMeta(meta: ExportMeta): string[] {
  const errors: string[] = []
  if (!meta.cutId) errors.push('cutId is required')
  if (!meta.exportedAt) errors.push('exportedAt is required')
  if (meta.width <= 0) errors.push('width must be positive')
  if (meta.height <= 0) errors.push('height must be positive')
  if (!meta.mimeType) errors.push('mimeType is required')
  if (meta.byteSize <= 0) errors.push('byteSize must be positive')
  if (!meta.hash) errors.push('hash is required')
  if (!meta.path) errors.push('path is required')
  return errors
}
