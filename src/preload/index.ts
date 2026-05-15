import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('plottoon', {
  version: process.versions.electron,
  fs: {
    openProject: () => ipcRenderer.invoke('fs:openProject'),
    listProjects: () => ipcRenderer.invoke('fs:listProjects'),
    readProjectFile: (projectId: string, ...segments: string[]) =>
      ipcRenderer.invoke('fs:readProjectFile', projectId, ...segments),
    writeProjectFile: (projectId: string, segments: string[], content: string) =>
      ipcRenderer.invoke('fs:writeProjectFile', projectId, segments, content),
    listProjectDir: (projectId: string, ...segments: string[]) =>
      ipcRenderer.invoke('fs:listProjectDir', projectId, ...segments),
    projectFileExists: (projectId: string, ...segments: string[]) =>
      ipcRenderer.invoke('fs:projectFileExists', projectId, ...segments),
    readAppConfig: (filename: string) => ipcRenderer.invoke('fs:readAppConfig', filename),
    writeAppConfig: (filename: string, content: string) =>
      ipcRenderer.invoke('fs:writeAppConfig', filename, content)
  }
})
