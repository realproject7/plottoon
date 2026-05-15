import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('plottoon', {
  version: process.versions.electron
})
