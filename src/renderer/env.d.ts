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
  resolveProjectFilePath(projectId: string, ...segments: string[]): Promise<string>
  readAppConfig(filename: string): Promise<string>
  writeAppConfig(filename: string, content: string): Promise<void>
  importCleanImage(
    projectId: string,
    plotSlug: string,
    cutId: string
  ): Promise<{ relativePath: string; absolutePath: string; filename: string } | null>
  detectCleanImages(
    projectId: string,
    plotSlug: string,
    cutId: string
  ): Promise<Array<{ relativePath: string; filename: string }>>
  registerAgentFile(
    projectId: string,
    plotSlug: string,
    cutId: string,
    filename: string
  ): Promise<{ relativePath: string; absolutePath: string; filename: string }>
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

type CheckStatus = 'pass' | 'fail' | 'info'

interface CapabilityCheck {
  id: string
  label: string
  status: CheckStatus
  detail: string
}

interface CapabilitySection {
  title: string
  checks: CapabilityCheck[]
}

interface FirstRunReport {
  generatedAt: string
  sections: CapabilitySection[]
}

interface PlottoonCapability {
  getReport(): Promise<FirstRunReport>
}

interface ActionEntry {
  timestamp: string
  action: string
  projectId: string | null
  plotId: string | null
  detail: string
}

interface PlottoonActionLog {
  log(action: string, detail: string, projectId?: string, plotId?: string): Promise<ActionEntry>
  get(projectId?: string): Promise<ActionEntry[]>
}

interface Window {
  plottoon: {
    version: string
    terminal: PlottoonTerminal
    fs: PlottoonFs
    project: PlottoonProject
    capability: PlottoonCapability
    actionLog: PlottoonActionLog
  }
}
