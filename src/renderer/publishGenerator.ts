import type { Cut } from './CutList'

export interface CutUrl {
  cutId: string
  url: string
}

export interface TranscriptEntry {
  cutId: string
  dialogue: string
  narration: string
  sfx: string[]
}

export interface GenerateOptions {
  cuts: Cut[]
  urls: CutUrl[]
  plotTitle: string
  dryRun?: boolean
}

export function generateTranscript(cuts: Cut[]): TranscriptEntry[] {
  return cuts.map((cut) => {
    const sfx: string[] = []
    for (const overlay of cut.overlays ?? []) {
      if (overlay.type === 'sfx' && overlay.content) {
        sfx.push(overlay.content)
      }
    }
    return {
      cutId: cut.id,
      dialogue: cut.dialogue ?? '',
      narration: cut.narration ?? '',
      sfx
    }
  })
}

export function generateAltText(cut: Cut): string {
  const parts: string[] = []
  if (cut.direction) parts.push(cut.direction)
  if (cut.dialogue) parts.push(`Dialogue: "${cut.dialogue}"`)
  if (cut.narration) parts.push(`Narration: ${cut.narration}`)
  const sfx = (cut.overlays ?? [])
    .filter((o) => o.type === 'sfx' && o.content)
    .map((o) => o.content)
  if (sfx.length > 0) parts.push(`SFX: ${sfx.join(', ')}`)
  return parts.join('. ') || cut.id
}

export function generatePublishMarkdown(options: GenerateOptions): string {
  const { cuts, urls, plotTitle, dryRun = false } = options

  const urlMap = new Map(urls.map((u) => [u.cutId, u.url]))

  // Validate URLs unless dry-run
  if (!dryRun) {
    const missing = cuts
      .filter((c) => {
        const url = urlMap.get(c.id)
        return !url || url.trim().length === 0
      })
      .map((c) => c.id)
    if (missing.length > 0) {
      throw new Error(`Missing required URLs for cuts: ${missing.join(', ')}`)
    }
  }

  const lines: string[] = []
  lines.push(`# ${plotTitle}`)
  lines.push('')

  for (const cut of cuts) {
    const url = urlMap.get(cut.id) ?? `[PLACEHOLDER:${cut.id}]`
    const alt = generateAltText(cut)
    lines.push(`![${alt}](${url})`)
    lines.push('')
  }

  // Transcript section
  lines.push('---')
  lines.push('')
  lines.push('## Transcript')
  lines.push('')

  const transcript = generateTranscript(cuts)
  for (const entry of transcript) {
    lines.push(`### ${entry.cutId}`)
    lines.push('')
    if (entry.dialogue) lines.push(`**Dialogue:** ${entry.dialogue}`)
    if (entry.narration) lines.push(`*Narration:* ${entry.narration}`)
    if (entry.sfx.length > 0) lines.push(`SFX: ${entry.sfx.join(', ')}`)
    lines.push('')
  }

  return lines.join('\n')
}

export function generateTranscriptText(cuts: Cut[]): string {
  const transcript = generateTranscript(cuts)
  const lines: string[] = []
  for (const entry of transcript) {
    lines.push(`[${entry.cutId}]`)
    if (entry.dialogue) lines.push(`  Dialogue: ${entry.dialogue}`)
    if (entry.narration) lines.push(`  Narration: ${entry.narration}`)
    if (entry.sfx.length > 0) lines.push(`  SFX: ${entry.sfx.join(', ')}`)
    lines.push('')
  }
  return lines.join('\n')
}
