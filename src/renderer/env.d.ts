/// <reference types="vite/client" />

interface ProjectMeta {
  name: string
  version: number
  createdAt: string
  updatedAt: string
  description?: string
}

interface DiscoveredProject {
  id: string | null
  path: string
  meta: ProjectMeta | null
  error: string | null
}

interface CreatedProject {
  id: string
  path: string
  meta: ProjectMeta
}

interface PlottoonFs {
  openProject(): Promise<string | null>
  listProjects(): Promise<Array<{ id: string; root: string }>>
  readProjectFile(projectId: string, ...segments: string[]): Promise<string>
  writeProjectFile(projectId: string, segments: string[], content: string): Promise<void>
  listProjectDir(projectId: string, ...segments: string[]): Promise<string[]>
  projectFileExists(projectId: string, ...segments: string[]): Promise<boolean>
  readAppConfig(filename: string): Promise<string>
  writeAppConfig(filename: string, content: string): Promise<void>
}

interface PlottoonProject {
  discover(): Promise<DiscoveredProject[]>
  readMeta(projectId: string): Promise<ProjectMeta>
  writeMeta(projectId: string, meta: ProjectMeta): Promise<void>
  create(name: string, description?: string): Promise<CreatedProject | null>
  setProjectsDir(): Promise<string | null>
  getProjectsDir(): Promise<string | null>
}

interface Window {
  plottoon: {
    version: string
    fs: PlottoonFs
    project: PlottoonProject
  }
}
