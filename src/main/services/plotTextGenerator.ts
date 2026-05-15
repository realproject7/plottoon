import type { CutsFile, Cut, Overlay } from './cutsSchema'

function formatImageStatus(cut: Cut): string {
  const s = cut.imageState
  switch (s.status) {
    case 'done':
      return `Image: ✅ done${s.path ? ` (${s.path})` : ''}`
    case 'generating':
      return 'Image: ⏳ generating'
    case 'failed':
      return `Image: ❌ failed${s.errorMessage ? ` — ${s.errorMessage}` : ''}`
    case 'pending':
      return 'Image: ⬜ pending'
  }
}

function formatOverlay(overlay: Overlay): string {
  const tag = overlay.type === 'sfx' ? 'SFX' : 'Text'
  return `- [${tag}] "${overlay.content}"`
}

function formatCut(cut: Cut): string {
  const lines: string[] = []

  lines.push(`### Cut ${cut.order + 1} — \`${cut.id}\``)
  lines.push('')

  if (cut.direction) {
    lines.push(`**Direction:** ${cut.direction}`)
    lines.push('')
  }

  if (cut.dialogue) {
    lines.push(`**Dialogue:** "${cut.dialogue}"`)
    lines.push('')
  }

  if (cut.narration) {
    lines.push(`**Narration:** _${cut.narration}_`)
    lines.push('')
  }

  const sfxOverlays = cut.overlays.filter((o) => o.type === 'sfx')
  const textOverlays = cut.overlays.filter((o) => o.type === 'text')

  if (sfxOverlays.length > 0) {
    lines.push('**SFX:**')
    for (const o of sfxOverlays) {
      lines.push(formatOverlay(o))
    }
    lines.push('')
  }

  if (textOverlays.length > 0) {
    lines.push('**Overlays:**')
    for (const o of textOverlays) {
      lines.push(formatOverlay(o))
    }
    lines.push('')
  }

  if (cut.canvasOverrides) {
    const parts: string[] = []
    if (cut.canvasOverrides.width) parts.push(`width=${cut.canvasOverrides.width}`)
    if (cut.canvasOverrides.height) parts.push(`height=${cut.canvasOverrides.height}`)
    if (cut.canvasOverrides.backgroundColor) parts.push(`bg=${cut.canvasOverrides.backgroundColor}`)
    if (parts.length > 0) {
      lines.push(`**Canvas:** ${parts.join(', ')}`)
      lines.push('')
    }
  }

  if (cut.continuityNotes) {
    lines.push(`**Continuity:** ${cut.continuityNotes}`)
    lines.push('')
  }

  lines.push(formatImageStatus(cut))
  lines.push('')

  return lines.join('\n')
}

function formatPublishState(cutsFile: CutsFile): string {
  const ps = cutsFile.publishState
  const parts: string[] = []
  parts.push(`- Published: ${ps.published ? 'yes' : 'no'}`)
  if (ps.exportedAt) parts.push(`- Exported at: ${ps.exportedAt}`)
  if (ps.format) parts.push(`- Format: ${ps.format}`)
  return parts.join('\n')
}

export function generatePlotText(cutsFile: CutsFile): string {
  const lines: string[] = []

  lines.push(`# ${cutsFile.plotTitle}`)
  lines.push('')

  if (cutsFile.synopsis) {
    lines.push(`> ${cutsFile.synopsis}`)
    lines.push('')
  }

  lines.push(`**Cuts:** ${cutsFile.cuts.length} | **Version:** ${cutsFile.version}`)
  lines.push('')
  lines.push('---')
  lines.push('')

  if (cutsFile.cuts.length === 0) {
    lines.push('*No cuts defined yet.*')
    lines.push('')
  } else {
    const sorted = [...cutsFile.cuts].sort((a, b) => a.order - b.order)
    for (const cut of sorted) {
      lines.push(formatCut(cut))
    }
  }

  lines.push('---')
  lines.push('')
  lines.push('## Publish Status')
  lines.push('')
  lines.push(formatPublishState(cutsFile))
  lines.push('')

  return lines.join('\n')
}
