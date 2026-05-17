import type { Cut } from './CutList'
import type { ExportMeta } from './exportMetadata'
import { hasUnresolvedOverflow } from './textLayout'
import { generateAltText } from './publishGenerator'
import { getMaxSizeBytes } from './imageExport'
import type { ContentRating } from './contentRating'
import { validateContentRating } from './contentRating'

export type ReadinessLevel = 'pass' | 'warn' | 'block'

export interface ReadinessCheck {
  id: string
  label: string
  level: ReadinessLevel
  message: string
}

export interface ReadinessReport {
  ready: boolean
  checks: ReadinessCheck[]
}

const PUBLISHABLE_STATUSES = new Set(['approved', 'exported', 'uploaded', 'published'])

export function checkCutStatus(cuts: Cut[]): ReadinessCheck {
  const notReady = cuts.filter((c) => !PUBLISHABLE_STATUSES.has(c.status ?? ''))
  if (notReady.length === 0) {
    return {
      id: 'cut-status',
      label: 'Cut Status',
      level: 'pass',
      message: 'All cuts approved or beyond'
    }
  }
  return {
    id: 'cut-status',
    label: 'Cut Status',
    level: 'block',
    message: `${notReady.length} cut(s) not yet approved: ${notReady.map((c) => c.id).join(', ')}`
  }
}

export function checkCleanImages(cuts: Cut[]): ReadinessCheck {
  const missing = cuts.filter((c) => !c.imageState?.path || c.imageState.status !== 'done')
  if (missing.length === 0) {
    return {
      id: 'clean-images',
      label: 'Clean Images',
      level: 'pass',
      message: 'All cuts have clean images'
    }
  }
  return {
    id: 'clean-images',
    label: 'Clean Images',
    level: 'block',
    message: `${missing.length} cut(s) missing clean image: ${missing.map((c) => c.id).join(', ')}`
  }
}

function isValidExportMeta(meta: ExportMeta): boolean {
  return !!meta.path && meta.byteSize > 0
}

export function checkFinalExports(cuts: Cut[], exportMetas: ExportMeta[]): ReadinessCheck {
  const validExports = new Set(exportMetas.filter(isValidExportMeta).map((m) => m.cutId))
  const missing = cuts.filter((c) => !validExports.has(c.id))
  if (missing.length === 0) {
    return {
      id: 'final-exports',
      label: 'Final Exports',
      level: 'pass',
      message: 'All cuts have final exports'
    }
  }
  return {
    id: 'final-exports',
    label: 'Final Exports',
    level: 'block',
    message: `${missing.length} cut(s) missing final export: ${missing.map((c) => c.id).join(', ')}`
  }
}

export function checkTextOverflow(cuts: Cut[]): ReadinessCheck {
  const allOverlays = cuts.flatMap((c) => c.overlays ?? [])
  if (!hasUnresolvedOverflow(allOverlays)) {
    return {
      id: 'text-overflow',
      label: 'Text Overflow',
      level: 'pass',
      message: 'No text overflow detected'
    }
  }
  return {
    id: 'text-overflow',
    label: 'Text Overflow',
    level: 'block',
    message: 'One or more overlays have text overflowing their bounds'
  }
}

export function checkImageSize(exportMetas: ExportMeta[]): ReadinessCheck {
  const maxBytes = getMaxSizeBytes()
  const oversized = exportMetas.filter((m) => m.byteSize > maxBytes)
  if (oversized.length === 0) {
    return {
      id: 'image-size',
      label: 'Image Size',
      level: 'pass',
      message: 'All exported images are under 1MB'
    }
  }
  return {
    id: 'image-size',
    label: 'Image Size',
    level: 'block',
    message: `${oversized.length} image(s) exceed 1MB: ${oversized.map((m) => `${m.cutId} (${Math.round(m.byteSize / 1024)}KB)`).join(', ')}`
  }
}

export function checkTranscript(cuts: Cut[]): ReadinessCheck {
  const noContent = cuts.filter((c) => !c.dialogue && !c.narration)
  if (noContent.length === 0) {
    return {
      id: 'transcript',
      label: 'Transcript',
      level: 'pass',
      message: 'All cuts have dialogue or narration'
    }
  }
  if (noContent.length === cuts.length) {
    return {
      id: 'transcript',
      label: 'Transcript',
      level: 'block',
      message: 'No cuts have dialogue or narration — transcript will be empty'
    }
  }
  return {
    id: 'transcript',
    label: 'Transcript',
    level: 'warn',
    message: `${noContent.length} cut(s) have no dialogue or narration: ${noContent.map((c) => c.id).join(', ')}`
  }
}

export function checkAltText(cuts: Cut[]): ReadinessCheck {
  const fallbacks = cuts.filter((c) => generateAltText(c) === c.id)
  if (fallbacks.length === 0) {
    return {
      id: 'alt-text',
      label: 'Alt Text',
      level: 'pass',
      message: 'All cuts have descriptive alt text'
    }
  }
  return {
    id: 'alt-text',
    label: 'Alt Text',
    level: 'warn',
    message: `${fallbacks.length} cut(s) using fallback alt text (ID only): ${fallbacks.map((c) => c.id).join(', ')}`
  }
}

export function checkContentRating(rating: ContentRating | unknown | undefined): ReadinessCheck {
  if (rating === undefined) {
    return {
      id: 'content-rating',
      label: 'Content Rating',
      level: 'block',
      message: 'Content rating is required before publishing'
    }
  }
  const validated = validateContentRating(rating)
  if (validated !== null) {
    return {
      id: 'content-rating',
      label: 'Content Rating',
      level: 'pass',
      message: `Content rating set: ${validated}`
    }
  }
  return {
    id: 'content-rating',
    label: 'Content Rating',
    level: 'block',
    message: 'Content rating is required before publishing'
  }
}

export function validatePublishReadiness(
  cuts: Cut[],
  exportMetas: ExportMeta[] = [],
  opts?: { contentRating?: ContentRating | unknown }
): ReadinessReport {
  const checks = [
    checkCutStatus(cuts),
    checkCleanImages(cuts),
    checkFinalExports(cuts, exportMetas),
    checkImageSize(exportMetas),
    checkTextOverflow(cuts),
    checkTranscript(cuts),
    checkAltText(cuts)
  ]

  if (opts && 'contentRating' in opts) {
    checks.push(checkContentRating(opts.contentRating))
  }

  const ready = checks.every((c) => c.level !== 'block')

  return { ready, checks }
}
