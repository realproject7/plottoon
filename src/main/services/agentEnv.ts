const ALLOWED_KEYS = new Set([
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'PATH',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'TMPDIR',
  'XDG_RUNTIME_DIR',
  'XDG_DATA_HOME',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'EDITOR',
  'VISUAL',
  'HOSTNAME',
  'DISPLAY',
  'COLORTERM',
  'TERM_PROGRAM'
])

const DENIED_PATTERNS = [
  /_KEY$/,
  /_TOKEN$/,
  /_SECRET$/,
  /_PASSWORD$/,
  /_CREDENTIAL/,
  /_API_KEY$/,
  /^AWS_/,
  /^AZURE_/,
  /^GCP_/,
  /^GOOGLE_APPLICATION_/,
  /^ANTHROPIC_/,
  /^OPENAI_/,
  /^GITHUB_TOKEN$/,
  /^GH_TOKEN$/,
  /^NPM_TOKEN$/,
  /^NODE_AUTH_TOKEN$/,
  /^PRIVATE_KEY/,
  /^WALLET_/,
  /^MNEMONIC/,
  /^SEED_PHRASE/
]

function isDenied(key: string): boolean {
  return DENIED_PATTERNS.some((pattern) => pattern.test(key))
}

export interface BuildAgentEnvOptions {
  /**
   * #276: opt-in env keys that bypass the default deny list. The
   * caller (typically the env-bridge service) constructs this map
   * from a persisted per-backend toggle + the host env. Values are
   * NOT inspected here — the bridge module is the only path that
   * decides which keys are eligible (`BRIDGEABLE_ENV_KEYS`). Anything
   * else still goes through the standard ALLOWED / denied filter.
   */
  bridgedEnv?: Record<string, string>
}

export function buildAgentEnv(
  hostEnv: Record<string, string | undefined> = process.env,
  overrides: Record<string, string> = {},
  options: BuildAgentEnvOptions = {}
): Record<string, string> {
  const env: Record<string, string> = {}

  for (const key of ALLOWED_KEYS) {
    const value = hostEnv[key]
    if (value !== undefined) {
      env[key] = value
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (!isDenied(key) && value !== undefined) {
      env[key] = value
    }
  }

  // #276: bridged keys land last so an explicit opt-in user override
  // wins over the default deny. The bridge module already validated
  // that these keys are eligible + present; we trust its output here.
  if (options.bridgedEnv) {
    for (const [key, value] of Object.entries(options.bridgedEnv)) {
      if (typeof value === 'string' && value.length > 0) {
        env[key] = value
      }
    }
  }

  return env
}

export { ALLOWED_KEYS, DENIED_PATTERNS, isDenied }
