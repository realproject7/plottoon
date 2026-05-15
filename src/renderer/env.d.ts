/// <reference types="vite/client" />

interface PlottoonFs {
  registerProject(absolutePath: string): Promise<string>
  listProjects(): Promise<Array<{ id: string; root: string }>>
  readProjectFile(projectId: string, ...segments: string[]): Promise<string>
  writeProjectFile(projectId: string, segments: string[], content: string): Promise<void>
  listProjectDir(projectId: string, ...segments: string[]): Promise<string[]>
  projectFileExists(projectId: string, ...segments: string[]): Promise<boolean>
  readAppConfig(filename: string): Promise<string>
  writeAppConfig(filename: string, content: string): Promise<void>
}

interface Window {
  plottoon: {
    version: string
    fs: PlottoonFs
  }
}
