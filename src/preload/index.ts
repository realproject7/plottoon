import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('plottoon', {
  version: process.versions.electron,
  terminal: {
    create: (projectId: string) => ipcRenderer.invoke('terminal:create', projectId),
    getSession: (sessionId: string) => ipcRenderer.invoke('terminal:getSession', sessionId),
    findByProject: (projectId: string) => ipcRenderer.invoke('terminal:findByProject', projectId),
    connect: (sessionId: string) => ipcRenderer.invoke('terminal:connect', sessionId),
    write: (sessionId: string, data: string) =>
      ipcRenderer.invoke('terminal:write', sessionId, data),
    disconnect: (sessionId: string) => ipcRenderer.invoke('terminal:disconnect', sessionId),
    restart: (sessionId: string) => ipcRenderer.invoke('terminal:restart', sessionId),
    destroy: (sessionId: string) => ipcRenderer.invoke('terminal:destroy', sessionId),
    onData: (callback: (sessionId: string, data: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, sessionId: string, data: string) =>
        callback(sessionId, data)
      ipcRenderer.on('terminal:data', handler)
      return () => ipcRenderer.removeListener('terminal:data', handler)
    },
    onExit: (callback: (sessionId: string, code: number | null) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, sessionId: string, code: number | null) =>
        callback(sessionId, code)
      ipcRenderer.on('terminal:exit', handler)
      return () => ipcRenderer.removeListener('terminal:exit', handler)
    }
  },
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
