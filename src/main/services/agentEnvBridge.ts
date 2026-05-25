/**
 * Safe opt-in env bridge for agent-managed image backends (#276).
 *
 * PlotToon's default `buildAgentEnv` sanitizer denies anything matching
 * `_API_KEY`, including the AtlasCloud key that image-backend agents
 * (Claude / Codex via #271) may need to call AtlasCloud-style providers.
 *
 * Per #276 the bridge is **explicit, user-controlled, and never
 * app-owned**: a per-key toggle persisted in `<userData>/config/
 * agent-env-bridge.json`. When the toggle is on AND the user has the
 * matching env var set in their shell, the bridge re-allows that single
 * key for the agent process. The value itself is never serialized to
 * any renderer-facing payload, log, action log, or project file —
 * callers only see configured / missing / enabled / disabled state.
 *
 * MVP allowlist is `ATLASCLOUD_API_KEY` only. Future backends can be
 * added by extending `BRIDGEABLE_ENV_KEYS` + `EnvBridgeConfig`.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { resolveAppConfigPath } from './safePaths'

export interface EnvBridgeConfig {
  /** When true, ATLASCLOUD_API_KEY is forwarded to agent processes
   *  iff it's present in the host env. Defaults to false. */
  atlascloud: boolean
}

export const DEFAULT_ENV_BRIDGE_CONFIG: EnvBridgeConfig = {
  atlascloud: false
}

/**
 * Env keys the bridge can forward when their per-backend toggle is on.
 * MVP: AtlasCloud only. Adding a new image backend means:
 *   1) Add an entry here
 *   2) Add a boolean to `EnvBridgeConfig`
 *   3) Wire a renderer status row
 *   4) Pin the new flow with a non-leakage regression test
 */
export const BRIDGEABLE_ENV_KEYS: ReadonlyArray<{
  bridgeKey: keyof EnvBridgeConfig
  envName: string
}> = [{ bridgeKey: 'atlascloud', envName: 'ATLASCLOUD_API_KEY' }]

const CONFIG_FILENAME = 'agent-env-bridge.json'

function resolveConfigPath(): string {
  return resolveAppConfigPath(CONFIG_FILENAME)
}

export async function readEnvBridgeConfig(): Promise<EnvBridgeConfig> {
  try {
    const raw = await fs.readFile(resolveConfigPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<EnvBridgeConfig>
    // Sanitize: only known keys, coerced to booleans, never accept
    // stray secret-looking fields a malicious actor might have written
    // into the file directly.
    return {
      atlascloud: parsed.atlascloud === true
    }
  } catch {
    return DEFAULT_ENV_BRIDGE_CONFIG
  }
}

export async function writeEnvBridgeConfig(config: EnvBridgeConfig): Promise<void> {
  const configPath = resolveConfigPath()
  await fs.mkdir(path.dirname(configPath), { recursive: true })
  // Re-serialize from a known shape so we don't accidentally write
  // additional keys (defense in depth against future code paths that
  // might try to stuff non-boolean values into the config).
  const sanitized: EnvBridgeConfig = {
    atlascloud: config.atlascloud === true
  }
  await fs.writeFile(configPath, JSON.stringify(sanitized, null, 2), 'utf-8')
}

/**
 * State the renderer sees for each bridge-able env key. Strictly
 * non-secret: `configured` is whether the user has the env var set at
 * all; `enabled` is whether the per-backend toggle is on. The key's
 * value never crosses this boundary.
 */
export interface EnvBridgeStatusEntry {
  envName: string
  bridgeKey: keyof EnvBridgeConfig
  enabled: boolean
  configured: boolean
}

export interface EnvBridgeStatus {
  entries: EnvBridgeStatusEntry[]
}

export function getEnvBridgeStatus(
  config: EnvBridgeConfig,
  hostEnv: Record<string, string | undefined> = process.env
): EnvBridgeStatus {
  return {
    entries: BRIDGEABLE_ENV_KEYS.map(({ bridgeKey, envName }) => ({
      envName,
      bridgeKey,
      enabled: config[bridgeKey] === true,
      // `configured` is a boolean only — we never carry the actual
      // value or its length / prefix / anything that could leak.
      configured: typeof hostEnv[envName] === 'string' && hostEnv[envName] !== ''
    }))
  }
}

/**
 * Returns the subset of env vars the bridge should add on top of
 * `buildAgentEnv()`'s default sanitized set. Only keys that are BOTH
 * enabled in `config` AND present in `hostEnv` are included.
 *
 * The returned map carries the actual key value so the spawner can
 * pass it to the agent subprocess. Callers MUST NOT serialize this
 * map to anything renderer-facing, persist it, or log it.
 */
export function buildBridgedEnv(
  config: EnvBridgeConfig,
  hostEnv: Record<string, string | undefined> = process.env
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const { bridgeKey, envName } of BRIDGEABLE_ENV_KEYS) {
    if (config[bridgeKey] !== true) continue
    const value = hostEnv[envName]
    if (typeof value === 'string' && value.length > 0) {
      out[envName] = value
    }
  }
  return out
}
