import { ipcMain, dialog, BrowserWindow } from 'electron'
import {
  readProjectFile,
  writeProjectFile,
  writeProjectFileBinary,
  listProjectDir,
  projectFileExists,
  resolveProjectFilePath,
  readAppConfig,
  writeAppConfig
} from '../services/fsService'
import { registerProject, listProjects } from '../services/projectRegistry'
import {
  importCleanImage,
  detectCleanImages,
  registerAgentFile
} from '../services/cleanImageImport'

export function registerFsHandlers(): void {
  ipcMain.handle('fs:openProject', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win ?? BrowserWindow.getFocusedWindow()!, {
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return registerProject(result.filePaths[0])
  })

  ipcMain.handle('fs:listProjects', () => listProjects())

  ipcMain.handle('fs:readProjectFile', (_event, projectId: string, ...segments: string[]) =>
    readProjectFile(projectId, ...segments)
  )

  ipcMain.handle(
    'fs:writeProjectFile',
    (_event, projectId: string, segments: string[], content: string) =>
      writeProjectFile(projectId, segments, content)
  )

  ipcMain.handle(
    'fs:writeProjectFileBinary',
    (_event, projectId: string, segments: string[], base64: string) =>
      writeProjectFileBinary(projectId, segments, base64)
  )

  ipcMain.handle('fs:listProjectDir', (_event, projectId: string, ...segments: string[]) =>
    listProjectDir(projectId, ...segments)
  )

  ipcMain.handle('fs:projectFileExists', (_event, projectId: string, ...segments: string[]) =>
    projectFileExists(projectId, ...segments)
  )

  ipcMain.handle('fs:resolveProjectFilePath', (_event, projectId: string, ...segments: string[]) =>
    resolveProjectFilePath(projectId, ...segments)
  )

  ipcMain.handle('fs:readAppConfig', (_event, filename: string) => readAppConfig(filename))

  ipcMain.handle('fs:writeAppConfig', (_event, filename: string, content: string) =>
    writeAppConfig(filename, content)
  )

  ipcMain.handle(
    'fs:importCleanImage',
    async (event, projectId: string, plotSlug: string, cutId: string) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const result = await dialog.showOpenDialog(win ?? BrowserWindow.getFocusedWindow()!, {
        title: 'Import Clean Image',
        filters: [{ name: 'Images', extensions: ['webp', 'jpeg', 'jpg', 'png'] }],
        properties: ['openFile']
      })
      if (result.canceled || result.filePaths.length === 0) return null
      return importCleanImage(projectId, plotSlug, cutId, result.filePaths[0])
    }
  )

  ipcMain.handle(
    'fs:detectCleanImages',
    (_event, projectId: string, plotSlug: string, cutId: string) =>
      detectCleanImages(projectId, plotSlug, cutId)
  )

  ipcMain.handle(
    'fs:registerAgentFile',
    (_event, projectId: string, plotSlug: string, cutId: string, filename: string) =>
      registerAgentFile(projectId, plotSlug, cutId, filename)
  )
}
