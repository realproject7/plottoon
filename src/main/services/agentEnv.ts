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

export function buildAgentEnv(
  hostEnv: Record<string, string | undefined> = process.env,
  overrides: Record<string, string> = {}
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

  return env
}

export { ALLOWED_KEYS, DENIED_PATTERNS, isDenied }
