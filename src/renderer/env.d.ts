/// <reference types="vite/client" />

interface PlottoonFs {
  readProjectFile(projectRoot: string, ...segments: string[]): Promise<string>
  writeProjectFile(projectRoot: string, segments: string[], content: string): Promise<void>
  listProjectDir(projectRoot: string, ...segments: string[]): Promise<string[]>
  projectFileExists(projectRoot: string, ...segments: string[]): Promise<boolean>
  readAppConfig(filename: string): Promise<string>
  writeAppConfig(filename: string, content: string): Promise<void>
}

interface Window {
  plottoon: {
    version: string
    fs: PlottoonFs
  }
}
