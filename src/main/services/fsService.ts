import fs from 'node:fs/promises'
import { resolveProjectPath, resolveAppConfigPath } from './safePaths'

export async function readProjectFile(projectRoot: string, ...segments: string[]): Promise<string> {
  const filePath = resolveProjectPath(projectRoot, ...segments)
  return fs.readFile(filePath, 'utf-8')
}

export async function writeProjectFile(
  projectRoot: string,
  segments: string[],
  content: string
): Promise<void> {
  const filePath = resolveProjectPath(projectRoot, ...segments)
  await fs.mkdir(resolveProjectPath(projectRoot, ...segments.slice(0, -1)), { recursive: true })
  await fs.writeFile(filePath, content, 'utf-8')
}

export async function listProjectDir(
  projectRoot: string,
  ...segments: string[]
): Promise<string[]> {
  const dirPath = resolveProjectPath(projectRoot, ...segments)
  return fs.readdir(dirPath)
}

export async function projectFileExists(
  projectRoot: string,
  ...segments: string[]
): Promise<boolean> {
  const filePath = resolveProjectPath(projectRoot, ...segments)
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
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
