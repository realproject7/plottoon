import type { Cut, Overlay } from './CutList'
import { computeLayout, parseLayoutConfig } from './textLayout'

const DEFAULT_WIDTH = 320
const DEFAULT_HEIGHT = 480

export interface RenderOptions {
  backgroundImage?: HTMLImageElement | null
}

export interface DrawCall {
  type: string
  args: unknown[]
}

function getCanvasSize(cut: Cut): { width: number; height: number } {
  return {
    width: cut.canvasOverrides?.width ?? DEFAULT_WIDTH,
    height: cut.canvasOverrides?.height ?? DEFAULT_HEIGHT
  }
}

export function renderCut(
  ctx: CanvasRenderingContext2D,
  cut: Cut,
  options: RenderOptions = {}
): void {
  const { width, height } = getCanvasSize(cut)

  // Background
  const bgColor = cut.canvasOverrides?.backgroundColor ?? '#ffffff'
  ctx.fillStyle = bgColor
  ctx.fillRect(0, 0, width, height)

  // Clean image
  if (options.backgroundImage) {
    ctx.drawImage(options.backgroundImage, 0, 0, width, height)
  }

  // Overlays in array order (z-index)
  const overlays = cut.overlays ?? []
  for (const overlay of overlays) {
    renderOverlay(ctx, overlay)
  }
}

function renderOverlay(ctx: CanvasRenderingContext2D, overlay: Overlay): void {
  const style = overlay.style ?? {}

  ctx.save()

  // Background fill
  const bg = style.background ?? style.backgroundColor
  if (bg && bg !== 'transparent') {
    ctx.fillStyle = bg
    const borderRadius = parseFloat(style.borderRadius ?? '0')
    if (borderRadius > 0) {
      roundRect(ctx, overlay.x, overlay.y, overlay.width, overlay.height, borderRadius)
      ctx.fill()
    } else {
      ctx.fillRect(overlay.x, overlay.y, overlay.width, overlay.height)
    }
  }

  // Border
  const border = style.border
  if (border && border !== 'none') {
    const parts = border.split(/\s+/)
    const borderWidth = parseFloat(parts[0]) || 1
    ctx.lineWidth = borderWidth
    ctx.strokeStyle = parts[2] ?? parts[1] ?? '#000000'
    if (parts[1] === 'dashed' || parts[1] === 'dotted') {
      ctx.setLineDash(parts[1] === 'dotted' ? [2, 2] : [5, 3])
    }
    const borderRadius = parseFloat(style.borderRadius ?? '0')
    if (borderRadius > 0) {
      roundRect(ctx, overlay.x, overlay.y, overlay.width, overlay.height, borderRadius)
      ctx.stroke()
    } else {
      ctx.strokeRect(overlay.x, overlay.y, overlay.width, overlay.height)
    }
    ctx.setLineDash([])
  }

  // Tail anchor
  if (overlay.tailAnchor) {
    const cx = overlay.x + overlay.width / 2
    const cy = overlay.y + overlay.height
    ctx.beginPath()
    ctx.moveTo(cx - 8, cy)
    ctx.lineTo(overlay.tailAnchor.x, overlay.tailAnchor.y)
    ctx.lineTo(cx + 8, cy)
    ctx.closePath()
    const tailFill = bg && bg !== 'transparent' ? bg : '#ffffff'
    ctx.fillStyle = tailFill
    ctx.fill()
    if (border && border !== 'none') {
      ctx.stroke()
    }
  }

  // Text content
  if (overlay.content) {
    const config = parseLayoutConfig(style)
    const layout = computeLayout(overlay)
    const color = style.color ?? '#000000'
    const fontStyle = style.fontStyle ?? 'normal'
    const fontWeight = style.fontWeight ?? 'normal'
    const textAlign = (style.textAlign ?? 'center') as CanvasTextAlign

    ctx.fillStyle = color
    ctx.font = `${fontStyle} ${fontWeight} ${config.fontSize}px sans-serif`
    ctx.textAlign = textAlign
    ctx.textBaseline = 'top'

    const alignX =
      textAlign === 'center'
        ? overlay.x + overlay.width / 2
        : textAlign === 'right'
          ? overlay.x + overlay.width - config.paddingX
          : overlay.x + config.paddingX

    for (const line of layout.lines) {
      ctx.fillText(line.text, alignX, overlay.y + line.y - config.fontSize)
    }
  }

  ctx.restore()
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.arcTo(x + w, y, x + w, y + radius, radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius)
  ctx.lineTo(x + radius, y + h)
  ctx.arcTo(x, y + h, x, y + h - radius, radius)
  ctx.lineTo(x, y + radius)
  ctx.arcTo(x, y, x + radius, y, radius)
  ctx.closePath()
}

export function flattenCut(
  cut: Cut,
  options: RenderOptions = {}
): { canvas: HTMLCanvasElement; width: number; height: number } {
  const { width, height } = getCanvasSize(cut)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to get 2D rendering context')
  renderCut(ctx, cut, options)
  return { canvas, width, height }
}
