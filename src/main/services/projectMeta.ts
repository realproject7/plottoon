import fs from 'node:fs/promises'
import path from 'node:path'

export interface ProjectMeta {
  name: string
  version: number
  createdAt: string
  updatedAt: string
  description?: string
}

export class ProjectMetaError extends Error {
  constructor(
    message: string,
    public readonly projectPath: string
  ) {
    super(message)
    this.name = 'ProjectMetaError'
  }
}

const CURRENT_VERSION = 1

function validateMeta(data: unknown, projectPath: string): ProjectMeta {
  if (typeof data !== 'object' || data === null) {
    throw new ProjectMetaError('project.json must be a JSON object', projectPath)
  }

  const obj = data as Record<string, unknown>

  if (typeof obj.name !== 'string' || obj.name.trim().length === 0) {
    throw new ProjectMetaError('project.json: "name" must be a non-empty string', projectPath)
  }

  if (typeof obj.version !== 'number' || !Number.isInteger(obj.version) || obj.version < 1) {
    throw new ProjectMetaError('project.json: "version" must be a positive integer', projectPath)
  }

  if (typeof obj.createdAt !== 'string') {
    throw new ProjectMetaError('project.json: "createdAt" must be a string', projectPath)
  }

  if (typeof obj.updatedAt !== 'string') {
    throw new ProjectMetaError('project.json: "updatedAt" must be a string', projectPath)
  }

  if (obj.description !== undefined && typeof obj.description !== 'string') {
    throw new ProjectMetaError(
      'project.json: "description" must be a string if present',
      projectPath
    )
  }

  return {
    name: obj.name,
    version: obj.version,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
    description: obj.description as string | undefined
  }
}

export async function readProjectMeta(projectRoot: string): Promise<ProjectMeta> {
  const metaPath = path.join(projectRoot, 'project.json')
  let raw: string
  try {
    raw = await fs.readFile(metaPath, 'utf-8')
  } catch {
    throw new ProjectMetaError('project.json not found', projectRoot)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ProjectMetaError('project.json contains invalid JSON', projectRoot)
  }

  return validateMeta(parsed, projectRoot)
}

export async function writeProjectMeta(projectRoot: string, meta: ProjectMeta): Promise<void> {
  const metaPath = path.join(projectRoot, 'project.json')
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf-8')
}

export function createProjectMeta(name: string, description?: string): ProjectMeta {
  const now = new Date().toISOString()
  return {
    name,
    version: CURRENT_VERSION,
    createdAt: now,
    updatedAt: now,
    description
  }
}
