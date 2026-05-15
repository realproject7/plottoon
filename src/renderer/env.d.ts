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

interface CliStatus {
  name: string
  command: string
  installed: boolean
  version: string | null
}

interface CapabilityReport {
  detectedAt: string
  clis: CliStatus[]
}

interface PlottoonProject {
  discover(): Promise<DiscoveredProject[]>
  readMeta(projectId: string): Promise<ProjectMeta>
  writeMeta(projectId: string, meta: ProjectMeta): Promise<void>
  create(name: string, description?: string): Promise<CreatedProject | null>
  setProjectsDir(): Promise<string | null>
  getProjectsDir(): Promise<string | null>
  detectClis(): Promise<CapabilityReport>
}

interface TerminalSessionMeta {
  id: string
  projectId: string
  cwd: string
  state: 'connected' | 'disconnected' | 'exited'
  createdAt: string
  exitCode: number | null
}

interface PlottoonTerminal {
  create(projectId: string): Promise<TerminalSessionMeta>
  getSession(sessionId: string): Promise<TerminalSessionMeta | null>
  findByProject(projectId: string): Promise<TerminalSessionMeta | null>
  connect(sessionId: string): Promise<boolean>
  write(sessionId: string, data: string): Promise<boolean>
  disconnect(sessionId: string): Promise<boolean>
  restart(sessionId: string): Promise<boolean>
  destroy(sessionId: string): Promise<boolean>
  onData(callback: (sessionId: string, data: string) => void): () => void
  onExit(callback: (sessionId: string, code: number | null) => void): () => void
}

interface Window {
  plottoon: {
    version: string
    terminal: PlottoonTerminal
    fs: PlottoonFs
    project: PlottoonProject
  }
}
