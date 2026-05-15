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
  },
  project: {
    discover: () => ipcRenderer.invoke('project:discover'),
    readMeta: (projectId: string) => ipcRenderer.invoke('project:readMeta', projectId),
    writeMeta: (projectId: string, meta: unknown) =>
      ipcRenderer.invoke('project:writeMeta', projectId, meta),
    create: (name: string, description?: string) =>
      ipcRenderer.invoke('project:create', name, description),
    setProjectsDir: () => ipcRenderer.invoke('project:setProjectsDir'),
    getProjectsDir: () => ipcRenderer.invoke('project:getProjectsDir')
  }
})
