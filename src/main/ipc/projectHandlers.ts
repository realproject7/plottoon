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
import { discoverProjects } from '../services/projectDiscovery'
import { scaffoldProjectTemplate } from '../services/projectTemplate'
import { resolveAppConfigPath } from '../services/safePaths'
import { detectClis } from '../services/cliDetection'
import { generateReport } from '../services/capabilityReport'
import type { CapabilityCheck, CheckStatus } from '../services/capabilityReport'
import { logAction, getLog } from '../services/actionLog'

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
      detail: 'No projects directory configured'
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

export function registerProjectHandlers(): void {
  ipcMain.handle('project:discover', async () => {
    const dir = await getProjectsDir()
    if (!dir) return []
    return discoverProjects(dir)
  })

  ipcMain.handle('project:readMeta', async (_event, projectId: string) => {
    const root = getProjectRoot(projectId)
    return readProjectMeta(root)
  })

  ipcMain.handle('project:writeMeta', async (_event, projectId: string, meta: unknown) => {
    const root = getProjectRoot(projectId)
    const validated = validateMeta(meta, root)
    await writeProjectMeta(root, validated)
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

    const projectPath = path.join(projectsDir, slug)
    await fs.mkdir(projectPath, { recursive: true })

    const meta = createProjectMeta(trimmed, description)
    await writeProjectMeta(projectPath, meta)
    await scaffoldProjectTemplate(projectPath, trimmed)

    const id = registerProject(projectPath)
    return { id, path: projectPath, meta }
  })

  ipcMain.handle('project:setProjectsDir', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win ?? BrowserWindow.getFocusedWindow()!, {
      title: 'Choose projects folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    await setProjectsDir(result.filePaths[0])
    return result.filePaths[0]
  })

  ipcMain.handle('project:getProjectsDir', () => getProjectsDir())

  ipcMain.handle('project:detectClis', () => detectClis())

  ipcMain.handle('capability:getReport', async () => {
    const [cliReport, projectDir] = await Promise.all([detectClis(), getProjectsDir()])

    const cliChecks: CapabilityCheck[] = cliReport.clis.map((cli) => ({
      id: `cli-${cli.command}`,
      label: cli.name,
      status: (cli.installed ? 'pass' : 'fail') as CheckStatus,
      detail: cli.installed ? `Detected: ${cli.version}` : `${cli.command} not found in PATH`
    }))

    const writeAccessCheck = await probeWriteAccess(projectDir)

    return generateReport({ cliChecks, writeAccessCheck })
  })

  ipcMain.handle(
    'actionLog:log',
    (_event, action: string, detail: string, projectId?: string, plotId?: string) =>
      logAction(action, detail, projectId ?? null, plotId ?? null)
  )

  ipcMain.handle('actionLog:get', (_event, projectId?: string) => getLog(projectId))
}
