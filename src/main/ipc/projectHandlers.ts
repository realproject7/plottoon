import { ipcMain, dialog, BrowserWindow } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { registerProject, getProjectRoot } from '../services/projectRegistry'
import {
  readProjectMeta,
  writeProjectMeta,
  createProjectMeta,
  validateMeta,
  ProjectMetaError
} from '../services/projectMeta'
import { discoverProjects, partitionProjectsByWallet } from '../services/projectDiscovery'
import { scaffoldProjectTemplate } from '../services/projectTemplate'
import { resolveAppConfigPath } from '../services/safePaths'
import { detectClis } from '../services/cliDetection'
import { generateReport } from '../services/capabilityReport'
import type { CapabilityCheck, CheckStatus } from '../services/capabilityReport'
import { logAction, getLog } from '../services/actionLog'
import type { WalletIdentityStore } from '../services/walletIdentityStore'
import type { PublishConfig } from '../services/plotlinkPublish'
import type { OWSCoreModule, OWSVaultConfig } from '../services/owsAdapter'
import { checkActiveWalletInVault } from '../services/walletVaultCheck'

const PROJECTS_DIR_KEY = 'projectsDir'

async function getProjectsDir(): Promise<string | null> {
  try {
    const configPath = resolveAppConfigPath(PROJECTS_DIR_KEY)
    return (await fs.readFile(configPath, 'utf-8')).trim()
  } catch {
    return null
  }
}

async function setProjectsDir(dir: string): Promise<void> {
  const configPath = resolveAppConfigPath(PROJECTS_DIR_KEY)
  const configDir = path.dirname(configPath)
  await fs.mkdir(configDir, { recursive: true })
  await fs.writeFile(configPath, dir, 'utf-8')
}

async function probeWriteAccess(dir: string | null): Promise<CapabilityCheck> {
  if (!dir) {
    return {
      id: 'write-access',
      label: 'Project write access',
      status: 'fail',
      detail:
        'No projects directory configured. Choose a projects folder via "New Project" on the Projects screen to enable editing and publishing.'
    }
  }
  try {
    await fs.mkdir(dir, { recursive: true })
    const probe = path.join(dir, '.plottoon-probe')
    await fs.writeFile(probe, '', 'utf-8')
    await fs.unlink(probe)
    return {
      id: 'write-access',
      label: 'Project write access',
      status: 'pass',
      detail: 'Filesystem is writable'
    }
  } catch {
    return {
      id: 'write-access',
      label: 'Project write access',
      status: 'fail',
      detail: 'Cannot write to project directory'
    }
  }
}

export interface RegisterProjectHandlersOptions {
  /**
   * Optional — when provided, `project:discover` partitions projects by the
   * active wallet's address, and `project:create` stamps the new project
   * with that address. `project:assignWallet` is only registered when a
   * store is available.
   */
  walletIdentityStore?: WalletIdentityStore
  /**
   * Optional capability-report context. The `capability:getReport` handler
   * uses these to surface real PlotLink / wallet / signer-mode state on
   * the Status page instead of the old static placeholders (#253).
   * Each field is optional so non-production callers (tests, older
   * wirings) don't have to provide a full publish config.
   *
   * `owsModule` + `vaultConfig` enable the vault freshness check on the
   * Status wallet row (#253 RE1): the active identity is validated
   * against the live vault with the same helper signing flows use, so
   * the Status page can't show Wallet:pass / Publish:pass when the user
   * would actually fail the live freshness guard at publish/claim/agent
   * time. In mock mode the freshness check is skipped.
   */
  capabilityContext?: {
    publishConfig?: PublishConfig | null
    signerMode?: 'live' | 'mock'
    owsModule?: Pick<OWSCoreModule, 'listWallets'>
    vaultConfig?: Pick<OWSVaultConfig, 'vaultPath'>
  }
}

