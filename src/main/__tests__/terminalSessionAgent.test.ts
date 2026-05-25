import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  createSession,
  connectSession,
  destroySession,
  clearSessionsForTesting,
  type PtyHandle,
  type PtySpawnOptions
} from '../services/terminalSession'

let tmpDir: string

beforeEach(() => {
  clearSessionsForTesting()
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'plottoon-agent-session-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function fakePty(): {
  handle: PtyHandle
  exitHandlers: Array<(e: { exitCode: number | null }) => void>
  dataHandlers: Array<(s: string) => void>
  writes: string[]
  killed: boolean
} {
  const exitHandlers: Array<(e: { exitCode: number | null }) => void> = []
  const dataHandlers: Array<(s: string) => void> = []
  const writes: string[] = []
  let killed = false
  const handle: PtyHandle = {
    onData(h) {
      dataHandlers.push(h)
    },
    onExit(h) {
      exitHandlers.push(h)
    },
    write(d) {
      writes.push(d)
    },
    resize() {},
    kill() {
      killed = true
    }
  }
  return {
    handle,
    exitHandlers,
    dataHandlers,
    writes,
    get killed() {
      return killed
    }
  } as ReturnType<typeof fakePty>
}

describe('#272 connectSession — spawns the configured agent command, not a plain shell', () => {
  it('spawns Claude (claude --session-id ... in projectRoot) when agentKind=claude on fresh session', async () => {
    const calls: PtySpawnOptions[] = []
    const session = createSession({
      projectId: 'proj_1',
      cwd: tmpDir,
      walletAddress: null,
      agentKind: 'claude'
    })

    const ptyResult = fakePty()
    const ok = await connectSession(
      session.id,
      () => {},
      () => {},
      {
        spawner: (options) => {
          calls.push(options)
          return ptyResult.handle
        }
      }
    )

    expect(ok).toBe(true)
    expect(calls).toHaveLength(1)
    const call = calls[0]
    expect(call.command).toBe('claude')
    // #273: createSession now allocates a UUID for new Claude
    // sessions and passes it via `--session-id <uuid>`.
    expect(call.args[0]).toBe('--session-id')
    expect(call.args[1]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(call.cwd).toBe(tmpDir)
    expect(call.env.TERM).toBe('xterm-256color')

    // CRITICAL: the spawned command is NOT the user's shell.
    expect(call.command).not.toBe(process.env.SHELL || '/bin/sh')
    expect(call.command).not.toBe('cmd.exe')

    destroySession(session.id)
  })

  it('spawns Codex (codex -C <projectRoot>) when agentKind=codex on fresh session', async () => {
    const calls: PtySpawnOptions[] = []
    const session = createSession({
      projectId: 'proj_codex',
      cwd: tmpDir,
      walletAddress: null,
      agentKind: 'codex'
    })

    await connectSession(
      session.id,
      () => {},
      () => {},
      {
        spawner: (options) => {
          calls.push(options)
          return fakePty().handle
        }
      }
    )

    expect(calls[0].command).toBe('codex')
    expect(calls[0].args).toEqual(['-C', tmpDir])
    expect(calls[0].cwd).toBe(tmpDir)
    destroySession(session.id)
  })

  it('falls back to the user shell only when agentKind is explicitly null (legacy path)', async () => {
    // Legacy callers that pass agentKind=null get the old shell
    // spawning behaviour. New PlotToon sessions always set
    // agentKind via #271 detection.
    const calls: PtySpawnOptions[] = []
    const session = createSession({
      projectId: 'proj_legacy',
      cwd: tmpDir,
      walletAddress: null,
      agentKind: null
    })

    await connectSession(
      session.id,
      () => {},
      () => {},
      {
        spawner: (options) => {
          calls.push(options)
          return fakePty().handle
        }
      }
    )

    const expectedShell = process.platform === 'win32' ? 'cmd.exe' : process.env.SHELL || '/bin/sh'
    expect(calls[0].command).toBe(expectedShell)
    destroySession(session.id)
  })

  it('writeToSession forwards data to the PTY handle (input round-trip)', async () => {
    const ptyResult = fakePty()
    const session = createSession({
      projectId: 'proj_w',
      cwd: tmpDir,
      walletAddress: null,
      agentKind: 'claude'
    })
    await connectSession(
      session.id,
      () => {},
      () => {},
      { spawner: () => ptyResult.handle }
    )
    const { writeToSession } = await import('../services/terminalSession')
    writeToSession(session.id, 'hello\r')
    expect(ptyResult.writes).toEqual(['hello\r'])
    destroySession(session.id)
  })

  it('resizeSession forwards cols/rows to the PTY handle', async () => {
    const ptyResult = fakePty()
    let lastResize: [number, number] | null = null
    const handle: PtyHandle = {
      ...ptyResult.handle,
      resize(cols, rows) {
        lastResize = [cols, rows]
      }
    }
    const session = createSession({
      projectId: 'proj_r',
      cwd: tmpDir,
      walletAddress: null,
      agentKind: 'claude'
    })
    await connectSession(
      session.id,
      () => {},
      () => {},
      { spawner: () => handle }
    )
    const { resizeSession } = await import('../services/terminalSession')
    resizeSession(session.id, 120, 40)
    expect(lastResize).toEqual([120, 40])
    destroySession(session.id)
  })

  it('passes #276 bridged env (e.g. ATLASCLOUD_API_KEY) into the spawned env', async () => {
    const calls: PtySpawnOptions[] = []
    const session = createSession({
      projectId: 'proj_bridge',
      cwd: tmpDir,
      walletAddress: null,
      agentKind: 'claude'
    })
    await connectSession(
      session.id,
      () => {},
      () => {},
      {
        spawner: (options) => {
          calls.push(options)
          return fakePty().handle
        },
        bridgedEnv: { ATLASCLOUD_API_KEY: 'fake-test-atlas-key-9988' }
      }
    )
    expect(calls[0].env.ATLASCLOUD_API_KEY).toBe('fake-test-atlas-key-9988')
    destroySession(session.id)
  })

  it('default deny list still applies when bridgedEnv is empty: ANTHROPIC_API_KEY is NOT forwarded', async () => {
    const ORIGINAL = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'fake-test-distinctive-anthropic-key-aabb'
    try {
      const calls: PtySpawnOptions[] = []
      const session = createSession({
        projectId: 'proj_deny',
        cwd: tmpDir,
        walletAddress: null,
        agentKind: 'claude'
      })
      await connectSession(
        session.id,
        () => {},
        () => {},
        {
          spawner: (options) => {
            calls.push(options)
            return fakePty().handle
          }
        }
      )
      expect(calls[0].env.ANTHROPIC_API_KEY).toBeUndefined()
      destroySession(session.id)
    } finally {
      if (ORIGINAL === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = ORIGINAL
    }
  })

  it('onExit fires from PTY exit event and updates session state', async () => {
    const ptyResult = fakePty()
    const session = createSession({
      projectId: 'proj_x',
      cwd: tmpDir,
      walletAddress: null,
      agentKind: 'claude'
    })
    let exitCode: number | null | undefined
    await connectSession(
      session.id,
      () => {},
      (code) => {
        exitCode = code
      },
      { spawner: () => ptyResult.handle }
    )
    // Simulate the PTY exiting.
    ptyResult.exitHandlers.forEach((h) => h({ exitCode: 137 }))
    expect(exitCode).toBe(137)
    const { getSession } = await import('../services/terminalSession')
    expect(getSession(session.id)?.state).toBe('exited')
    expect(getSession(session.id)?.exitCode).toBe(137)
    destroySession(session.id)
  })
})

describe('#272 connectSession env handling — no secret leakage', () => {
  it('does not include any wallet-shaped or private-key env in the spawned env (default sanitizer applies)', async () => {
    const ORIGINAL = {
      walletPriv: process.env.WALLET_PRIVATE_KEY,
      mnemonic: process.env.MNEMONIC,
      seed: process.env.SEED_PHRASE
    }
    process.env.WALLET_PRIVATE_KEY = 'fake-test-wallet-priv'
    process.env.MNEMONIC = 'fake-test-mnemonic-words'
    process.env.SEED_PHRASE = 'fake-test-seed-phrase'
    try {
      const calls: PtySpawnOptions[] = []
      const session = createSession({
        projectId: 'proj_secrets',
        cwd: tmpDir,
        walletAddress: null,
        agentKind: 'claude'
      })
      await connectSession(
        session.id,
        () => {},
        () => {},
        {
          spawner: (options) => {
            calls.push(options)
            return fakePty().handle
          }
        }
      )
      const env = calls[0].env
      const serialized = JSON.stringify(env)
      expect(serialized).not.toContain('fake-test-wallet-priv')
      expect(serialized).not.toContain('fake-test-mnemonic-words')
      expect(serialized).not.toContain('fake-test-seed-phrase')
      destroySession(session.id)
    } finally {
      if (ORIGINAL.walletPriv === undefined) delete process.env.WALLET_PRIVATE_KEY
      else process.env.WALLET_PRIVATE_KEY = ORIGINAL.walletPriv
      if (ORIGINAL.mnemonic === undefined) delete process.env.MNEMONIC
      else process.env.MNEMONIC = ORIGINAL.mnemonic
      if (ORIGINAL.seed === undefined) delete process.env.SEED_PHRASE
      else process.env.SEED_PHRASE = ORIGINAL.seed
    }
  })
})
