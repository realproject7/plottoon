import fs from 'node:fs/promises'
import path from 'node:path'
import { readProjectMeta, type ProjectMeta } from './projectMeta'
import { registerProject } from './projectRegistry'

export interface DiscoveredProject {
  id: string | null
  path: string
  meta: ProjectMeta | null
  error: string | null
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