export function registerProjectHandlers(options: RegisterProjectHandlersOptions = {}): void {
  const walletStore = options.walletIdentityStore
  const capabilityContext = options.capabilityContext

  ipcMain.handle('project:discover', async () => {
    // Resolve the active wallet first so a first-run user with a selected
    // wallet but no projects directory still sees the active-wallet empty
    // state (and the New Project path) instead of "No active wallet".
    const activeAddress = walletStore ? ((await walletStore.getActive())?.address ?? null) : null
    const dir = await getProjectsDir()
    if (!dir) {
      return { owned: [], legacy: [], otherWallets: [], errors: [], activeAddress }
    }
    const projects = await discoverProjects(dir)
    return { ...partitionProjectsByWallet(projects, activeAddress), activeAddress }
  })

  ipcMain.handle('project:readMeta', async (_event, projectId: string) => {
    const root = getProjectRoot(projectId)
    return readProjectMeta(root)
  })

  ipcMain.handle('project:writeMeta', async (_event, projectId: string, meta: unknown) => {
    const root = getProjectRoot(projectId)
    const validated = validateMeta(meta, root)
    await writeProjectMeta(root, validated)
    logAction('project:writeMeta', `Updated metadata for project`, projectId)
  })

  ipcMain.handle('project:create', async (event, name: string, description?: string) => {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (trimmed.length === 0) {
      throw new ProjectMetaError('Project name must be a non-empty string', '')
    }

    const slug = trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    if (slug.length === 0) {
      throw new ProjectMetaError(
        'Project name must contain at least one alphanumeric character',
        ''
      )
    }

    let projectsDir = await getProjectsDir()

    if (!projectsDir) {
      const win = BrowserWindow.fromWebContents(event.sender)
      const result = await dialog.showOpenDialog(win ?? BrowserWindow.getFocusedWindow()!, {
        title: 'Choose projects folder',
        properties: ['openDirectory', 'createDirectory']
      })
      if (result.canceled || result.filePaths.length === 0) return null
      projectsDir = result.filePaths[0]
      await setProjectsDir(projectsDir)
    }

    // Resolve the active wallet so new projects are wallet-scoped from the
    // first save. Per #220, do NOT infer from the first plotlink-writer
    // wallet — only stamp when there's a deliberately-selected active one.
    const activeIdentity = walletStore ? await walletStore.getActive() : null
    if (walletStore && !activeIdentity) {
      throw new ProjectMetaError(
        'Cannot create a project: no active wallet selected. Connect or switch a wallet first.',
        ''
      )
    }

    const projectPath = path.join(projectsDir, slug)
    await fs.mkdir(projectPath, { recursive: true })

    const meta = createProjectMeta(
      trimmed,
      description,
      activeIdentity
        ? { address: activeIdentity.address, source: activeIdentity.source }
        : undefined
    )
    await writeProjectMeta(projectPath, meta)
    await scaffoldProjectTemplate(projectPath, trimmed)

    const id = registerProject(projectPath)
    logAction('project:create', `Created project "${trimmed}"`, id)
    return { id, path: projectPath, meta }
  })

  ipcMain.handle('project:assignWallet', async (_event, projectId: string) => {
    if (!walletStore) {
      throw new ProjectMetaError('project:assignWallet requires a wallet identity store', '')
    }
    const active = await walletStore.getActive()
    if (!active) {
      throw new ProjectMetaError('Cannot assign a project: no active wallet selected.', '')
    }
    const root = getProjectRoot(projectId)
    const existing = await readProjectMeta(root)
    // No-op when the project is already attached to the active wallet.
    if (existing.wallet?.address === active.address) {
      return { ok: true, meta: existing }
    }
    // Strict legacy-only assignment per #220: never silently move a project
    // from one known wallet to another. A project that is already stamped
    // must be re-stamped only via a future explicit transfer flow that the
    // user-driven UI surfaces with confirmation.
    if (existing.wallet) {
      throw new ProjectMetaError(
        'This project is already assigned to a different wallet. Switch to that wallet to access it instead of reassigning.',
        root
      )
    }
    const next = {
      ...existing,
      wallet: { address: active.address, source: active.source },
      updatedAt: new Date().toISOString()
    }
    await writeProjectMeta(root, next)
    logAction('project:assignWallet', `Assigned legacy project to active wallet`, projectId)
    return { ok: true, meta: next }
  })

  ipcMain.handle('project:setProjectsDir', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win ?? BrowserWindow.getFocusedWindow()!, {
      title: 'Choose projects folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    await setProjectsDir(result.filePaths[0])
    logAction('project:setProjectsDir', `Set projects directory`)
    return result.filePaths[0]
  })

  ipcMain.handle('project:getProjectsDir', () => getProjectsDir())

  ipcMain.handle('project:detectClis', () => detectClis())

  ipcMain.handle('capability:getReport', async () => {
    const [cliReport, projectDir, activeIdentity] = await Promise.all([
      detectClis(),
      getProjectsDir(),
      // Read the active wallet on every report so a switch is picked up
      // without needing a full app restart. Falls back to null if no
      // walletStore was wired in (test setups, older bootstraps).
      walletStore ? walletStore.getActive() : Promise.resolve(null)
    ])

    const cliChecks: CapabilityCheck[] = cliReport.clis.map((cli) => ({
      id: `cli-${cli.command}`,
      label: cli.name,
      status: (cli.installed ? 'pass' : 'fail') as CheckStatus,
      detail: cli.installed ? `Detected: ${cli.version}` : `${cli.command} not found in PATH`
    }))

    const writeAccessCheck = await probeWriteAccess(projectDir)

    // Project the identity through the renderer-safe view shape (#234).
    // The OWS internal `owsName` must not cross the IPC boundary.
    const activeWallet = activeIdentity
      ? { address: activeIdentity.address, source: activeIdentity.source }
      : null

    // #253 RE1: in live mode, run the same vault freshness guard the
    // publish/claim/agent flows use so Status can't show Wallet:pass /
    // Publish:pass for an active identity that would fail the live
    // signing precheck. The helper accepts the internal `{name,address}`
    // and returns only a generic non-secret outcome — `owsName` and
    // `vaultPath` stay inside the handler.
    const signerMode = capabilityContext?.signerMode ?? 'live'
    let walletFreshness: { ok: boolean; error?: string } | null = null
    if (
      signerMode === 'live' &&
      activeIdentity &&
      capabilityContext?.owsModule &&
      capabilityContext?.vaultConfig
    ) {
      try {
        walletFreshness = checkActiveWalletInVault(
          capabilityContext.owsModule,
          capabilityContext.vaultConfig,
          { name: activeIdentity.owsName, address: activeIdentity.address }
        )
      } catch {
        // The helper already wraps `listWallets` in try/catch and
        // returns a generic error; this outer guard is a defense in
        // depth in case a future code path throws synchronously. Fall
        // back to the same generic stale-wallet message so the Status
        // page never leaks the underlying detail.
        walletFreshness = {
          ok: false,
          error:
            'The active wallet is no longer available. Reconnect or switch wallets to continue.'
        }
      }
    }

    return generateReport({
      cliChecks,
      writeAccessCheck,
      activeWallet,
      publishConfig: capabilityContext?.publishConfig ?? null,
      signerMode,
      walletFreshness
    })
  })

  ipcMain.handle(
    'actionLog:log',
    (_event, action: string, detail: string, projectId?: string, plotId?: string) =>
      logAction(action, detail, projectId ?? null, plotId ?? null)
  )

  ipcMain.handle('actionLog:get', (_event, projectId?: string) => getLog(projectId))
}
