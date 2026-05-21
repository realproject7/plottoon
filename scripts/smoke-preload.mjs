/**
 * Electron smoke test for issue #192.
 *
 * Launches the built Electron app, verifies:
 *  1. No "Unable to load preload script" error
 *  2. window.plottoon is defined in the renderer
 *  3. The initial Projects screen renders (h1 with "Projects" text)
 *
 * Usage: npm run build && node scripts/smoke-preload.mjs
 * Exit code 0 = pass, 1 = fail
 */

import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const electronPath = resolve(ROOT, 'node_modules', '.bin', 'electron')

const TIMEOUT_MS = 30_000

function launchElectron() {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`Smoke test timed out after ${TIMEOUT_MS}ms`))
    }, TIMEOUT_MS)

    const child = spawn(
      electronPath,
      [resolve(ROOT, 'scripts', 'smoke-preload-entry.mjs')],
      {
        cwd: ROOT,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })
    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      resolvePromise({ code, stdout, stderr })
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

async function main() {
  console.log('Smoke test: launching Electron...')
  const { code, stdout, stderr } = await launchElectron()

  const output = stdout + stderr
  const results = {}
  for (const line of stdout.split('\n')) {
    if (line.startsWith('SMOKE:')) {
      const [, key, value] = line.match(/^SMOKE:(\w+)=(.*)$/) || []
      if (key) results[key] = value
    }
  }

  let passed = true

  // Check 1: no preload load error
  if (output.includes('Unable to load preload script')) {
    console.error('FAIL: "Unable to load preload script" error detected')
    passed = false
  } else {
    console.log('PASS: No preload load error')
  }

  // Check 2: window.plottoon exists
  if (results.plottoonDefined === 'true') {
    console.log('PASS: window.plottoon is defined')
  } else {
    console.error('FAIL: window.plottoon is not defined')
    passed = false
  }

  // Check 3: Projects screen renders
  if (results.projectsHeading === 'true') {
    console.log('PASS: Projects screen heading found')
  } else {
    console.error('FAIL: Projects screen heading not found')
    passed = false
  }

  if (!passed) {
    console.error('\nSmoke test FAILED')
    if (stderr) console.error('stderr:', stderr)
    process.exit(1)
  }

  console.log('\nSmoke test PASSED')
  process.exit(0)
}

main().catch((err) => {
  console.error('Smoke test error:', err)
  process.exit(1)
})
