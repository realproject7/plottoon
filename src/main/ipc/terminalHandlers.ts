import { ipcMain, BrowserWindow } from 'electron'
import { getProjectRoot } from '../services/projectRegistry'
import {
  createSession,
  getSession,
  findSessionByProjectAndWallet,
  adoptPersistedSession,
  connectSession,
  writeToSession,
  resizeSession,
  disconnectSession,
  restartSession,
  destroySession,
  type SessionMeta
} from '../services/terminalSession'
import type { WalletIdentityStore } from '../services/walletIdentityStore'
import { detectAgentRuntimes, type AgentKind } from '../services/agentRuntime'
import { buildBridgedEnv, readEnvBridgeConfig } from '../services/agentEnvBridge'
import {
  loadPersistedSession,
  upsertPersistedSession,
  type PersistedSession
} from '../services/terminalSessionStore'

export interface RegisterTerminalHandlersOptions {
  /**
   * When provided, `terminal:create` and `terminal:findByProject` resolve
   * the active wallet from the store and key sessions by the
   * (projectId, walletAddress) pair. A null active wallet falls through to
   * the legacy null-wallet path, which still supports existing one-wallet
   * sessions (#221 migration).
   */
  walletIdentityStore?: WalletIdentityStore
  /**
   * Test seam (#273 RE1): inject a deterministic agent resolver instead
   * of running real CLI detection. Production callers omit this and the
   * default `detectAgentRuntimes()` runs. CI machines without Claude/
   * Codex installed need this to produce stable test fixtures.
   */
  agentResolver?: () => Promise<AgentKind | null>
}

