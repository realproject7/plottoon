import type { Cut } from './CutList'
import type { ExportMeta } from './exportMetadata'
import { hasUnresolvedOverflow } from './textLayout'
import { generateAltText } from './publishGenerator'
import { getMaxSizeBytes } from './imageExport'

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

export function checkImagesExported(cuts: Cut[]): ReadinessCheck {
  const missing = cuts.filter((c) => !c.imageState?.path || c.imageState.status !== 'done')
  if (missing.length === 0) {
    return {
      id: 'images-exported',
      label: 'Images',
      level: 'pass',
      message: 'All cuts have exported images'
    }
  }
  return {
    id: 'images-exported',
    label: 'Images',
    level: 'block',
    message: `${missing.length} cut(s) missing exported image: ${missing.map((c) => c.id).join(', ')}`
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

export function validatePublishReadiness(
  cuts: Cut[],
  exportMetas: ExportMeta[] = []
): ReadinessReport {
  const checks = [
    checkCutStatus(cuts),
    checkImagesExported(cuts),
    checkImageSize(exportMetas),
    checkTextOverflow(cuts),
    checkTranscript(cuts),
    checkAltText(cuts)
  ]

  const ready = checks.every((c) => c.level !== 'block')

  return { ready, checks }
}
