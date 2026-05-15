import type { Overlay } from './CutList'

export interface LayoutConfig {
  fontSize: number
  lineHeight: number
  paddingX: number
  paddingY: number
}

export interface WrappedLine {
  text: string
  y: number
}

export interface LayoutResult {
  lines: WrappedLine[]
  totalHeight: number
  overflow: boolean
}

const DEFAULT_LAYOUT: LayoutConfig = {
  fontSize: 13,
  lineHeight: 1.4,
  paddingX: 12,
  paddingY: 8
}

export function parseLayoutConfig(style?: Record<string, string>): LayoutConfig {
  const fontSize = style?.fontSize
    ? parseFloat(style.fontSize) || DEFAULT_LAYOUT.fontSize
    : DEFAULT_LAYOUT.fontSize
  const lineHeight = DEFAULT_LAYOUT.lineHeight
  const paddingStr = style?.padding ?? ''
  const paddingParts = paddingStr.split(/\s+/).map((p) => parseFloat(p) || 0)
  const paddingY = paddingParts[0] || DEFAULT_LAYOUT.paddingY
  const paddingX =
    paddingParts.length >= 2 ? paddingParts[1] : paddingParts[0] || DEFAULT_LAYOUT.paddingX
  return { fontSize, lineHeight, paddingX, paddingY }
}

export function wrapText(content: string, availableWidth: number, charsPerLine: number): string[] {
  if (!content || availableWidth <= 0 || charsPerLine <= 0) return []

  const words = content.split(/\s+/).filter((w) => w.length > 0)
  if (words.length === 0) return []

  const lines: string[] = []
  let currentLine = ''

  for (const word of words) {
    if (word.length > charsPerLine) {
      if (currentLine) {
        lines.push(currentLine)
        currentLine = ''
      }
      for (let i = 0; i < word.length; i += charsPerLine) {
        lines.push(word.slice(i, i + charsPerLine))
      }
      continue
    }

    const candidate = currentLine ? `${currentLine} ${word}` : word
    if (candidate.length <= charsPerLine) {
      currentLine = candidate
    } else {
      if (currentLine) lines.push(currentLine)
      currentLine = word
    }
  }
  if (currentLine) lines.push(currentLine)

  return lines
}

export function computeLayout(overlay: Overlay): LayoutResult {
  const config = parseLayoutConfig(overlay.style)
  const innerWidth = overlay.width - config.paddingX * 2
  const innerHeight = overlay.height - config.paddingY * 2
  const charWidth = config.fontSize * 0.6
  const charsPerLine = Math.max(1, Math.floor(innerWidth / charWidth))
  const lineStep = config.fontSize * config.lineHeight

  const lines = wrapText(overlay.content, innerWidth, charsPerLine)

  const wrappedLines: WrappedLine[] = lines.map((text, i) => ({
    text,
    y: config.paddingY + config.fontSize + i * lineStep
  }))

  const totalHeight = lines.length * lineStep
  const overflow = totalHeight > innerHeight

  return { lines: wrappedLines, totalHeight, overflow }
}

export function detectOverflow(overlay: Overlay): boolean {
  if (!overlay.content) return false
  return computeLayout(overlay).overflow
}

export function detectAllOverflows(
  overlays: Overlay[]
): Array<{ overlayId: string; overflow: boolean }> {
  return overlays.map((o) => ({
    overlayId: o.id,
    overflow: detectOverflow(o)
  }))
}

export function hasUnresolvedOverflow(overlays: Overlay[]): boolean {
  return overlays.some((o) => detectOverflow(o))
}
