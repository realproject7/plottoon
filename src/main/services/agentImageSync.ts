/**
 * Agent-generated cut-image sync (#278).
 *
 * The agent runtime (#272) writes clean cut images directly into the
 * project under `plots/<plot>/assets/<cut>/clean-vNNN.{webp,png,jpg,
 * jpeg}`. This module scans those folders, validates the files, and
 * returns a list of revisions the renderer should adopt into
 * `cuts.json` (without overwriting anything that's already registered).
 *
 * Design notes:
 *  - Filenames are PINNED to `clean-vNNN.<ext>` so the version we
 *    register matches the on-disk name. This is the same shape #277's
 *    AGENTS.md guide instructs the agent to write. If the agent emits a
 *    different name (e.g. `final.webp`), the file is surfaced as
 *    rejected with a safe reason — never silently renamed.
 *  - `knownVersions` excludes versions already in `imageState.revisions`
 *    so the same file isn't adopted twice. We never delete or
 *    overwrite on disk: adoption is metadata-only on the renderer side.
 *  - The size cap (50 MiB) is defense in depth against a runaway agent
 *    that dumps a 4 GB intermediate render into the assets folder.
 *    Real outputs are well under 5 MiB.
 *  - Error messages NEVER include the absolute path, only the
 *    project-relative path. Absolute paths could carry the user's
 *    private project root which #218/#219 keep out of renderer
 *    surfaces.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { resolveProjectPath } from './safePaths'
import { getProjectRoot } from './projectRegistry'

const ALLOWED_EXTENSIONS = new Set(['.webp', '.jpeg', '.jpg', '.png'])
const MAX_IMAGE_BYTES = 50 * 1024 * 1024
const VERSION_PATTERN = /^clean-v(\d{3})\.(webp|jpeg|jpg|png)$/i

/**
 * Strict single-segment validator. `resolveProjectPath` catches paths
 * that escape the project root, but `cutId='..'` resolves BACK inside
 * the root to the parent `assets/` directory — still a leak. So we
 * reject any segment containing path separators or relative markers
 * before passing it to `resolveProjectPath`.
 */
function assertSingleSegment(label: string, value: string): void {
  if (value.length === 0) {
    throw new Error(`${label} must be a non-empty single path segment`)
  }
  if (value.includes('/') || value.includes('\\')) {
    throw new Error(`${label} must not contain path separators (path escape attempt)`)
  }
  if (value === '.' || value === '..') {
    throw new Error(`${label} must not be a relative path marker (path escape attempt)`)
  }
}

export interface AdoptedRevision {
  cutId: string
  version: number
  filename: string
  relativePath: string
  /**
   * mtime so the renderer can surface "just generated" hints. We use
   * mtime rather than birthtime since the agent often overwrites a
   * file in place during retries (and birthtime isn't reliable on all
   * platforms).
   */
  createdAt: string
  sizeBytes: number
}

export interface RejectedAgentImage {
  cutId: string
  filename: string
  reason: string
}

export interface AgentImageSyncResult {
  adopted: AdoptedRevision[]
  rejected: RejectedAgentImage[]
}

export interface CutSyncRequest {
  cutId: string
  /**
   * Versions already registered in `imageState.revisions` — these are
   * filtered out of the result so we don't re-adopt them. Renderers
   * read this from the live cuts.json view.
   */
  knownVersions: readonly number[]
}

interface CandidateFile {
  filename: string
  version: number
  ext: string
}

function classify(filename: string): CandidateFile | null {
  // Strict regex: only `clean-vNNN.<ext>` is a sync candidate. The
  // manual-import path also produces these names, so the two paths
  // share filename conventions.
  const match = VERSION_PATTERN.exec(filename)
  if (!match) return null
  const version = parseInt(match[1], 10)
  if (!Number.isFinite(version) || version < 1) return null
  const ext = `.${match[2].toLowerCase()}`
  if (!ALLOWED_EXTENSIONS.has(ext)) return null
  return { filename, version, ext }
}

async function statSafe(absolutePath: string): Promise<{ ok: boolean; size: number; mtime: Date }> {
  try {
    const s = await fs.stat(absolutePath)
    if (!s.isFile()) return { ok: false, size: 0, mtime: new Date(0) }
    return { ok: true, size: s.size, mtime: s.mtime }
  } catch {
    return { ok: false, size: 0, mtime: new Date(0) }
  }
}

