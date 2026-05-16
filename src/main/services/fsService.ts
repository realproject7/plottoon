import fs from 'node:fs/promises'
import { resolveProjectPath, resolveAppConfigPath } from './safePaths'
import { getProjectRoot } from './projectRegistry'
import { validateCutsFile } from './cutsSchema'
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

export async function regeneratePlotText(
  projectId: string,
  plotSlug: string
): Promise<void> {
  const root = getProjectRoot(projectId)
  const cutsPath = resolveProjectPath(root, 'plots', plotSlug, 'cuts.json')
  const raw = await fs.readFile(cutsPath, 'utf-8')
  const parsed = JSON.parse(raw)
  const cutsFile = validateCutsFile(parsed, cutsPath)
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
