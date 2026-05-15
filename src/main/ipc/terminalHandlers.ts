import { ipcMain, BrowserWindow } from 'electron'
import { getProjectRoot } from '../services/projectRegistry'
import {
  createSession,
  getSession,
  findSessionByProject,
  connectSession,
  writeToSession,
  disconnectSession,
  restartSession,
  destroySession
} from '../services/terminalSession'

export function registerTerminalHandlers(): void {
  ipcMain.handle('terminal:create', (_event, projectId: string) => {
    const cwd = getProjectRoot(projectId)
    return createSession(projectId, cwd)
  })

  ipcMain.handle('terminal:getSession', (_event, sessionId: string) => {
    return getSession(sessionId)
  })

  ipcMain.handle('terminal:findByProject', (_event, projectId: string) => {
    return findSessionByProject(projectId)
  })

  ipcMain.handle('terminal:connect', (event, sessionId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return connectSession(
      sessionId,
      (data) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('terminal:data', sessionId, data)
        }
      },
      (code) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('terminal:exit', sessionId, code)
        }
      }
    )
  })

  ipcMain.handle('terminal:write', (_event, sessionId: string, data: string) => {
    return writeToSession(sessionId, data)
  })

  ipcMain.handle('terminal:disconnect', (_event, sessionId: string) => {
    return disconnectSession(sessionId)
  })

  ipcMain.handle('terminal:restart', (event, sessionId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return restartSession(
      sessionId,
      (data) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('terminal:data', sessionId, data)
        }
      },
      (code) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('terminal:exit', sessionId, code)
        }
      }
    )
  })

  ipcMain.handle('terminal:destroy', (_event, sessionId: string) => {
    return destroySession(sessionId)
  })
}
