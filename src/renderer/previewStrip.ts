import type { Cut } from './CutList'
import { flattenCut } from './flattenRenderer'

const DEFAULT_WIDTH = 320
const DEFAULT_HEIGHT = 480

export interface StripCutInput {
  cut: Cut
  backgroundImage?: HTMLImageElement | null
}

export interface PreviewStripResult {
  canvas: HTMLCanvasElement
  width: number
  height: number
  cutCount: number
}

function getCutHeight(cut: Cut): number {
  return cut.canvasOverrides?.height ?? DEFAULT_HEIGHT
}

function getCutWidth(cut: Cut): number {
  return cut.canvasOverrides?.width ?? DEFAULT_WIDTH
}

export function computeStripDimensions(cuts: Cut[]): {
  width: number
  totalHeight: number
  offsets: number[]
} {
  const width = cuts.length > 0 ? Math.max(...cuts.map(getCutWidth)) : DEFAULT_WIDTH
  let totalHeight = 0
  const offsets: number[] = []
  for (const cut of cuts) {
    offsets.push(totalHeight)
    totalHeight += getCutHeight(cut)
  }
  return { width, totalHeight, offsets }
}

export function renderPreviewStrip(inputs: StripCutInput[]): PreviewStripResult {
  const cuts = inputs.map((i) => i.cut)
  const { width, totalHeight, offsets } = computeStripDimensions(cuts)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = totalHeight || 1

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to get 2D rendering context')

  for (let i = 0; i < inputs.length; i++) {
    const { cut, backgroundImage } = inputs[i]
    const cutCanvas = flattenCut(cut, { backgroundImage: backgroundImage ?? undefined })

    const yOffset = offsets[i]
    const cutWidth = getCutWidth(cut)
    const xOffset = Math.floor((width - cutWidth) / 2)

    ctx.drawImage(cutCanvas.canvas, xOffset, yOffset)
  }

  return { canvas, width, height: totalHeight, cutCount: inputs.length }
}

export async function generatePreviewStrip(
  inputs: StripCutInput[],
  projectId: string,
  plotSlug: string
): Promise<{ path: string; width: number; height: number; cutCount: number }> {
  const result = renderPreviewStrip(inputs)

  const dataUrl = result.canvas.toDataURL('image/png')
  const base64 = dataUrl.split(',')[1] ?? ''

  const outputPath = `plots/${plotSlug}/exports/preview-strip.png`
  const segments = outputPath.split('/')
  await window.plottoon.fs.writeProjectFileBinary(projectId, segments, base64)

  return {
    path: outputPath,
    width: result.width,
    height: result.height,
    cutCount: result.cutCount
  }
}
