export interface ExportCheckResult {
  webp: boolean
  jpeg: boolean
  fontRender: boolean
  fontSample: string
}

export function checkExportCapabilities(): ExportCheckResult {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 24

  const webp = checkFormat(canvas, 'image/webp')
  const jpeg = checkFormat(canvas, 'image/jpeg')
  const fontRender = checkFontRender(canvas)

  return { webp, jpeg, fontRender, fontSample: 'PlotToon' }
}

function checkFormat(canvas: HTMLCanvasElement, mimeType: string): boolean {
  try {
    const dataUrl = canvas.toDataURL(mimeType)
    return typeof dataUrl === 'string' && dataUrl.startsWith(`data:${mimeType}`)
  } catch {
    return false
  }
}

function checkFontRender(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d')
  if (!ctx) return false

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#000000'
  ctx.font = '16px sans-serif'
  ctx.fillText('PlotToon', 4, 18)

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const pixels = imageData.data
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] > 0) return true
  }
  return false
}
