import type { Cut } from './CutList'
import { exportCutImage, isExportResult } from './imageExport'
import {
  buildExportMeta,
  buildExportManifest,
  isAssetProtected,
  canOverwriteExport
} from './exportMetadata'
import type { ExportMeta, ExportManifest } from './exportMetadata'
import { flattenCut } from './flattenRenderer'

export interface ExportCutOptions {
  cut: Cut
  projectId: string
  plotSlug: string
  backgroundImage?: HTMLImageElement | null
  forceOverwrite?: boolean
}

export interface ExportCutSuccess {
  ok: true
  meta: ExportMeta
}

export interface ExportCutFailure {
  ok: false
  error: string
  cutId: string
}

export type ExportCutResult = ExportCutSuccess | ExportCutFailure

export interface ExportPlotOptions {
  cuts: Cut[]
  projectId: string
  plotSlug: string
  backgroundImages?: Map<string, HTMLImageElement>
  forceOverwrite?: boolean
}

export interface ExportPlotResult {
  results: ExportCutResult[]
  manifest: ExportManifest | null
}

function dataUrlToBase64(dataUrl: string): string {
  return dataUrl.split(',')[1] ?? ''
}

export async function exportSingleCut(options: ExportCutOptions): Promise<ExportCutResult> {
  const { cut, projectId, plotSlug, backgroundImage, forceOverwrite = false } = options

  // Protection check
  if (isAssetProtected(cut) && !canOverwriteExport(cut, forceOverwrite)) {
    return {
      ok: false,
      error: `Cut ${cut.id} is ${cut.status} and cannot be overwritten without explicit force`,
      cutId: cut.id
    }
  }

  // Flatten
  const { canvas } = flattenCut(cut, { backgroundImage })

  // Compress
  const imageResult = exportCutImage(canvas)
  if (!isExportResult(imageResult)) {
    return { ok: false, error: imageResult.error, cutId: cut.id }
  }

  // Build output path and write
  const ext = imageResult.format === 'webp' ? 'webp' : 'jpg'
  const outputPath = `plots/${plotSlug}/exports/${cut.id}.${ext}`
  const segments = outputPath.split('/')

  const base64 = dataUrlToBase64(imageResult.dataUrl)
  await window.plottoon.fs.writeProjectFile(projectId, segments, base64)

  // Build and write metadata
  const meta = buildExportMeta(cut, imageResult, outputPath)
  const metaPath = `plots/${plotSlug}/exports/${cut.id}.meta.json`
  const metaSegments = metaPath.split('/')
  await window.plottoon.fs.writeProjectFile(projectId, metaSegments, JSON.stringify(meta, null, 2))

  return { ok: true, meta }
}

export async function exportPlot(options: ExportPlotOptions): Promise<ExportPlotResult> {
  const { cuts, projectId, plotSlug, backgroundImages, forceOverwrite = false } = options

  const results: ExportCutResult[] = []
  const metas: ExportMeta[] = []

  for (const cut of cuts) {
    const bgImage = backgroundImages?.get(cut.id) ?? null
    const result = await exportSingleCut({
      cut,
      projectId,
      plotSlug,
      backgroundImage: bgImage,
      forceOverwrite
    })
    results.push(result)
    if (result.ok) {
      metas.push(result.meta)
    }
  }

  // Write manifest if any cuts exported successfully
  let manifest: ExportManifest | null = null
  if (metas.length > 0) {
    manifest = buildExportManifest(metas)
    const manifestPath = `plots/${plotSlug}/exports/manifest.json`
    const manifestSegments = manifestPath.split('/')
    await window.plottoon.fs.writeProjectFile(
      projectId,
      manifestSegments,
      JSON.stringify(manifest, null, 2)
    )
  }

  return { results, manifest }
}
