/**
 * Agent runtime config + launch command builder (#271).
 *
 * Decides which AI coding agent to run in the project terminal (Claude
 * or Codex) and constructs the shell-safe launch command for fresh /
 * resume modes. Command construction is intentionally separated from
 * process spawning so it can be unit-tested without launching real
 * CLIs and so a future PTY-backed terminal (#272) can reuse the same
 * descriptors.
 *
 * Sensitive env handling is delegated to `agentEnv.ts` — this module
 * never touches `process.env` itself and returns only the literal
 * argv + cwd that a spawner needs. Callers are responsible for
 * passing the descriptor's `cwd` + a sanitized env (typically
 * `buildAgentEnv()`) when they actually spawn the process.
 */

import { detectClis, type CliStatus, type CapabilityReport } from './cliDetection'

export type AgentKind = 'claude' | 'codex'

export interface AgentRuntimeStatus {
  kind: AgentKind
  /** Display name surfaced in capability reports + UI. */
  displayName: string
  /** Executable name resolved on `$PATH`. */
  command: string
  installed: boolean
  version: string | null
}

export interface AgentRuntimeReport {
  detectedAt: string
  runtimes: AgentRuntimeStatus[]
  /**
   * Kind the renderer should pick when starting a fresh session
   * unless the user has expressed a preference. `null` when no
   * installed agent is available.
   */
  defaultAgent: AgentKind | null
}

/**
 * Order matters: when both CLIs are installed, the first kind in this
 * list wins as the default. Claude is preferred over Codex because the
 * project's prior CLI detection order has the same precedence and the
 * existing #156 / #220 multi-wallet flows assume Claude as the
 * canonical agent CLI.
 */
const RUNTIME_DEFS: ReadonlyArray<Pick<AgentRuntimeStatus, 'kind' | 'displayName' | 'command'>> = [
  { kind: 'claude', displayName: 'Claude CLI', command: 'claude' },
  { kind: 'codex', displayName: 'Codex CLI', command: 'codex' }
]

function statusForCli(
  cli: CliStatus | undefined,
  def: { kind: AgentKind; displayName: string; command: string }
): AgentRuntimeStatus {
  return {
    kind: def.kind,
    displayName: def.displayName,
    command: def.command,
    installed: cli?.installed ?? false,
    version: cli?.version ?? null
  }
}

export async function detectAgentRuntimes(
  cliReport?: CapabilityReport
): Promise<AgentRuntimeReport> {
  const report = cliReport ?? (await detectClis())
  const runtimes = RUNTIME_DEFS.map((def) =>
    statusForCli(
      report.clis.find((c) => c.command === def.command),
      def
    )
  )
  const installed = runtimes.find((r) => r.installed)
  return {
    detectedAt: report.detectedAt,
    runtimes,
    defaultAgent: installed?.kind ?? null
  }
}

/**
 * Pure helper exposed for tests + callers that need to derive the
 * default from an existing report without re-running detection.
 */
export function selectDefaultAgent(report: AgentRuntimeReport): AgentKind | null {
  return report.defaultAgent
}

export type LaunchMode = 'fresh' | 'resume'

export interface BuildLaunchCommandInput {
  kind: AgentKind
  mode: LaunchMode
  projectRoot: string
  /**
   * Required when `mode === 'resume'`. For Claude this is the
   * `--session-id` value the prior session was launched with (also
   * accepted by `--resume <value>`). For Codex this is the
   * Codex-side session id; see `codexResumeLimitations` below.
   */
  sessionId?: string
}

export interface LaunchCommand {
  /** Executable name; not a shell command — no quoting needed. */
  command: string
  /** Argv tail. Each entry is a literal arg; the caller should not re-quote. */
  args: string[]
  /** Working directory the process should be spawned in. */
  cwd: string
}

export class AgentLaunchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentLaunchError'
  }
}

/**
 * Documented limitation on Codex resume: the local Codex CLI accepts
 * `codex resume` as an interactive subcommand but does not surface a
 * stable per-session id in the same way Claude does. Until that lands
 * upstream, PlotToon's Codex resume launches the picker (`codex
 * resume`) rather than a deterministic session, and the caller (the
 * Terminal UI ticket #274) is expected to surface that as a UX
 * difference. The builder still returns a `LaunchCommand` for
 * `codex resume` so the caller doesn't have to special-case it.
 */
export const codexResumeLimitations = {
  deterministicResume: false,
  reason:
    'Local Codex CLI exposes only an interactive `codex resume` picker; no stable session-id resume path is supported at this time. PlotToon launches the picker.'
} as const

/**
 * #297: shell-safe single-quote escape. We wrap each agent invocation
 * in `'...'` inside a `shell -l -c '...'` so the user's login shell
 * loads `.bashrc` / `.zshrc` (which is where most contributors
 * actually have `claude` / `codex` on PATH). plotlink-ows uses the
 * same wrapper. The escape rule for POSIX single quotes is:
 * close quote, insert `'\''`, reopen quote.
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

/**
 * #297: default user shell. plotlink-ows defaults to `/bin/zsh` when
 * `process.env.SHELL` is unset; we follow the same convention so a
 * fresh install behaves identically across the two clients. On
 * Windows we fall back to `cmd.exe` since `bash -l -c` doesn't apply.
 */
function defaultUserShell(): string {
  if (process.platform === 'win32') return 'cmd.exe'
  return process.env.SHELL || '/bin/zsh'
}

export function buildLaunchCommand(input: BuildLaunchCommandInput): LaunchCommand {
  if (!input.projectRoot || typeof input.projectRoot !== 'string') {
    throw new AgentLaunchError('projectRoot is required to build an agent launch command')
  }
  if (input.mode === 'resume' && !input.sessionId) {
    throw new AgentLaunchError('sessionId is required for resume mode')
  }

  // #297: build the inner agent invocation, then wrap it in
  // `<shell> -l -c '<inner>'` so the login shell loads the user's
  // rc files. Without this wrapper, Claude often can't find tools
  // its plugins depend on (PATH set in `.zshrc` etc.) and it's the
  // proximate cause of the `--print`/`-p` stdin error the agent
  // exits with when it sees a non-interactive descriptor.
  const inner = buildInnerAgentCommand(input)
  return {
    command: defaultUserShell(),
    args: ['-l', '-c', inner],
    cwd: input.projectRoot
  }
}

/**
 * #297 helper: returns the bare agent invocation (without the
 * surrounding shell wrapper). Useful for tests that want to verify
 * the agent flags without re-parsing through the shell.
 */
export function buildInnerAgentCommand(input: BuildLaunchCommandInput): string {
  if (input.kind === 'claude') {
    if (input.mode === 'fresh') {
      // Claude CLI accepts `--session-id <uuid>` so the host can
      // record the id before the session starts. Missing id ⇒ let
      // the CLI mint its own.
      if (input.sessionId) {
        return `claude --session-id ${shellQuote(input.sessionId)}`
      }
      return 'claude'
    }
    // resume mode
    return `claude --resume ${shellQuote(input.sessionId!)}`
  }

  // input.kind === 'codex'
  if (input.mode === 'fresh') {
    return `codex -C ${shellQuote(input.projectRoot)}`
  }
  // resume — interactive picker (see codexResumeLimitations).
  return 'codex resume'
}
