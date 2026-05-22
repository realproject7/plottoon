import { spawn, type ChildProcess } from 'node:child_process'
import { platform } from 'node:os'
import { buildAgentEnv } from './agentEnv'
import { normalizeWalletAddress } from '../../shared/walletIdentity'

export type SessionState = 'connected' | 'disconnected' | 'exited'

export interface SessionMeta {
  id: string
  projectId: string
  /**
   * Lowercased EVM address of the wallet that owns this session, or null
   * for a legacy session that predates #221 wallet-keying. A legacy session
   * is migrated to the first non-null wallet that asks for it (see
   * `findSessionByProjectAndWallet`).
   */
  walletAddress: string | null
  cwd: string
  state: SessionState
  createdAt: string
  exitCode: number | null
}

let nextId = 1

const sessions = new Map<string, SessionMeta>()
const processes = new Map<string, ChildProcess>()
const generations = new Map<string, number>()

function defaultShell(): string {
  if (platform() === 'win32') return 'cmd.exe'
  return process.env.SHELL || '/bin/sh'
}

function normalizeOrNull(address: string | null | undefined): string | null {
  return address ? normalizeWalletAddress(address) : null
}

/**
 * Look up a non-exited session for `projectId` that matches `walletAddress`.
 * If `walletAddress` is non-null and an unmigrated legacy session
 * (`walletAddress === null`) exists for the same project, the first lookup
 * claims it by stamping the wallet address in place. This is the migration
 * path required by #221: existing one-wallet users keep their session.
 */
export function findSessionByProjectAndWallet(
  projectId: string,
  walletAddress: string | null
): SessionMeta | null {
  const key = normalizeOrNull(walletAddress)
  // Exact-match pass first: a session that already owns the (project, wallet)
  // pair wins over any legacy session, so a wallet that already migrated its
  // own session never accidentally claims another.
  for (const meta of sessions.values()) {
    if (meta.state === 'exited') continue
    if (meta.projectId !== projectId) continue
    if (meta.walletAddress === key) return meta
  }
  // Legacy migration pass: only for a non-null caller. A null caller has no
  // wallet to claim with, so it must not silently take over a legacy session.
  if (key !== null) {
    for (const meta of sessions.values()) {
      if (meta.state === 'exited') continue
      if (meta.projectId !== projectId) continue
      if (meta.walletAddress === null) {
        const migrated: SessionMeta = { ...meta, walletAddress: key }
        sessions.set(meta.id, migrated)
        return migrated
      }
    }
  }
  return null
}

export function createSession(
  projectId: string,
  cwd: string,
  walletAddress: string | null
): SessionMeta {
  const key = normalizeOrNull(walletAddress)
  const existing = findSessionByProjectAndWallet(projectId, key)
  if (existing && existing.state === 'connected') {
    return existing
  }
  if (existing) return existing

  const id = `term_${nextId++}`
  const meta: SessionMeta = {
    id,
    projectId,
    walletAddress: key,
    cwd,
    state: 'disconnected',
    createdAt: new Date().toISOString(),
    exitCode: null
  }
  sessions.set(id, meta)
  generations.set(id, 0)
  return meta
}

export function getSession(id: string): SessionMeta | null {
  return sessions.get(id) ?? null
}

/**
 * @deprecated Project-only lookup that ignores wallet scope. Retained for
 * tests that pre-date #221 wallet-keyed sessions. New callers must use
 * `findSessionByProjectAndWallet` so wallet A and wallet B never reattach
 * to each other's terminal.
 */
export function findSessionByProject(projectId: string): SessionMeta | null {
  for (const meta of sessions.values()) {
    if (meta.projectId === projectId && meta.state !== 'exited') {
      return meta
    }
  }
  return null
}

export function listSessions(): SessionMeta[] {
  return [...sessions.values()]
}

function killProcess(id: string): void {
  const child = processes.get(id)
  if (child) {
    child.removeAllListeners('exit')
    child.stdout?.removeAllListeners('data')
    child.stderr?.removeAllListeners('data')
    child.kill()
    processes.delete(id)
  }
}

export function connectSession(
  id: string,
  onData: (data: string) => void,
  onExit: (code: number | null) => void
): boolean {
  const meta = sessions.get(id)
  if (!meta || meta.state === 'connected') return false

  const gen = (generations.get(id) ?? 0) + 1
  generations.set(id, gen)

  const shell = defaultShell()
  const child = spawn(shell, [], {
    cwd: meta.cwd,
    env: buildAgentEnv(process.env, { TERM: 'dumb' }),
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false
  })

  processes.set(id, child)
  sessions.set(id, { ...meta, state: 'connected', exitCode: null })

  child.stdout?.on('data', (chunk: Buffer) => onData(chunk.toString('utf-8')))
  child.stderr?.on('data', (chunk: Buffer) => onData(chunk.toString('utf-8')))

  child.on('exit', (code) => {
    if (generations.get(id) !== gen) return
    processes.delete(id)
    const current = sessions.get(id)
    if (current && current.state === 'connected') {
      sessions.set(id, { ...current, state: 'exited', exitCode: code })
      onExit(code)
    }
  })

  return true
}

export function writeToSession(id: string, data: string): boolean {
  const child = processes.get(id)
  if (!child || !child.stdin?.writable) return false
  child.stdin.write(data)
  return true
}

export function disconnectSession(id: string): boolean {
  const child = processes.get(id)
  const meta = sessions.get(id)
  if (!child || !meta) return false

  const gen = (generations.get(id) ?? 0) + 1
  generations.set(id, gen)

  killProcess(id)
  sessions.set(id, { ...meta, state: 'disconnected' })
  return true
}

export function restartSession(
  id: string,
  onData: (data: string) => void,
  onExit: (code: number | null) => void
): boolean {
  const meta = sessions.get(id)
  if (!meta) return false

  if (meta.state === 'connected') {
    killProcess(id)
  }

  sessions.set(id, { ...meta, state: 'disconnected', exitCode: null })
  return connectSession(id, onData, onExit)
}

export function destroySession(id: string): boolean {
  killProcess(id)
  generations.delete(id)
  return sessions.delete(id)
}

export function destroyAllSessions(): void {
  for (const id of [...sessions.keys()]) {
    destroySession(id)
  }
}

export function clearSessionsForTesting(): void {
  destroyAllSessions()
  nextId = 1
}
