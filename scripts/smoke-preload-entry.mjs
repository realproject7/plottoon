/**
 * Electron main-process entry for the preload smoke test.
 * Loads the built app, evaluates checks in the renderer, prints results, then quits.
 */

import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const distPreload = path.join(ROOT, 'dist', 'preload')
const distRenderer = path.join(ROOT, 'dist', 'renderer')

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: {
      preload: path.join(distPreload, 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const pageErrors = []

  // Listen for console messages from renderer
  win.webContents.on('console-message', (_event, level, message) => {
    if (message.includes('Unable to load preload script')) {
      process.stderr.write(message + '\n')
    }
    // Capture renderer errors logged to console (level 3 = error)
    if (level === 3 && message.includes('Error invoking remote method')) {
      pageErrors.push(message)
    }
  })

  // Fail fast if the renderer page cannot load
  win.webContents.on('did-fail-load', (_event, code, description) => {
    process.stderr.write(`Renderer failed to load: ${code} ${description}\n`)
    app.exit(1)
  })

  // Fail fast on renderer crash
  win.webContents.on('render-process-gone', (_event, details) => {
    process.stderr.write(`Renderer process gone: ${details.reason}\n`)
    app.exit(1)
  })

  await win.loadFile(path.join(distRenderer, 'index.html'))

  // Wait briefly for React to mount
  await new Promise((resolve) => setTimeout(resolve, 3000))

  // Check window.plottoon
  const plottoonDefined = await win.webContents.executeJavaScript(
    'typeof window.plottoon !== "undefined"'
  )
  process.stdout.write(`SMOKE:plottoonDefined=${plottoonDefined}\n`)

  // Check Projects heading
  const projectsHeading = await win.webContents.executeJavaScript(
    `(() => {
      const headings = document.querySelectorAll('h1')
      for (const h of headings) {
        if (h.textContent && h.textContent.includes('Projects')) return true
      }
      return false
    })()`
  )
  process.stdout.write(`SMOKE:projectsHeading=${projectsHeading}\n`)

  // Report page errors count so the outer runner can check
  process.stdout.write(`SMOKE:pageErrors=${pageErrors.length}\n`)
  for (const err of pageErrors) {
    process.stderr.write(`Page error: ${err}\n`)
  }

  app.quit()
})

app.on('window-all-closed', () => {
  app.quit()
})
