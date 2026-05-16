import fs from 'node:fs/promises'
import { resolveProjectPath, resolveAppConfigPath } from './safePaths'
import { getProjectRoot } from './projectRegistry'
import type { CutsFile, Cut } from './cutsSchema'
import { generatePlotText } from './plotTextGenerator'

export async function readProjectFile(projectId: string, ...segments: string[]): Promise<string> {
  const root = getProjectRoot(projectId)
  const filePath = resolveProjectPath(root, ...segments)
  return fs.readFile(filePath, 'utf-8')
}

export async function writeProjectFile(
  projectId: string,
  segments: string[],
  content: string
): Promise<void> {
  const root = getProjectRoot(projectId)
  const filePath = resolveProjectPath(root, ...segments)
  await fs.mkdir(resolveProjectPath(root, ...segments.slice(0, -1)), { recursive: true })
  await fs.writeFile(filePath, content, 'utf-8')
}

export async function writeProjectFileBinary(
  projectId: string,
  segments: string[],
  base64: string
): Promise<void> {
  const root = getProjectRoot(projectId)
  const filePath = resolveProjectPath(root, ...segments)
  await fs.mkdir(resolveProjectPath(root, ...segments.slice(0, -1)), { recursive: true })
  const buffer = Buffer.from(base64, 'base64')
  await fs.writeFile(filePath, buffer)
}

export async function listProjectDir(projectId: string, ...segments: string[]): Promise<string[]> {
  const root = getProjectRoot(projectId)
  const dirPath = resolveProjectPath(root, ...segments)
  return fs.readdir(dirPath)
}

export async function projectFileExists(
  projectId: string,
  ...segments: string[]
): Promise<boolean> {
  const root = getProjectRoot(projectId)
  const filePath = resolveProjectPath(root, ...segments)
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export function resolveProjectFilePath(projectId: string, ...segments: string[]): string {
  const root = getProjectRoot(projectId)
  return resolveProjectPath(root, ...segments)
}

function normalizeCut(data: Record<string, unknown>, index: number): Cut {
  const validStatuses = [
    'planned',
    'draft',
    'needs_revision',
    'approved',
    'exported',
    'uploaded',
    'published'
  ]
  return {
    id: typeof data.id === 'string' ? data.id : `cut-${index}`,
    status:
      typeof data.status === 'string' && validStatuses.includes(data.status)
        ? (data.status as Cut['status'])
        : undefined,
    order: typeof data.order === 'number' ? data.order : index,
    dialogue: typeof data.dialogue === 'string' ? data.dialogue : '',
    direction: typeof data.direction === 'string' ? data.direction : '',
    narration: typeof data.narration === 'string' ? data.narration : undefined,
    continuityNotes: typeof data.continuityNotes === 'string' ? data.continuityNotes : undefined,
    imageState:
      data.imageState && typeof data.imageState === 'object'
        ? (data.imageState as Cut['imageState'])
        : { status: 'pending', path: null, prompt: null, seed: null },
    overlays: Array.isArray(data.overlays) ? (data.overlays as Cut['overlays']) : [],
    canvasOverrides:
      data.canvasOverrides && typeof data.canvasOverrides === 'object'
        ? (data.canvasOverrides as Cut['canvasOverrides'])
        : undefined
  }
}

function normalizeCutsFile(parsed: Record<string, unknown>): CutsFile {
  const cuts = Array.isArray(parsed.cuts)
    ? (parsed.cuts as Record<string, unknown>[]).map((c, i) => normalizeCut(c, i))
    : []
  return {
    version: typeof parsed.version === 'number' ? parsed.version : 1,
    plotTitle: typeof parsed.plotTitle === 'string' ? parsed.plotTitle : '',
    synopsis: typeof parsed.synopsis === 'string' ? parsed.synopsis : '',
    cuts,
    publishState:
      parsed.publishState && typeof parsed.publishState === 'object'
        ? (parsed.publishState as CutsFile['publishState'])
        : { published: false, exportedAt: null, format: null }
  }
}

export async function regeneratePlotText(projectId: string, plotSlug: string): Promise<void> {
  const root = getProjectRoot(projectId)
  const cutsPath = resolveProjectPath(root, 'plots', plotSlug, 'cuts.json')
  const raw = await fs.readFile(cutsPath, 'utf-8')
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const cutsFile = normalizeCutsFile(parsed)
  const text = generatePlotText(cutsFile)
  const textPath = resolveProjectPath(root, 'plots', plotSlug, 'plot-text.md')
  await fs.writeFile(textPath, text, 'utf-8')
}

export async function readAppConfig(filename: string): Promise<string> {
  const filePath = resolveAppConfigPath(filename)
  return fs.readFile(filePath, 'utf-8')
}

export async function writeAppConfig(filename: string, content: string): Promise<void> {
  const filePath = resolveAppConfigPath(filename)
  const dir = resolveAppConfigPath()
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(filePath, content, 'utf-8')
}
