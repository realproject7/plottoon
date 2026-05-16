import fs from 'node:fs/promises'
import path from 'node:path'
import { resolveProjectPath } from './safePaths'
import { getProjectRoot } from './projectRegistry'

const ALLOWED_EXTENSIONS = new Set(['.webp', '.jpeg', '.jpg', '.png'])

export interface ImportMetadata {
  generationBackend?: string
  model?: string
  prompt?: string
  attempts?: number
  revisionNotes?: string
}

export interface ImportResult {
  relativePath: string
  absolutePath: string
  filename: string
}

export interface DetectedImage {
  relativePath: string
  filename: string
}

function isAllowedExtension(filePath: string): boolean {
  return ALLOWED_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

function buildAssetDir(plotSlug: string, cutId: string): string[] {
  return ['plots', plotSlug, 'assets', cutId]
}

const VERSION_PATTERN = /^clean-v(\d{3})\.\w+$/

async function nextVersion(assetDir: string): Promise<number> {
  let entries: string[]
  try {
    entries = await fs.readdir(assetDir)
  } catch {
    return 1
  }
  let max = 0
  for (const name of entries) {
    const match = VERSION_PATTERN.exec(name)
    if (match) {
      const v = parseInt(match[1], 10)
      if (v > max) max = v
    }
  }
  return max + 1
}

function buildVersionedFilename(version: number, ext: string): string {
  return `clean-v${String(version).padStart(3, '0')}${ext}`
}

export async function importCleanImage(
  projectId: string,
  plotSlug: string,
  cutId: string,
  sourcePath: string
): Promise<ImportResult> {
  const ext = path.extname(sourcePath).toLowerCase()
  if (!isAllowedExtension(sourcePath)) {
    throw new Error(
      `Unsupported image format "${ext}". Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`
    )
  }

  const root = getProjectRoot(projectId)
  const assetSegments = buildAssetDir(plotSlug, cutId)
  const assetDir = resolveProjectPath(root, ...assetSegments)
  await fs.mkdir(assetDir, { recursive: true })

  const version = await nextVersion(assetDir)
  const filename = buildVersionedFilename(version, ext)
  const destPath = resolveProjectPath(root, ...assetSegments, filename)

  await fs.copyFile(sourcePath, destPath)

  const relativePath = path.join(...assetSegments, filename)
  return { relativePath, absolutePath: destPath, filename }
}

export async function detectCleanImages(
  projectId: string,
  plotSlug: string,
  cutId: string
): Promise<DetectedImage[]> {
  const root = getProjectRoot(projectId)
  const assetSegments = buildAssetDir(plotSlug, cutId)
  const assetDir = resolveProjectPath(root, ...assetSegments)

  let entries: string[]
  try {
    entries = await fs.readdir(assetDir)
  } catch {
    return []
  }

  return entries
    .filter((name) => isAllowedExtension(name))
    .sort()
    .map((name) => ({
      relativePath: path.join(...assetSegments, name),
      filename: name
    }))
}

export async function registerAgentFile(
  projectId: string,
  plotSlug: string,
  cutId: string,
  filename: string
): Promise<ImportResult> {
  if (filename.includes('/') || filename.includes('\\') || filename !== path.basename(filename)) {
    throw new Error('Filename must not contain path separators')
  }
  if (!isAllowedExtension(filename)) {
    const ext = path.extname(filename).toLowerCase()
    throw new Error(
      `Unsupported image format "${ext}". Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`
    )
  }

  const root = getProjectRoot(projectId)
  const assetSegments = buildAssetDir(plotSlug, cutId)
  const absolutePath = resolveProjectPath(root, ...assetSegments, filename)

  try {
    await fs.access(absolutePath)
  } catch {
    throw new Error(`File not found: ${path.join(...assetSegments, filename)}`)
  }

  const relativePath = path.join(...assetSegments, filename)
  return { relativePath, absolutePath, filename }
}
