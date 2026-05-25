/**
 * Persisted agent-session metadata (#273).
 *
 * Mirrors the plotlink-ows `terminal-sessions.json` pattern: a single
 * JSON file under `<userData>/config/` keyed by
 * `<normalizedWalletAddress>:<projectId>` (wallet-first so the
 * #221/#222 multi-wallet scoping carries straight through).
 *
 * What's persisted: ONLY the metadata the renderer needs to know
 * which agent to relaunch and how to resume it (Claude `--session-id`
 * pinning, Codex's picker limitation). Wallet addresses are normalized;
 * cwd is the project root (already non-secret); no env, no secrets,
 * no OWS internal names.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { resolveAppConfigPath } from './safePaths'
import { normalizeWalletAddress } from '../../shared/walletIdentity'

export type AgentKind = 'claude' | 'codex'

export interface PersistedSession {
  /** Per (wallet, project) key. */
  walletAddress: string
  projectId: string
  agentKind: AgentKind
  /** Project root used as cwd. */
  cwd: string
  /**
   * For Claude: the UUID we passed via `--session-id`. Resume launches
   * with `--resume <sessionId>` per the helper from #271. For Codex:
   * empty string — the CLI doesn't expose a stable id today, so resume
   * falls back to the picker (`codex resume`). The string is kept so
   * future Codex versions can adopt deterministic resume without a
   * persistence migration.
   */
  sessionId: string
  /** ISO timestamps. */
  createdAt: string
  lastConnectedAt: string | null
  /**
   * Snapshot of last known UI state. Restored when the renderer
   * remounts; not authoritative — the live PTY state in
   * `terminalSession.ts` wins once connected.
   */
  lastState: 'connected' | 'disconnected' | 'exited'
  /**
   * Per #271 `codexResumeLimitations`. Renderer can surface a warning
   * when Codex resume isn't deterministic.
   */
  resumeSupported: boolean
}

interface StoreFile {
  version: 1
  /** Map keyed by `${normalizedWalletAddress}:${projectId}`. */
  sessions: Record<string, PersistedSession>
}

const STORE_FILENAME = 'terminal-sessions.json'

function resolveStorePath(): string {
  return resolveAppConfigPath(STORE_FILENAME)
}

export function buildSessionKey(walletAddress: string, projectId: string): string {
  return `${normalizeWalletAddress(walletAddress)}:${projectId}`
}

function emptyStoreFile(): StoreFile {
  // ALWAYS return a fresh object — callers (upsert) mutate `sessions`,
  // and returning a shared instance would accumulate records across
  // calls (and worse, across test isolation boundaries).
  return { version: 1, sessions: {} }
}

async function readStoreFile(): Promise<StoreFile> {
  try {
    const storePath = resolveStorePath()
    const raw = await fs.readFile(storePath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<StoreFile>
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) return emptyStoreFile()
    const sessions: Record<string, PersistedSession> = {}
    for (const [key, candidate] of Object.entries(parsed.sessions ?? {})) {
      const sanitized = sanitize(candidate as unknown)
      if (sanitized) sessions[key] = sanitized
    }
    return { version: 1, sessions }
  } catch {
    return emptyStoreFile()
  }
}

async function writeStoreFile(file: StoreFile): Promise<void> {
  const storePath = resolveStorePath()
  await fs.mkdir(path.dirname(storePath), { recursive: true })
  await fs.writeFile(storePath, JSON.stringify(file, null, 2), 'utf-8')
}

/**
 * Strict shape sanitizer — drops any unknown / unexpected fields from
 * the persisted record. Forces wallet address to its normalized form
 * so a hand-edit can't slip in a checksummed variant that would skip
 * the (wallet, project) lookup.
 */
function sanitize(value: unknown): PersistedSession | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.walletAddress !== 'string' || v.walletAddress.length === 0) return null
  if (typeof v.projectId !== 'string' || v.projectId.length === 0) return null
  if (v.agentKind !== 'claude' && v.agentKind !== 'codex') return null
  if (typeof v.cwd !== 'string') return null
  if (typeof v.sessionId !== 'string') return null
  if (typeof v.createdAt !== 'string') return null
  const lastConnectedAt =
    typeof v.lastConnectedAt === 'string' || v.lastConnectedAt === null ? v.lastConnectedAt : null
  const lastState =
    v.lastState === 'connected' || v.lastState === 'disconnected' || v.lastState === 'exited'
      ? v.lastState
      : 'disconnected'
  const resumeSupported = v.resumeSupported === true
  return {
    walletAddress: normalizeWalletAddress(v.walletAddress as string),
    projectId: v.projectId as string,
    agentKind: v.agentKind as AgentKind,
    cwd: v.cwd as string,
    sessionId: v.sessionId as string,
    createdAt: v.createdAt as string,
    lastConnectedAt: lastConnectedAt as string | null,
    lastState: lastState as PersistedSession['lastState'],
    resumeSupported
  }
}

export async function loadPersistedSessions(): Promise<Record<string, PersistedSession>> {
  return (await readStoreFile()).sessions
}

export async function loadPersistedSession(
  walletAddress: string,
  projectId: string
): Promise<PersistedSession | null> {
  const map = await loadPersistedSessions()
  return map[buildSessionKey(walletAddress, projectId)] ?? null
}

export async function upsertPersistedSession(input: PersistedSession): Promise<void> {
  const file = await readStoreFile()
  const sanitized = sanitize(input)
  if (!sanitized) return
  const key = buildSessionKey(sanitized.walletAddress, sanitized.projectId)
  file.sessions[key] = sanitized
  await writeStoreFile(file)
}

export async function removePersistedSession(
  walletAddress: string,
  projectId: string
): Promise<void> {
  const file = await readStoreFile()
  const key = buildSessionKey(walletAddress, projectId)
  if (file.sessions[key]) {
    delete file.sessions[key]
    await writeStoreFile(file)
  }
}

/**
 * Convenience: list persisted sessions for a single wallet. Used by
 * the workspace startup path to restore the right session for a
 * given (wallet, projectId) pair without exposing other wallets'
 * keys.
 */
export async function listPersistedSessionsForWallet(
  walletAddress: string
): Promise<PersistedSession[]> {
  const normalized = normalizeWalletAddress(walletAddress)
  const map = await loadPersistedSessions()
  return Object.values(map).filter((s) => s.walletAddress === normalized)
}
