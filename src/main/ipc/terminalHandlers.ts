import { ipcMain, BrowserWindow } from 'electron'
import { getProjectRoot } from '../services/projectRegistry'
import {
  createSession,
  getSession,
  findSessionByProjectAndWallet,
  connectSession,
  writeToSession,
  disconnectSession,
  restartSession,
  destroySession
} from '../services/terminalSession'
import type { WalletIdentityStore } from '../services/walletIdentityStore'

export interface RegisterTerminalHandlersOptions {
  /**
   * When provided, `terminal:create` and `terminal:findByProject` resolve
   * the active wallet from the store and key sessions by the
   * (projectId, walletAddress) pair. A null active wallet falls through to
   * the legacy null-wallet path, which still supports existing one-wallet
   * sessions (#221 migration).
   */
  walletIdentityStore?: WalletIdentityStore
}

export function registerTerminalHandlers(options: RegisterTerminalHandlersOptions = {}): void {
  const walletStore = options.walletIdentityStore

  async function activeWalletAddress(): Promise<string | null> {
    if (!walletStore) return null
    const active = await walletStore.getActive()
    return active?.address ?? null
  }

  ipcMain.handle('terminal:create', async (_event, projectId: string) => {
    const cwd = getProjectRoot(projectId)
    return createSession(projectId, cwd, await activeWalletAddress())
  })

  ipcMain.handle('terminal:getSession', (_event, sessionId: string) => {
    return getSession(sessionId)
  })

  ipcMain.handle('terminal:findByProject', async (_event, projectId: string) => {
    return findSessionByProjectAndWallet(projectId, await activeWalletAddress())
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
