/**
 * Electron main-process entry for the preload smoke test.
 *
 * Imports the production main bundle (which registers every IPC handler and
 * opens the renderer), then waits for the main window, runs renderer-side
 * assertions, and exits. This shape lets the smoke exercise the real
 * wallet:getOptions IPC path — required for the #198 regression check.
 */

import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const distMainEntry = path.join(ROOT, 'dist', 'main', 'index.js')

// Side-effect import: registers handlers and opens the main window on whenReady.
await import(pathToFileURL(distMainEntry).href)

const pageErrors = []

function waitForMainWindow(timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = () => {
      const wins = BrowserWindow.getAllWindows()
      if (wins.length > 0) return resolve(wins[0])
      if (Date.now() - start > timeoutMs) {
        return reject(new Error('Timed out waiting for main BrowserWindow'))
      }
      setTimeout(tick, 50)
    }
    tick()
  })
}

app.whenReady().then(async () => {
  let win
  try {
    win = await waitForMainWindow()
  } catch (err) {
    process.stderr.write(`Smoke setup failed: ${err.message}\n`)
    app.exit(1)
    return
  }

  win.webContents.on('console-message', (_event, level, message) => {
    if (message.includes('Unable to load preload script')) {
      process.stderr.write(message + '\n')
    }
    if (level === 3 && message.includes('Error invoking remote method')) {
      pageErrors.push(message)
    }
  })

  win.webContents.on('did-fail-load', (_event, code, description) => {
    process.stderr.write(`Renderer failed to load: ${code} ${description}\n`)
    app.exit(1)
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    process.stderr.write(`Renderer process gone: ${details.reason}\n`)
    app.exit(1)
  })

  // Wait for the renderer to finish loading and React to mount.
  if (win.webContents.isLoading()) {
    await new Promise((resolve) => win.webContents.once('did-finish-load', resolve))
  }
  await new Promise((resolve) => setTimeout(resolve, 3000))

  const plottoonDefined = await win.webContents.executeJavaScript(
    'typeof window.plottoon !== "undefined"'
  )
  process.stdout.write(`SMOKE:plottoonDefined=${plottoonDefined}\n`)

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

  process.stdout.write(`SMOKE:pageErrors=${pageErrors.length}\n`)
  for (const err of pageErrors) {
    process.stderr.write(`Page error: ${err}\n`)
  }

  // Regression check for #198: wallet:getOptions must resolve to an enabled
  // create-new option (or, if OWS is genuinely unavailable, to the stable
  // sentinel — never a bundler-internal name like `mod2.listWallets`).
  const walletOptionsRaw = await win.webContents
    .executeJavaScript(
      'window.plottoon.wallet.getOptions().then(r => JSON.stringify(r)).catch(e => JSON.stringify({ error: String(e && e.message || e) }))'
    )
    .catch((e) => JSON.stringify({ error: String(e && e.message) }))
  process.stdout.write(`SMOKE:walletOptions=${walletOptionsRaw}\n`)

  app.quit()
})

app.on('window-all-closed', () => {
  app.quit()
})
