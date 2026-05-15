import { ipcMain } from 'electron'
import {
  readProjectFile,
  writeProjectFile,
  listProjectDir,
  projectFileExists,
  readAppConfig,
  writeAppConfig
} from '../services/fsService'

export function registerFsHandlers(): void {
  ipcMain.handle('fs:readProjectFile', (_event, projectRoot: string, ...segments: string[]) =>
    readProjectFile(projectRoot, ...segments)
  )

  ipcMain.handle(
    'fs:writeProjectFile',
    (_event, projectRoot: string, segments: string[], content: string) =>
      writeProjectFile(projectRoot, segments, content)
  )

  ipcMain.handle('fs:listProjectDir', (_event, projectRoot: string, ...segments: string[]) =>
    listProjectDir(projectRoot, ...segments)
  )

  ipcMain.handle('fs:projectFileExists', (_event, projectRoot: string, ...segments: string[]) =>
    projectFileExists(projectRoot, ...segments)
  )

  ipcMain.handle('fs:readAppConfig', (_event, filename: string) => readAppConfig(filename))

  ipcMain.handle('fs:writeAppConfig', (_event, filename: string, content: string) =>
    writeAppConfig(filename, content)
  )
}
