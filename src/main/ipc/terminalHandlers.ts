import { ipcMain, BrowserWindow } from 'electron'
import { getProjectRoot } from '../services/projectRegistry'
import {
  createSession,
  getSession,
  findSessionByProjectAndWallet,
  connectSession,
  writeToSession,
  resizeSession,
  disconnectSession,
  restartSession,
  destroySession
} from '../services/terminalSession'
import type { WalletIdentityStore } from '../services/walletIdentityStore'
import { detectAgentRuntimes, type AgentKind } from '../services/agentRuntime'
import { buildBridgedEnv, readEnvBridgeConfig } from '../services/agentEnvBridge'

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

  async function resolveDefaultAgentKind(): Promise<AgentKind | null> {
    // #272: pick the agent runtime for new sessions. Falls back to null
    // (no agent → shell) when neither Claude nor Codex is installed,
    // matching the user-visible "no agent CLI available" state the
    // capability report already surfaces.
    const report = await detectAgentRuntimes()
    return report.defaultAgent
  }

  ipcMain.handle('terminal:create', async (_event, projectId: string) => {
    const cwd = getProjectRoot(projectId)
    const agentKind = await resolveDefaultAgentKind()
    return createSession({
      projectId,
      cwd,
      walletAddress: await activeWalletAddress(),
      agentKind
    })
  })

  ipcMain.handle('terminal:getSession', (_event, sessionId: string) => {
    return getSession(sessionId)
  })

  ipcMain.handle('terminal:findByProject', async (_event, projectId: string) => {
    return findSessionByProjectAndWallet(projectId, await activeWalletAddress())
  })

  async function connectDeps(): Promise<{ bridgedEnv: Record<string, string> }> {
    // #276: forward only env keys the user explicitly opted in to via
    // the bridge config. Status payload + persisted config never carry
    // the key value; this is the only place the value flows from host
    // env into the spawned agent process.
    const config = await readEnvBridgeConfig()
    return { bridgedEnv: buildBridgedEnv(config) }
  }

  ipcMain.handle(
    'terminal:connect',
    async (event, sessionId: string, dims?: { cols?: number; rows?: number }) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const deps = await connectDeps()
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
        },
        { bridgedEnv: deps.bridgedEnv, cols: dims?.cols, rows: dims?.rows }
      )
    }
  )

  ipcMain.handle('terminal:write', (_event, sessionId: string, data: string) => {
    return writeToSession(sessionId, data)
  })

  ipcMain.handle('terminal:resize', (_event, sessionId: string, cols: number, rows: number) => {
    return resizeSession(sessionId, cols, rows)
  })

  ipcMain.handle('terminal:disconnect', (_event, sessionId: string) => {
    return disconnectSession(sessionId)
  })

  ipcMain.handle(
    'terminal:restart',
    async (event, sessionId: string, dims?: { cols?: number; rows?: number }) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const deps = await connectDeps()
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
        },
        { bridgedEnv: deps.bridgedEnv, cols: dims?.cols, rows: dims?.rows }
      )
    }
  )

  ipcMain.handle('terminal:destroy', (_event, sessionId: string) => {
    return destroySession(sessionId)
  })
}