/**
 * Sync a single cut. Used by the per-cut IPC + by the batch helper.
 *
 * Returns a deterministic shape — even when the asset dir is empty,
 * `adopted` and `rejected` are present so the renderer's reducer can
 * pattern-match without optional checks.
 */
export async function syncAgentImagesForCut(
  projectId: string,
  plotSlug: string,
  request: CutSyncRequest
): Promise<AgentImageSyncResult> {
  const adopted: AdoptedRevision[] = []
  const rejected: RejectedAgentImage[] = []

  // Defense in depth: assertSingleSegment rejects `..` / separators
  // BEFORE we hand the value to `resolveProjectPath`. The latter only
  // catches escapes that leave the project root entirely, but
  // `cutId='..'` would resolve INSIDE the root (to `assets/`) and
  // surface sibling cuts. Single-segment-only is the correct contract.
  assertSingleSegment('plotSlug', plotSlug)
  assertSingleSegment('cutId', request.cutId)

  const root = getProjectRoot(projectId)
  const assetDir = resolveProjectPath(root, 'plots', plotSlug, 'assets', request.cutId)

  let entries: string[]
  try {
    entries = await fs.readdir(assetDir)
  } catch {
    // No asset dir for this cut yet — totally normal for a fresh cut.
    return { adopted, rejected }
  }

  const knownSet = new Set(request.knownVersions)
  // Sort by version ascending so the highest is always last; the
  // renderer treats the last adopted version as the new current.
  const sorted = [...entries].sort()

  for (const entry of sorted) {
    // Anything matching `clean-v*` but NOT the strict pattern is
    // surfaced as rejected so the user knows why their file didn't
    // adopt. Files that clearly aren't trying to be sync candidates
    // (e.g. `notes.txt`, `plot-text.md`) are silently ignored.
    const looksLikeCandidate = /^clean-v/i.test(entry)
    const classified = classify(entry)
    if (!classified) {
      if (looksLikeCandidate) {
        rejected.push({
          cutId: request.cutId,
          filename: entry,
          reason: `Filename does not match clean-vNNN.<webp|png|jpg|jpeg>`
        })
      }
      continue
    }

    // Skip versions already known to the renderer — never overwrite.
    if (knownSet.has(classified.version)) continue

    const absolutePath = resolveProjectPath(
      root,
      'plots',
      plotSlug,
      'assets',
      request.cutId,
      classified.filename
    )
    const stat = await statSafe(absolutePath)
    if (!stat.ok) {
      // readdir saw it but stat couldn't read it; race with a delete
      // or a symlink to a missing target. Skip silently — surfacing
      // the path here could leak local layout.
      continue
    }
    if (stat.size === 0) {
      rejected.push({
        cutId: request.cutId,
        filename: classified.filename,
        reason: 'File is empty'
      })
      continue
    }
    if (stat.size > MAX_IMAGE_BYTES) {
      rejected.push({
        cutId: request.cutId,
        filename: classified.filename,
        reason: `File exceeds ${Math.floor(MAX_IMAGE_BYTES / (1024 * 1024))} MiB limit`
      })
      continue
    }

    adopted.push({
      cutId: request.cutId,
      version: classified.version,
      filename: classified.filename,
      relativePath: path.join('plots', plotSlug, 'assets', request.cutId, classified.filename),
      createdAt: stat.mtime.toISOString(),
      sizeBytes: stat.size
    })
  }

  return { adopted, rejected }
}

/**
 * Batch sync — one round-trip for the whole active plot. The renderer
 * passes the list of (cutId, knownVersions) pairs derived from its
 * current cuts.json view. We merge per-cut results into a flat
 * AgentImageSyncResult so the renderer can apply the diff in one pass.
 */
export async function syncAgentImagesForPlot(
  projectId: string,
  plotSlug: string,
  requests: readonly CutSyncRequest[]
): Promise<AgentImageSyncResult> {
  const adopted: AdoptedRevision[] = []
  const rejected: RejectedAgentImage[] = []
  for (const req of requests) {
    const result = await syncAgentImagesForCut(projectId, plotSlug, req)
    adopted.push(...result.adopted)
    rejected.push(...result.rejected)
  }
  return { adopted, rejected }
}
