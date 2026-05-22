import fs from 'node:fs/promises'
import path from 'node:path'
import { readProjectMeta, type ProjectMeta } from './projectMeta'
import { registerProject } from './projectRegistry'
import { normalizeWalletAddress } from '../../shared/walletIdentity'

export interface DiscoveredProject {
  id: string | null
  path: string
  meta: ProjectMeta | null
  error: string | null
}

export interface PartitionedDiscovery {
  /** Projects whose `meta.wallet.address` matches the active wallet. */
  owned: DiscoveredProject[]
  /**
   * Projects with no `meta.wallet` field at all. These predate #220 and
   * require explicit user-driven assignment — never silently attached.
   */
  legacy: DiscoveredProject[]
  /**
   * Projects assigned to a different known wallet. Hidden from the active
   * wallet's view but kept around so a user that switches back sees them.
   */
  otherWallets: DiscoveredProject[]
  /** Projects that failed to parse — surfaced so the user can fix them. */
  errors: DiscoveredProject[]
}

export async function discoverProjects(parentDir: string): Promise<DiscoveredProject[]> {
  let entries: string[]
  try {
    entries = await fs.readdir(parentDir)
  } catch {
    return []
  }

  const results: DiscoveredProject[] = []

  for (const entry of entries) {
    const fullPath = path.join(parentDir, entry)
    const stat = await fs.stat(fullPath).catch(() => null)
    if (!stat?.isDirectory()) continue

    try {
      await fs.access(path.join(fullPath, 'project.json'))
    } catch {
      continue
    }

    try {
      const meta = await readProjectMeta(fullPath)
      const id = registerProject(fullPath)
      results.push({ id, path: fullPath, meta, error: null })
    } catch (err) {
      results.push({
        id: null,
        path: fullPath,
        meta: null,
        error: err instanceof Error ? err.message : 'Unknown error reading project.json'
      })
    }
  }

  return results
}

/**
 * Partition the raw discovery output into the four buckets the renderer
 * needs. When `activeAddress` is null, owned is empty and every legitimate
 * project that has a wallet stamp lands in `otherWallets` (the user must
 * pick an active wallet to see anything).
 */
export function partitionProjectsByWallet(
  projects: DiscoveredProject[],
  activeAddress: string | null
): PartitionedDiscovery {
  const active = activeAddress ? normalizeWalletAddress(activeAddress) : null
  const owned: DiscoveredProject[] = []
  const legacy: DiscoveredProject[] = []
  const otherWallets: DiscoveredProject[] = []
  const errors: DiscoveredProject[] = []

  for (const project of projects) {
    if (project.error || !project.meta) {
      errors.push(project)
      continue
    }
    const ownerAddress = project.meta.wallet?.address
    if (!ownerAddress) {
      legacy.push(project)
      continue
    }
    if (active && ownerAddress === active) {
      owned.push(project)
    } else {
      otherWallets.push(project)
    }
  }

  return { owned, legacy, otherWallets, errors }
}
