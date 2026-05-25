import { spawn, type ChildProcess } from 'node:child_process'
import { buildAgentEnv } from './agentEnv'
import { normalizeWalletAddress } from '../../shared/walletIdentity'
import { buildLaunchCommand, type AgentKind, type LaunchCommand } from './agentRuntime'

/**
 * #274: `resume-failed` is set when a session launched with `mode:
 * 'resume'` exits inside RESUME_QUICK_EXIT_MS — the agent rejected the
 * resume (e.g. Claude can't find a session matching `--resume <uuid>`).
 * The renderer surfaces a fallback prompt offering a fresh launch.
 */
export type SessionState = 'connected' | 'disconnected' | 'exited' | 'resume-failed'

/**
 * #274: how quickly a resumed agent must exit for us to treat it as
 * "resume failed" rather than "exited normally". Claude/Codex usually
 * print an error and exit within ~1 s when the resume target doesn't
 * exist; a real interactive session lasts at least seconds before the
 * user could quit it. 5 s is a comfortable buffer.
 */
export const RESUME_QUICK_EXIT_MS = 5000

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
  /**
   * #272: which AI agent runtime this session spawns. `null` when no
   * runtime was selected at creation time (legacy fallback to shell —
   * preserved so existing tests and one-off recoveries still work).
   * The agent kind drives the launch command + the UI label.
   */
  agentKind: AgentKind | null
  /**
   * #273: opaque per-session id passed through to the agent runtime
   * for persistence + resume. For Claude this is a UUID matching the
   * `--session-id <uuid>` flag from #271 — when a connect mode is
   * `resume`, the same id flows back via `--resume <uuid>`. For
   * Codex it's typically '' because the local CLI doesn't expose a
   * stable session id; we still allocate one so the persistence path
   * can key by it once Codex grows the capability.
   */
  sessionId: string
}

/**
 * #272: minimal PTY surface used by the agent spawner. node-pty exposes
 * a superset; this interface keeps the spawner testable without
 * importing the real binding (which can't compile in some dev /
 * sandbox environments).
 */
export interface PtyHandle {
  onData(handler: (data: string) => void): void
  onExit(handler: (event: { exitCode: number | null }) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

export interface PtySpawnOptions {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  cols?: number
  rows?: number
}

export type PtySpawner = (options: PtySpawnOptions) => PtyHandle

let nextId = 1

const sessions = new Map<string, SessionMeta>()
const handles = new Map<string, PtyHandle | ChildHandle>()
const generations = new Map<string, number>()
// #274: per-generation launch info. Used to attribute a quick exit
// after `mode: 'resume'` to a resume failure rather than a normal
// agent shutdown. Cleared on disconnect / restart / destroy.
const launchInfo = new Map<string, { mode: 'fresh' | 'resume'; connectedAt: number; gen: number }>()

// `ChildHandle` is the degraded-mode fallback we use when node-pty is
// unavailable at runtime (no native build on this platform). It wraps
// the same minimal surface so the caller doesn't need to special-case.
interface ChildHandle extends PtyHandle {
  __kind: 'child'
  process: ChildProcess
}

function normalizeOrNull(address: string | null | undefined): string | null {
  return address ? normalizeWalletAddress(address) : null
}

/**
 * Try to load node-pty at runtime. Returns null when the module isn't
 * installed (CI compile failure on platforms without `make`) or when
 * the binding rejects the current Node/Electron ABI. Callers fall
 * through to the ChildProcess fallback in that case.
 *
 * The dynamic import keeps node-pty an *optional* runtime dep —
 * package.json's `optionalDependencies` block lets `npm install`
 * succeed even when compile fails locally.
 */
let cachedPtyModule: { spawn: (cmd: string, args: string[], opts: unknown) => unknown } | null =
  null
let ptyModuleLoaded = false
async function tryLoadNodePty(): Promise<{
  spawn: (cmd: string, args: string[], opts: unknown) => unknown
} | null> {
  if (ptyModuleLoaded) return cachedPtyModule
  ptyModuleLoaded = true
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await import('node-pty' as string)) as any
    cachedPtyModule = mod && typeof mod.spawn === 'function' ? mod : (mod?.default ?? null)
    return cachedPtyModule
  } catch {
    cachedPtyModule = null
    return null
  }
}

/**
 * Default PTY spawner — uses node-pty when available, otherwise falls
 * back to `child_process.spawn` with piped stdio (no TTY allocation,
 * degraded TUI behaviour but still spawns the agent command).
 */
