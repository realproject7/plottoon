import type { Cut } from './CutList'
import { generateTranscript, generateAltText } from './publishGenerator'

export interface TranscriptArtifact {
  plotTitle: string
  generatedAt: string
  entries: TranscriptArtifactEntry[]
}

export interface TranscriptArtifactEntry {
  cutId: string
  altText: string
  dialogue: string
  narration: string
  sfx: string[]
}

export function buildTranscriptArtifact(cuts: Cut[], plotTitle: string): TranscriptArtifact {
  const transcript = generateTranscript(cuts)

  const entries: TranscriptArtifactEntry[] = cuts.map((cut, i) => ({
    cutId: cut.id,
    altText: generateAltText(cut),
    dialogue: transcript[i].dialogue,
    narration: transcript[i].narration,
    sfx: transcript[i].sfx
  }))

  return {
    plotTitle,
    generatedAt: new Date().toISOString(),
    entries
  }
}

export function hasTranscriptContent(artifact: TranscriptArtifact): boolean {
  return artifact.entries.some(
    (e) => e.dialogue.length > 0 || e.narration.length > 0 || e.sfx.length > 0
  )
}

export function hasAltTextForAll(artifact: TranscriptArtifact): boolean {
  return artifact.entries.every((e) => e.altText !== e.cutId)
}

export function transcriptCoverage(artifact: TranscriptArtifact): {
  total: number
  withContent: number
  withAltText: number
} {
  const total = artifact.entries.length
  const withContent = artifact.entries.filter(
    (e) => e.dialogue.length > 0 || e.narration.length > 0 || e.sfx.length > 0
  ).length
  const withAltText = artifact.entries.filter((e) => e.altText !== e.cutId).length

  return { total, withContent, withAltText }
}

export function serializeTranscriptArtifact(artifact: TranscriptArtifact): string {
  return JSON.stringify(artifact, null, 2)
}

export function parseTranscriptArtifact(json: string): TranscriptArtifact | null {
  try {
    const data = JSON.parse(json)
    if (
      typeof data !== 'object' ||
      data === null ||
      typeof data.plotTitle !== 'string' ||
      typeof data.generatedAt !== 'string' ||
      !Array.isArray(data.entries)
    ) {
      return null
    }
    return data as TranscriptArtifact
  } catch {
    return null
  }
}
