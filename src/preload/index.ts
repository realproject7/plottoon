import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('plottoon', {
  version: process.versions.electron,
  fs: {
    readProjectFile: (projectRoot: string, ...segments: string[]) =>
      ipcRenderer.invoke('fs:readProjectFile', projectRoot, ...segments),
    writeProjectFile: (projectRoot: string, segments: string[], content: string) =>
      ipcRenderer.invoke('fs:writeProjectFile', projectRoot, segments, content),
    listProjectDir: (projectRoot: string, ...segments: string[]) =>
      ipcRenderer.invoke('fs:listProjectDir', projectRoot, ...segments),
    projectFileExists: (projectRoot: string, ...segments: string[]) =>
      ipcRenderer.invoke('fs:projectFileExists', projectRoot, ...segments),
    readAppConfig: (filename: string) => ipcRenderer.invoke('fs:readAppConfig', filename),
    writeAppConfig: (filename: string, content: string) =>
      ipcRenderer.invoke('fs:writeAppConfig', filename, content)
  }
})
