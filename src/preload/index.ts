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
    writeProjectFileBinary: (projectId: string, segments: string[], base64: string) =>
      ipcRenderer.invoke('fs:writeProjectFileBinary', projectId, segments, base64),
    regeneratePlotText: (projectId: string, plotSlug: string) =>
      ipcRenderer.invoke('fs:regeneratePlotText', projectId, plotSlug),
    listProjectDir: (projectId: string, ...segments: string[]) =>
      ipcRenderer.invoke('fs:listProjectDir', projectId, ...segments),
    projectFileExists: (projectId: string, ...segments: string[]) =>
      ipcRenderer.invoke('fs:projectFileExists', projectId, ...segments),
    resolveProjectFilePath: (projectId: string, ...segments: string[]) =>
      ipcRenderer.invoke('fs:resolveProjectFilePath', projectId, ...segments),
    readAppConfig: (filename: string) => ipcRenderer.invoke('fs:readAppConfig', filename),
    writeAppConfig: (filename: string, content: string) =>
      ipcRenderer.invoke('fs:writeAppConfig', filename, content),
    importCleanImage: (projectId: string, plotSlug: string, cutId: string) =>
      ipcRenderer.invoke('fs:importCleanImage', projectId, plotSlug, cutId),
    detectCleanImages: (projectId: string, plotSlug: string, cutId: string) =>
      ipcRenderer.invoke('fs:detectCleanImages', projectId, plotSlug, cutId),
    registerAgentFile: (projectId: string, plotSlug: string, cutId: string, filename: string) =>
      ipcRenderer.invoke('fs:registerAgentFile', projectId, plotSlug, cutId, filename)
  },
  capability: {
    getReport: () => ipcRenderer.invoke('capability:getReport')
  },
  actionLog: {
    log: (action: string, detail: string, projectId?: string, plotId?: string) =>
      ipcRenderer.invoke('actionLog:log', action, detail, projectId, plotId),
    get: (projectId?: string) => ipcRenderer.invoke('actionLog:get', projectId)
  },
  wallet: {
    getOptions: () => ipcRenderer.invoke('wallet:getOptions'),
    connect: (option: unknown) => ipcRenderer.invoke('wallet:connect', option),
    getConnected: () => ipcRenderer.invoke('wallet:getConnected'),
    disconnect: () => ipcRenderer.invoke('wallet:disconnect'),
    getSignerMode: () => ipcRenderer.invoke('wallet:getSignerMode')
  },
  publish: {
    preflight: () => ipcRenderer.invoke('publish:preflight'),
    execute: (request: unknown, confirmed: boolean) =>
      ipcRenderer.invoke('publish:execute', request, confirmed),
    onProgress: (callback: (progress: { state: string; detail?: string }) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        progress: { state: string; detail?: string }
      ) => callback(progress)
      ipcRenderer.on('publish:progress', handler)
      return () => ipcRenderer.removeListener('publish:progress', handler)
    },
    retryIndex: (params: {
      projectId: string
      plotSlug: string
      fallbackContent?: string
      meta?: { contentType?: string; isNsfw?: string; genre?: string; language?: string }
    }) => ipcRenderer.invoke('publish:retryIndex', params),
    markNotIndexed: (params: { projectId: string; plotSlug: string; reason: string }) =>
      ipcRenderer.invoke('publish:markNotIndexed', params)
  },
  dashboard: {
    getData: () => ipcRenderer.invoke('dashboard:getData')
  },
  agent: {
    getStatus: () => ipcRenderer.invoke('agent:status'),
    register: (params: { agentName: string; genre?: string }) =>
      ipcRenderer.invoke('agent:register', params),
    getBindingProof: (humanWallet: string) => ipcRenderer.invoke('agent:bindingProof', humanWallet)
  },
  royalty: {
    getInfo: () => ipcRenderer.invoke('royalty:info'),
    claim: (confirmed: boolean) => ipcRenderer.invoke('royalty:claim', confirmed),
    getClaimHistory: () => ipcRenderer.invoke('royalty:claimHistory'),
    onProgress: (callback: (progress: { state: string; detail?: string }) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        progress: { state: string; detail?: string }
      ) => callback(progress)
      ipcRenderer.on('royalty:progress', handler)
      return () => ipcRenderer.removeListener('royalty:progress', handler)
    }
  },
  project: {
    discover: () => ipcRenderer.invoke('project:discover'),
    readMeta: (projectId: string) => ipcRenderer.invoke('project:readMeta', projectId),
    writeMeta: (projectId: string, meta: unknown) =>
      ipcRenderer.invoke('project:writeMeta', projectId, meta),
    create: (name: string, description?: string) =>
      ipcRenderer.invoke('project:create', name, description),
    setProjectsDir: () => ipcRenderer.invoke('project:setProjectsDir'),
    getProjectsDir: () => ipcRenderer.invoke('project:getProjectsDir'),
    detectClis: () => ipcRenderer.invoke('project:detectClis')
  }
})