export function registerTerminalHandlers(options: RegisterTerminalHandlersOptions = {}): void {
  const walletStore = options.walletIdentityStore
  const agentResolver = options.agentResolver

  async function activeWalletAddress(): Promise<string | null> {
    if (!walletStore) return null
    const active = await walletStore.getActive()
    return active?.address ?? null
  }

  async function resolveDefaultAgentKind(): Promise<AgentKind | null> {
    if (agentResolver) return agentResolver()
    // #272: pick the agent runtime for new sessions. Falls back to null
    // (no agent → shell) when neither Claude nor Codex is installed,
    // matching the user-visible "no agent CLI available" state the
    // capability report already surfaces.
    const report = await detectAgentRuntimes()
    return report.defaultAgent
  }

  /**
   * #273: persist a snapshot of the session's resume-relevant metadata.
   * Only called when there's a non-null wallet AND an agent runtime —
   * legacy null paths don't get persisted (the renderer can't restore
   * them either).
   */
  async function persistMeta(meta: SessionMeta, lastConnectedAt: string | null): Promise<void> {
    if (!meta.walletAddress || !meta.agentKind) return
    const record: PersistedSession = {
      walletAddress: meta.walletAddress,
      projectId: meta.projectId,
      agentKind: meta.agentKind,
      cwd: meta.cwd,
      sessionId: meta.sessionId,
      createdAt: meta.createdAt,
      lastConnectedAt,
      lastState: meta.state,
      // Claude exposes deterministic resume via --resume <uuid>; Codex
      // currently only supports the picker (`codex resume`) per the
      // #271 limitation. Renderer can surface a hint.
      resumeSupported: meta.agentKind === 'claude'
    }
    await upsertPersistedSession(record)
  }

  ipcMain.handle('terminal:create', async (_event, projectId: string) => {
    const cwd = getProjectRoot(projectId)
    const walletAddress = await activeWalletAddress()
    const agentKind = await resolveDefaultAgentKind()

    // #273: restore previously-persisted (wallet, project) session
    // first. The in-memory store is empty after an app restart, so
    // without this restore the renderer would always start from
    // scratch + lose Claude's resume capability.
    if (walletAddress && agentKind) {
      const inMemory = findSessionByProjectAndWallet(projectId, walletAddress)
      if (!inMemory) {
        const persisted = await loadPersistedSession(walletAddress, projectId)
        if (persisted && persisted.agentKind === agentKind && persisted.cwd === cwd) {
          const adopted = adoptPersistedSession({
            projectId,
            cwd,
            walletAddress,
            agentKind: persisted.agentKind,
            sessionId: persisted.sessionId,
            createdAt: persisted.createdAt
          })
          // Don't update lastConnectedAt — we're only adopting metadata.
          return adopted
        }
      }
    }

    const session = createSession({
      projectId,
      cwd,
      walletAddress,
      agentKind
    })
    await persistMeta(session, null)
    return session
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

  function shouldResume(meta: SessionMeta | null): boolean {
    // #273: resume mode only for Claude with a known session id and
    // a record of having connected before (lastConnectedAt set on the
    // persisted record). Caller computes by inspecting the persisted
    // record; here we just gate on the session shape.
    if (!meta || !meta.sessionId) return false
    return meta.agentKind === 'claude'
  }

  async function resumeModeFor(meta: SessionMeta): Promise<'fresh' | 'resume'> {
    if (!shouldResume(meta)) return 'fresh'
    if (!meta.walletAddress) return 'fresh'
    const persisted = await loadPersistedSession(meta.walletAddress, meta.projectId)
    // Only resume if the persisted record matches this session AND it
    // recorded a prior connection. Otherwise this is a fresh launch
    // even if we restored the metadata earlier.
    if (!persisted) return 'fresh'
    if (persisted.sessionId !== meta.sessionId) return 'fresh'
    if (!persisted.lastConnectedAt) return 'fresh'
    return 'resume'
  }

  ipcMain.handle(
    'terminal:connect',
    async (
      event,
      sessionId: string,
      dims?: { cols?: number; rows?: number },
      opts?: { mode?: 'fresh' | 'resume' | 'auto' }
    ) => {
      // #274: caller may force `fresh` or `resume` — the new lifecycle
      // UX surfaces both as explicit user actions. `auto` (or no opts)
      // preserves the #273 behaviour of picking based on persisted
      // session state.
      const win = BrowserWindow.fromWebContents(event.sender)
      const deps = await connectDeps()
      const meta = getSession(sessionId)
      const requested = opts?.mode ?? 'auto'
      const mode = requested === 'auto' ? (meta ? await resumeModeFor(meta) : 'fresh') : requested
      const ok = await connectSession(
        sessionId,
        (data) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send('terminal:data', sessionId, data)
          }
        },
        (code) => {
          if (win && !win.isDestroyed()) {
            // #274: include the post-exit state so the renderer can
            // distinguish a normal exit from a resume failure without a
            // follow-up `getSession` round-trip.
            const updated = getSession(sessionId)
            win.webContents.send('terminal:exit', sessionId, code, updated?.state ?? 'exited')
          }
          const updated = getSession(sessionId)
          if (updated) void persistMeta(updated, new Date().toISOString())
        },
        { bridgedEnv: deps.bridgedEnv, cols: dims?.cols, rows: dims?.rows, mode }
      )
      if (ok) {
        const updated = getSession(sessionId)
        if (updated) await persistMeta(updated, new Date().toISOString())
      }
      return ok
    }
  )

  ipcMain.handle('terminal:write', (_event, sessionId: string, data: string) => {
    return writeToSession(sessionId, data)
  })

  ipcMain.handle('terminal:resize', (_event, sessionId: string, cols: number, rows: number) => {
    return resizeSession(sessionId, cols, rows)
  })

  ipcMain.handle('terminal:disconnect', async (_event, sessionId: string) => {
    const ok = disconnectSession(sessionId)
    if (ok) {
      const meta = getSession(sessionId)
      if (meta) await persistMeta(meta, null)
    }
    return ok
  })

  ipcMain.handle(
    'terminal:restart',
    async (event, sessionId: string, dims?: { cols?: number; rows?: number }) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const deps = await connectDeps()
      // Restart is always a fresh launch — the user clicked Restart
      // because the prior process exited / they want a clean slate.
      const ok = await restartSession(
        sessionId,
        (data) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send('terminal:data', sessionId, data)
          }
        },
        (code) => {
          if (win && !win.isDestroyed()) {
            const updated = getSession(sessionId)
            win.webContents.send('terminal:exit', sessionId, code, updated?.state ?? 'exited')
          }
          const updated = getSession(sessionId)
          if (updated) void persistMeta(updated, new Date().toISOString())
        },
        { bridgedEnv: deps.bridgedEnv, cols: dims?.cols, rows: dims?.rows, mode: 'fresh' }
      )
      if (ok) {
        const updated = getSession(sessionId)
        if (updated) await persistMeta(updated, new Date().toISOString())
      }
      return ok
    }
  )

  ipcMain.handle('terminal:destroy', (_event, sessionId: string) => {
    return destroySession(sessionId)
  })
}
