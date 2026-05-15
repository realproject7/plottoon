import type { Cut } from './CutList'

export type CutStatus =
  | 'planned'
  | 'draft'
  | 'needs_revision'
  | 'approved'
  | 'exported'
  | 'uploaded'
  | 'published'

const PROTECTED_STATUSES: ReadonlySet<string> = new Set(['exported', 'uploaded', 'published'])

const IMAGE_PROTECTED_STATUSES: ReadonlySet<string> = new Set([
  'approved',
  'exported',
  'uploaded',
  'published'
])

export function isProtected(cut: Cut): boolean {
  return PROTECTED_STATUSES.has(cut.status ?? '')
}

export function isImageProtected(cut: Cut): boolean {
  return IMAGE_PROTECTED_STATUSES.has(cut.status ?? '')
}

function nextCutId(cuts: Cut[]): string {
  let max = 0
  for (const c of cuts) {
    const m = c.id.match(/^cut-(\d+)$/)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `cut-${String(max + 1).padStart(3, '0')}`
}

export function addCut(cuts: Cut[], afterId?: string): Cut[] {
  const id = nextCutId(cuts)
  const newCut: Cut = { id, status: 'planned' }
  if (!afterId) return [...cuts, newCut]
  const idx = cuts.findIndex((c) => c.id === afterId)
  if (idx === -1) return [...cuts, newCut]
  const result = [...cuts]
  result.splice(idx + 1, 0, newCut)
  return result
}

export function deleteCut(cuts: Cut[], cutId: string): Cut[] {
  const cut = cuts.find((c) => c.id === cutId)
  if (!cut) return cuts
  if (isProtected(cut)) return cuts
  return cuts.filter((c) => c.id !== cutId)
}

export function duplicateCut(cuts: Cut[], cutId: string): Cut[] {
  const idx = cuts.findIndex((c) => c.id === cutId)
  if (idx === -1) return cuts
  const source = cuts[idx]
  const id = nextCutId(cuts)
  const duplicate: Cut = {
    ...structuredClone(source),
    id,
    status: 'planned',
    imageState: undefined
  }
  const result = [...cuts]
  result.splice(idx + 1, 0, duplicate)
  return result
}

export function moveCut(cuts: Cut[], cutId: string, direction: 'up' | 'down'): Cut[] {
  const idx = cuts.findIndex((c) => c.id === cutId)
  if (idx === -1) return cuts
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1
  if (targetIdx < 0 || targetIdx >= cuts.length) return cuts
  const result = [...cuts]
  ;[result[idx], result[targetIdx]] = [result[targetIdx], result[idx]]
  return result
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  planned: ['draft'],
  draft: ['needs_revision', 'approved'],
  needs_revision: ['draft'],
  approved: ['needs_revision']
}

export function canTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

export function setStatus(cuts: Cut[], cutId: string, status: CutStatus): Cut[] {
  return cuts.map((c) => {
    if (c.id !== cutId) return c
    const current = c.status ?? 'planned'
    if (isProtected(c)) return c
    if (!canTransition(current, status)) return c
    return { ...c, status }
  })
}
