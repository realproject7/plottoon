import type { Cut, Overlay, TailAnchor } from './CutList'

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
  const newCut: Cut = {
    id,
    status: 'planned',
    dialogue: '',
    direction: '',
    imageState: { status: 'pending', path: null, prompt: null, seed: null },
    overlays: []
  }
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
    imageState: { status: 'pending', path: null, prompt: null, seed: null },
    overlays: source.overlays ? structuredClone(source.overlays) : []
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

export function addOverlay(cuts: Cut[], cutId: string, overlay: Overlay): Cut[] {
  return cuts.map((c) => {
    if (c.id !== cutId) return c
    return { ...c, overlays: [...(c.overlays ?? []), overlay] }
  })
}

export function deleteOverlay(cuts: Cut[], cutId: string, overlayId: string): Cut[] {
  return cuts.map((c) => {
    if (c.id !== cutId || !c.overlays) return c
    return { ...c, overlays: c.overlays.filter((o) => o.id !== overlayId) }
  })
}

export function moveOverlay(
  cuts: Cut[],
  cutId: string,
  overlayId: string,
  x: number,
  y: number
): Cut[] {
  return cuts.map((c) => {
    if (c.id !== cutId || !c.overlays) return c
    return {
      ...c,
      overlays: c.overlays.map((o) => (o.id === overlayId ? { ...o, x, y } : o))
    }
  })
}

export function resizeOverlay(
  cuts: Cut[],
  cutId: string,
  overlayId: string,
  width: number,
  height: number
): Cut[] {
  return cuts.map((c) => {
    if (c.id !== cutId || !c.overlays) return c
    return {
      ...c,
      overlays: c.overlays.map((o) =>
        o.id === overlayId ? { ...o, width: Math.max(1, width), height: Math.max(1, height) } : o
      )
    }
  })
}

export function duplicateOverlay(
  cuts: Cut[],
  cutId: string,
  overlayId: string
): { cuts: Cut[]; newId: string | null } {
  let newId: string | null = null
  const result = cuts.map((c) => {
    if (c.id !== cutId || !c.overlays) return c
    const source = c.overlays.find((o) => o.id === overlayId)
    if (!source) return c
    const dupId = `ovl-${Date.now()}-dup`
    newId = dupId
    const dup: Overlay = {
      ...structuredClone(source),
      id: dupId,
      x: source.x + 10,
      y: source.y + 10
    }
    return { ...c, overlays: [...c.overlays, dup] }
  })
  return { cuts: result, newId }
}

export function reorderOverlay(
  cuts: Cut[],
  cutId: string,
  overlayId: string,
  direction: 'up' | 'down'
): Cut[] {
  return cuts.map((c) => {
    if (c.id !== cutId || !c.overlays) return c
    const idx = c.overlays.findIndex((o) => o.id === overlayId)
    if (idx === -1) return c
    const targetIdx = direction === 'up' ? idx + 1 : idx - 1
    if (targetIdx < 0 || targetIdx >= c.overlays.length) return c
    const next = [...c.overlays]
    ;[next[idx], next[targetIdx]] = [next[targetIdx], next[idx]]
    return { ...c, overlays: next }
  })
}

export function setOverlayTailAnchor(
  cuts: Cut[],
  cutId: string,
  overlayId: string,
  tailAnchor: TailAnchor | undefined
): Cut[] {
  return cuts.map((c) => {
    if (c.id !== cutId || !c.overlays) return c
    return {
      ...c,
      overlays: c.overlays.map((o) => (o.id === overlayId ? { ...o, tailAnchor } : o))
    }
  })
}

function normalizeImageState(
  state: Cut['imageState']
): { status: string; path: string | null; prompt: string | null; seed: number | null } & Record<
  string,
  unknown
> {
  if (!state) return { status: 'pending', path: null, prompt: null, seed: null }
  return {
    ...state,
    status: state.status ?? 'pending',
    path: state.path ?? null,
    prompt: state.prompt ?? null,
    seed: state.seed ?? null
  }
}

export function normalizeCutsForSave(cuts: Cut[]): Cut[] {
  return cuts.map((c, index) => ({
    ...c,
    order: index,
    dialogue: c.dialogue ?? '',
    direction: c.direction ?? '',
    imageState: normalizeImageState(c.imageState),
    overlays: c.overlays ?? []
  }))
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
