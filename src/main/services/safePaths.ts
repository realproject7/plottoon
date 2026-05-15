import path from 'node:path'
import { app } from 'electron'

export class PathEscapeError extends Error {
  constructor(resolved: string, root: string) {
    super(`Path escapes root: "${resolved}" is not inside "${root}"`)
    this.name = 'PathEscapeError'
  }
}

function assertInsideRoot(resolved: string, root: string): void {
  const normalizedResolved = path.normalize(resolved) + path.sep
  const normalizedRoot = path.normalize(root) + path.sep
  if (
    !normalizedResolved.startsWith(normalizedRoot) &&
    path.normalize(resolved) !== path.normalize(root)
  ) {
    throw new PathEscapeError(resolved, root)
  }
}

export function resolveProjectPath(projectRoot: string, ...segments: string[]): string {
  const resolved = path.resolve(projectRoot, ...segments)
  assertInsideRoot(resolved, projectRoot)
  return resolved
}

export function resolvePlotFolder(projectRoot: string, plotId: string): string {
  return resolveProjectPath(projectRoot, 'plots', plotId)
}

export function resolveAssetPath(projectRoot: string, ...segments: string[]): string {
  return resolveProjectPath(projectRoot, 'assets', ...segments)
}

export function resolveExportPath(projectRoot: string, ...segments: string[]): string {
  return resolveProjectPath(projectRoot, 'exports', ...segments)
}

export function appConfigDir(): string {
  return path.join(app.getPath('userData'), 'config')
}

export function resolveAppConfigPath(...segments: string[]): string {
  const configDir = appConfigDir()
  const resolved = path.resolve(configDir, ...segments)
  assertInsideRoot(resolved, configDir)
  return resolved
}
