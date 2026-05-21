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

  // Listen for console messages from renderer
  win.webContents.on('console-message', (_event, _level, message) => {
    if (message.includes('Unable to load preload script')) {
      process.stderr.write(message + '\n')
    }
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

  app.quit()
})

app.on('window-all-closed', () => {
  app.quit()
})