export async function defaultAgentPtySpawner(options: PtySpawnOptions): Promise<PtyHandle> {
  const ptyModule = await tryLoadNodePty()
  if (ptyModule) {
    // #290: `node-pty` can load successfully but `pty.spawn(...)` may
    // still throw (e.g. `posix_spawnp failed` when the configured agent
    // CLI isn't on PATH, or the platform's pty allocation refuses the
    // request). Catching here lets us fall through to the child_process
    // path instead of crashing the whole session setup — matches the
    // ticket's "degrade predictably" requirement.
    try {
      const pty = ptyModule.spawn(options.command, options.args, {
        name: 'xterm-256color',
        cols: options.cols ?? 80,
        rows: options.rows ?? 24,
        cwd: options.cwd,
        env: options.env
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any
      return {
        onData: (handler) => pty.onData(handler),
        onExit: (handler) => pty.onExit(handler),
        write: (data) => pty.write(data),
        resize: (cols, rows) => pty.resize(cols, rows),
        kill: () => {
          try {
            pty.kill()
          } catch {
            // node-pty throws when killing an already-exited process; safe to ignore.
          }
        }
      }
    } catch {
      // fall through to the child_process fallback
    }
  }
  // Fallback: child_process.spawn with no PTY. Better than nothing —
  // the agent runs in the project cwd with sanitized env; interactive
  // TUI features will be degraded.
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false
  })
  // #290 RE1: attach an `error` listener BEFORE returning the handle
  // so a synchronous-tick `error` emission (e.g. ENOENT when the
  // configured command isn't on PATH) can't bubble up as an unhandled
  // error and crash the app. We buffer the early errors so we can
  // replay them through the caller's onExit handler once it's wired,
  // since Node fires `error` and `exit` at different times depending
  // on platform — and on missing-command ENOENT, sometimes only
  // `error` fires.
  let earlyError: Error | null = null
  child.on('error', (err) => {
    if (earlyError === null) earlyError = err
  })
  const handle: ChildHandle = {
    __kind: 'child',
    process: child,
    onData: (handler) => {
      child.stdout?.on('data', (chunk: Buffer) => handler(chunk.toString('utf-8')))
      child.stderr?.on('data', (chunk: Buffer) => handler(chunk.toString('utf-8')))
    },
    onExit: (handler) => {
      // If an error already fired before the caller hooked onExit
      // (ENOENT is typically delivered on the next tick after spawn),
      // replay it as exit-code-1 so the lifecycle path proceeds.
      if (earlyError !== null) {
        queueMicrotask(() => handler({ exitCode: 1 }))
        return
      }
      child.on('exit', (code) => handler({ exitCode: code }))
      child.on('error', () => {
        // Late error after a successful spawn — synthesise an exit so
        // the caller still gets a signal even if Node skips the
        // `exit` emission on this platform.
        handler({ exitCode: 1 })
      })
    },
    write: (data) => {
      if (child.stdin?.writable) child.stdin.write(data)
    },
    resize: () => {
      // No-op: ChildProcess pipes don't support TTY resize.
    },
    kill: () => {
      child.removeAllListeners('exit')
      child.removeAllListeners('error')
      child.stdout?.removeAllListeners('data')
      child.stderr?.removeAllListeners('data')
      child.kill()
    }
  }
  return handle
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
  for (const meta of sessions.values()) {
    if (meta.state === 'exited') continue
    if (meta.projectId !== projectId) continue
    if (meta.walletAddress === key) return meta
  }
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

export interface CreateSessionInput {
  projectId: string
  cwd: string
  walletAddress: string | null
  /**
   * #272: agent kind for new sessions. When null, no agent is bound
   * (legacy fallback used by tests that pre-date #271). Production
   * wiring resolves this from `detectAgentRuntimes().defaultAgent`.
   */
  agentKind?: AgentKind | null
  /**
   * #273: explicit session id to assign to this session (instead of
   * generating a fresh one). Production callers pass a persisted
   * Claude UUID so reconnect uses `--resume <uuid>`; tests can pass
   * any deterministic value.
   */
  sessionId?: string
}

export function createSession(input: CreateSessionInput): SessionMeta
// Back-compat overload used by tests that pre-date the kind argument.
export function createSession(
  projectId: string,
  cwd: string,
  walletAddress: string | null
): SessionMeta
export function createSession(
  inputOrProjectId: CreateSessionInput | string,
  cwd?: string,
  walletAddress?: string | null
): SessionMeta {
  const input: CreateSessionInput =
    typeof inputOrProjectId === 'string'
      ? {
          projectId: inputOrProjectId,
          cwd: cwd!,
          walletAddress: walletAddress ?? null,
          agentKind: null
        }
      : inputOrProjectId

  const key = normalizeOrNull(input.walletAddress)
  const existing = findSessionByProjectAndWallet(input.projectId, key)
  if (existing && existing.state === 'connected') return existing
  if (existing) return existing

  const id = `term_${nextId++}`
  // #273: allocate a session id at creation time so we can persist
  // it before connect. Claude consumes it via `--session-id <uuid>`;
  // for Codex it's reserved for future deterministic-resume support.
  // Skip generation when the caller provided one (e.g. restoring a
  // persisted Claude UUID), and skip entirely for legacy null-agent
  // sessions because there's no agent to bind it to.
  const sessionId = input.sessionId ?? (input.agentKind ? globalThis.crypto.randomUUID() : '')
  const meta: SessionMeta = {
    id,
    projectId: input.projectId,
    walletAddress: key,
    cwd: input.cwd,
    state: 'disconnected',
    createdAt: new Date().toISOString(),
    exitCode: null,
    agentKind: input.agentKind ?? null,
    sessionId
  }
  sessions.set(id, meta)
  generations.set(id, 0)
  return meta
}

export function getSession(id: string): SessionMeta | null {
  return sessions.get(id) ?? null
}

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

function killHandle(id: string): void {
  const handle = handles.get(id)
  if (handle) {
    try {
      handle.kill()
    } catch {
      // ignore
    }
    handles.delete(id)
  }
}

export interface ConnectSessionDeps {
  /**
   * #272: spawner override for tests. Production callers pass
   * `defaultAgentPtySpawner`.
   */
  spawner?: (options: PtySpawnOptions) => PtyHandle | Promise<PtyHandle>
  /**
   * #276: additional env to forward (e.g. ATLASCLOUD_API_KEY when the
   * user enabled the bridge). Caller computes this via
   * `buildBridgedEnv(config, hostEnv)`; we never read process.env
   * here for secret-looking keys.
   */
  bridgedEnv?: Record<string, string>
  /** Optional initial PTY dimensions. */
  cols?: number
  rows?: number
  /**
   * #273: launch mode. `'fresh'` (default) launches the agent with a
   * `--session-id` flag (Claude) or `-C <cwd>` (Codex). `'resume'`
   * launches with `--resume <sessionId>` (Claude) or the picker
   * (`codex resume` per #271 limitation). The session's `sessionId`
   * is the value passed through to the launch builder; for resume
   * the caller MUST have populated it (either at creation time via
   * `CreateSessionInput.sessionId` or via #273 persistence restore).
   */
  mode?: 'fresh' | 'resume'
}

export async function connectSession(
  id: string,
  onData: (data: string) => void,
  onExit: (code: number | null) => void,
  deps: ConnectSessionDeps = {}
): Promise<boolean> {
  const meta = sessions.get(id)
  if (!meta || meta.state === 'connected') return false

  const gen = (generations.get(id) ?? 0) + 1
  generations.set(id, gen)

  // #272 + #271: prefer the configured agent command. Legacy sessions
  // (no agentKind) fall through to the previous shell launch so old
  // tests + recovery flows still work.
  let launch: LaunchCommand
  if (meta.agentKind) {
    const mode = deps.mode ?? 'fresh'
    launch = buildLaunchCommand({
      kind: meta.agentKind,
      mode,
      projectRoot: meta.cwd,
      sessionId: meta.sessionId || undefined
    })
  } else {
    // Legacy: spawn the user's shell. Preserves the pre-#272 behavior
    // for any consumer that opts out by passing agentKind: null.
    const shellCmd = process.platform === 'win32' ? 'cmd.exe' : process.env.SHELL || '/bin/sh'
    launch = { command: shellCmd, args: [], cwd: meta.cwd }
  }

  const env = buildAgentEnv(
    process.env,
    { TERM: 'xterm-256color' },
    { bridgedEnv: deps.bridgedEnv }
  )

  const spawner = deps.spawner ?? defaultAgentPtySpawner
  let handle: PtyHandle
  try {
    handle = await spawner({
      command: launch.command,
      args: launch.args,
      cwd: launch.cwd,
      env,
      cols: deps.cols,
      rows: deps.rows
    })
  } catch {
    // #290: spawner failures (`posix_spawnp failed`, missing CLI on
    // PATH, PTY allocation refused) must not crash the whole session
    // setup. Roll the generation back so a later connect doesn't see a
    // stale handler, leave the session metadata in `disconnected` so
    // the renderer surfaces the "couldn't connect" lifecycle state,
    // and return false so callers can react. The error is swallowed
    // intentionally — the spawner already has the detail; the
    // renderer only needs to know connect didn't succeed.
    generations.set(id, gen - 1)
    return false
  }
  handles.set(id, handle)
  // #274: record launch info BEFORE setting state to 'connected' so a
  // race-fast exit handler always sees a valid info record.
  const launchMode = meta.agentKind ? (deps.mode ?? 'fresh') : 'fresh'
  launchInfo.set(id, { mode: launchMode, connectedAt: Date.now(), gen })
  sessions.set(id, { ...meta, state: 'connected', exitCode: null })

  handle.onData(onData)
  handle.onExit((event) => {
    if (generations.get(id) !== gen) return
    handles.delete(id)
    const info = launchInfo.get(id)
    launchInfo.delete(id)
    const current = sessions.get(id)
    if (current && current.state === 'connected') {
      // #274: classify a quick exit during resume as 'resume-failed' so
      // the renderer can prompt for a fresh launch instead of leaving
      // the user on a generic "exited" state. The threshold matches
      // RESUME_QUICK_EXIT_MS — long enough to catch CLI-rejected resumes
      // but short enough to avoid mis-attributing a real session that
      // happened to be short.
      const elapsed = info ? Date.now() - info.connectedAt : Infinity
      const isResumeFailed = info?.mode === 'resume' && elapsed < RESUME_QUICK_EXIT_MS
      const newState: SessionState = isResumeFailed ? 'resume-failed' : 'exited'
      sessions.set(id, { ...current, state: newState, exitCode: event.exitCode })
      onExit(event.exitCode)
    }
  })

  return true
}

export function writeToSession(id: string, data: string): boolean {
  const handle = handles.get(id)
  if (!handle) return false
  try {
    handle.write(data)
    return true
  } catch {
    return false
  }
}

export function resizeSession(id: string, cols: number, rows: number): boolean {
  const handle = handles.get(id)
  if (!handle) return false
  try {
    handle.resize(cols, rows)
    return true
  } catch {
    return false
  }
}

export function disconnectSession(id: string): boolean {
  const handle = handles.get(id)
  const meta = sessions.get(id)
  if (!handle || !meta) return false

  const gen = (generations.get(id) ?? 0) + 1
  generations.set(id, gen)

  killHandle(id)
  launchInfo.delete(id)
  sessions.set(id, { ...meta, state: 'disconnected' })
  return true
}

export async function restartSession(
  id: string,
  onData: (data: string) => void,
  onExit: (code: number | null) => void,
  deps: ConnectSessionDeps = {}
): Promise<boolean> {
  const meta = sessions.get(id)
  if (!meta) return false

  if (meta.state === 'connected') killHandle(id)
  sessions.set(id, { ...meta, state: 'disconnected', exitCode: null })
  return connectSession(id, onData, onExit, deps)
}

/**
 * #273: restore a previously-persisted session into in-memory state.
 * Used by IPC handlers on app startup when a persisted record exists
 * for the (wallet, project) pair. Caller is responsible for reading
 * the record via `loadPersistedSession(...)`.
 */
export function adoptPersistedSession(input: {
  projectId: string
  cwd: string
  walletAddress: string | null
  agentKind: AgentKind
  sessionId: string
  createdAt: string
  /**
   * #291: optional restored state. Pre-#291 every adopted session
   * came back as `disconnected`, which let a previously resume-failed
   * record auto-connect → resume → fail → loop. Callers (the IPC
   * `terminal:create` handler) now pass `lastState` through so a
   * persisted `resume-failed` carries into the in-memory meta and the
   * renderer's auto-connect path skips it. Defaults to `disconnected`
   * for back-compat.
   */
  lastState?: SessionState
}): SessionMeta {
  const key = normalizeOrNull(input.walletAddress)
  const id = `term_${nextId++}`
  // Only certain restored states make sense in memory: `connected` is
  // not adoptable because the live PTY is gone after a restart, so
  // collapse to `disconnected` for that case. `resume-failed` and
  // `exited` are restored as-is so the renderer surfaces the recovery
  // affordance.
  const adoptedState: SessionState =
    input.lastState === 'resume-failed' || input.lastState === 'exited'
      ? input.lastState
      : 'disconnected'
  const meta: SessionMeta = {
    id,
    projectId: input.projectId,
    walletAddress: key,
    cwd: input.cwd,
    state: adoptedState,
    createdAt: input.createdAt,
    exitCode: null,
    agentKind: input.agentKind,
    sessionId: input.sessionId
  }
  sessions.set(id, meta)
  generations.set(id, 0)
  return meta
}

export function destroySession(id: string): boolean {
  killHandle(id)
  generations.delete(id)
  launchInfo.delete(id)
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
  cachedPtyModule = null
  ptyModuleLoaded = false
  launchInfo.clear()
}
