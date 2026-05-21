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
const isCI = process.env.CI === 'true'

function launchElectron() {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`Smoke test timed out after ${TIMEOUT_MS}ms`))
    }, TIMEOUT_MS)

    const args = [resolve(ROOT, 'scripts', 'smoke-preload-entry.mjs')]

    // On CI Linux, chrome-sandbox requires root ownership; use --no-sandbox instead
    if (isCI) {
      args.unshift('--no-sandbox')
    }

    const child = spawn(electronPath, args, {
      cwd: ROOT,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })
    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('close', (code, signal) => {
      clearTimeout(timer)
      resolvePromise({ code, signal, stdout, stderr })
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

async function main() {
  console.log('Smoke test: launching Electron...')
  const { code, signal, stdout, stderr } = await launchElectron()

  // Check for launch failure before evaluating renderer assertions
  if (code !== 0 && code !== null) {
    console.error(`FAIL: Electron exited with code ${code}`)
    if (stderr) console.error('stderr:', stderr)
    process.exit(1)
  }
  if (signal) {
    console.error(`FAIL: Electron killed by signal ${signal}`)
    if (stderr) console.error('stderr:', stderr)
    process.exit(1)
  }

  const output = stdout + stderr
  const results = {}
  for (const line of stdout.split('\n')) {
    if (line.startsWith('SMOKE:')) {
      const [, key, value] = line.match(/^SMOKE:(\w+)=(.*)$/) || []
      if (key) results[key] = value
    }
  }

  // Require all SMOKE result keys to be present
  const requiredKeys = ['plottoonDefined', 'projectsHeading', 'pageErrors', 'walletOptions']
  const missingKeys = requiredKeys.filter((k) => !(k in results))
  if (missingKeys.length > 0) {
    console.error(`FAIL: Missing smoke results: ${missingKeys.join(', ')}`)
    console.error('Electron may have crashed before renderer checks completed.')
    if (stderr) console.error('stderr:', stderr)
    process.exit(1)
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

  // Check 4: no page errors (e.g. wallet:getOptions IPC failures)
  const errorCount = parseInt(results.pageErrors, 10)
  if (errorCount === 0) {
    console.log('PASS: No startup page errors')
  } else {
    console.error(`FAIL: ${errorCount} startup page error(s) detected`)
    passed = false
  }

  // Check 5 (regression for #198): wallet:getOptions must resolve to an
  // enabled create-new option in a normal build environment. If OWS is
  // genuinely unavailable the reason must match the stable sentinel —
  // never a bundler-internal name like `mod2.listWallets is not a function`.
  let walletOptions = null
  try {
    walletOptions = JSON.parse(results.walletOptions)
  } catch (e) {
    console.error(`FAIL: walletOptions payload was not valid JSON: ${e.message}`)
    passed = false
  }
  if (walletOptions) {
    const first = walletOptions && walletOptions.options && walletOptions.options[0]
    if (!first) {
      console.error('FAIL: wallet:getOptions returned no options')
      passed = false
    } else if (first.available !== false) {
      console.log('PASS: wallet:getOptions returned enabled create-new option')
    } else {
      const reason = String(first.unavailableReason || '')
      const looksLikeBundlerLeak =
        /\bmod\d*\./i.test(reason) ||
        /\b(?:listWallets|createWallet|signMessage|signTransaction) is not a function\b/i.test(
          reason
        )
      if (looksLikeBundlerLeak) {
        console.error(
          `FAIL: wallet:getOptions fell back with a bundler-internal reason: ${JSON.stringify(reason)}`
        )
        passed = false
      } else if (reason === 'OWS wallet module is unavailable') {
        console.log(
          'PASS: wallet:getOptions fell back to the stable sentinel (OWS genuinely unavailable in this env)'
        )
      } else {
        console.error(
          `FAIL: wallet:getOptions disabled create-new with an unstable reason: ${JSON.stringify(reason)}`
        )
        passed = false
      }
    }
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
