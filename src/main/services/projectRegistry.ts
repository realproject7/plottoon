import path from 'node:path'

export class UnregisteredProjectError extends Error {
  constructor(projectId: string) {
    super(`No registered project with id "${projectId}"`)
    this.name = 'UnregisteredProjectError'
  }
}

const registry = new Map<string, string>()
let counter = 0

export function registerProject(absolutePath: string): string {
  const normalized = path.resolve(absolutePath)
  for (const [id, root] of registry) {
    if (root === normalized) return id
  }
  const id = `proj_${++counter}`
  registry.set(id, normalized)
  return id
}

export function unregisterProject(projectId: string): boolean {
  return registry.delete(projectId)
}

export function getProjectRoot(projectId: string): string {
  const root = registry.get(projectId)
  if (!root) throw new UnregisteredProjectError(projectId)
  return root
}

export function listProjects(): Array<{ id: string; root: string }> {
  return Array.from(registry, ([id, root]) => ({ id, root }))
}

export function clearRegistry(): void {
  registry.clear()
  counter = 0
}
