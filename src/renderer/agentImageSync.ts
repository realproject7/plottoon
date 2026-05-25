/**
 * Renderer-side helpers for #278: take an `AgentImageSyncResult`
 * returned by the main process and merge the new revisions into the
 * live `cuts.json` view.
 *
 * Keeping the merge logic pure (no IPC inside) lets us unit-test the
 * reducer in isolation and lets Workspace.tsx focus on the wiring +
 * UI surfacing.
 */

import type { Cut } from './CutList'

export interface AdoptedRevisionView {
  cutId: string
  version: number
  filename: string
  relativePath: string
  createdAt: string
  sizeBytes: number
}

export interface RejectedAgentImageView {
  cutId: string
  filename: string
  reason: string
}

export interface AgentImageSyncSnapshot {
  adopted: AdoptedRevisionView[]
  rejected: RejectedAgentImageView[]
}

/**
 * Build the per-cut knownVersions list the main-process sync IPC
 * expects. Reads `imageState.revisions[].version` and skips cuts that
 * never had an imageState (those still adopt fine — knownVersions=[]).
 */
export function buildSyncRequests(
  cuts: readonly Cut[]
): Array<{ cutId: string; knownVersions: number[] }> {
  return cuts.map((c) => ({
    cutId: c.id,
    knownVersions: (c.imageState?.revisions ?? []).map((r) => r.version)
  }))
}

/**
 * Merge a sync result into the cuts array. Per ticket #278:
 *  - Never overwrite an existing revision (we add to the array; the
 *    backend already excluded knownVersions, so duplicates can't enter
 *    here even on a race, but the dedupe-by-version filter below is
 *    defensive in case the caller passes a stale list).
 *  - The highest newly-adopted revision per cut becomes the current
 *    image (mirrors the manual-import behaviour). Status flips to
 *    'done'. If you'd rather keep the user's existing current image,
 *    we'd need a separate user preference — out of scope for #278.
 *  - Preserves manual-import revisions untouched.
 */
export function mergeAdoptedRevisions(
  cuts: readonly Cut[],
  adopted: readonly AdoptedRevisionView[]
): Cut[] {
  if (adopted.length === 0) return cuts as Cut[]
  const byCut = new Map<string, AdoptedRevisionView[]>()
  for (const a of adopted) {
    const list = byCut.get(a.cutId) ?? []
    list.push(a)
    byCut.set(a.cutId, list)
  }
  return cuts.map((c) => {
    const newRevs = byCut.get(c.id)
    if (!newRevs || newRevs.length === 0) return c
    const existing = c.imageState?.revisions ?? []
    const existingVersions = new Set(existing.map((r) => r.version))
    const additions = newRevs
      .filter((r) => !existingVersions.has(r.version))
      .map((r) => ({
        version: r.version,
        path: r.relativePath,
        createdAt: r.createdAt
      }))
    if (additions.length === 0) return c
    const merged = [...existing, ...additions].sort((a, b) => a.version - b.version)
    // Newest adopted version (max across new additions) becomes the
    // current image — matches manual-import flow.
    const newest = additions.reduce((max, r) => (r.version > max.version ? r : max), additions[0])
    return {
      ...c,
      imageState: {
        ...c.imageState,
        status: 'done' as const,
        path: newest.path,
        generationBackend: c.imageState?.generationBackend ?? 'agent',
        revisions: merged
      }
    }
  })
}
