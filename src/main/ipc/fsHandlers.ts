import { ipcMain } from 'electron'
import {
  readProjectFile,
  writeProjectFile,
  listProjectDir,
  projectFileExists,
  readAppConfig,
  writeAppConfig
} from '../services/fsService'
import { registerProject, listProjects } from '../services/projectRegistry'

export function registerFsHandlers(): void {
  ipcMain.handle('fs:registerProject', (_event, absolutePath: string) =>
    registerProject(absolutePath)
  )

  ipcMain.handle('fs:listProjects', () => listProjects())

  ipcMain.handle('fs:readProjectFile', (_event, projectId: string, ...segments: string[]) =>
    readProjectFile(projectId, ...segments)
  )

  ipcMain.handle(
    'fs:writeProjectFile',
    (_event, projectId: string, segments: string[], content: string) =>
      writeProjectFile(projectId, segments, content)
  )

  ipcMain.handle('fs:listProjectDir', (_event, projectId: string, ...segments: string[]) =>
    listProjectDir(projectId, ...segments)
  )

  ipcMain.handle('fs:projectFileExists', (_event, projectId: string, ...segments: string[]) =>
    projectFileExists(projectId, ...segments)
  )

  ipcMain.handle('fs:readAppConfig', (_event, filename: string) => readAppConfig(filename))

  ipcMain.handle('fs:writeAppConfig', (_event, filename: string, content: string) =>
    writeAppConfig(filename, content)
  )
}
