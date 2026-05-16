import { describe, it, expect } from 'vitest'
import { buildAgentEnv, ALLOWED_KEYS, isDenied } from '../services/agentEnv'

const fakeHost: Record<string, string> = {
  HOME: '/home/testuser',
  USER: 'testuser',
  PATH: '/usr/bin:/bin',
  SHELL: '/bin/zsh',
  LANG: 'en_US.UTF-8',
  TERM: 'xterm-256color',
  TMPDIR: '/tmp',
  EDITOR: 'vim',
  ANTHROPIC_API_KEY: 'sk-ant-fake',
  OPENAI_API_KEY: 'sk-fake',
  AWS_SECRET_ACCESS_KEY: 'wJalr-fake',
  GITHUB_TOKEN: 'ghp_fake',
  GH_TOKEN: 'ghp_fake2',
  NPM_TOKEN: 'npm_fake',
  PRIVATE_KEY_PATH: '/keys/id_rsa',
  WALLET_SEED: 'abandon abandon abandon',
  MNEMONIC: 'abandon abandon abandon',
  SEED_PHRASE_BACKUP: 'abandon abandon abandon',
  MY_CUSTOM_SECRET: 'secret123',
  DATABASE_PASSWORD: 'dbpass',
  AZURE_CLIENT_SECRET: 'azure-fake',
  GOOGLE_APPLICATION_CREDENTIALS: '/path/creds.json',
  NODE_AUTH_TOKEN: 'node-fake',
  GCP_PROJECT: 'my-project',
  SOME_CREDENTIAL_FILE: '/path/cred'
}

describe('buildAgentEnv', () => {
  it('includes allowed keys from host env', () => {
    const env = buildAgentEnv(fakeHost)
    expect(env.HOME).toBe('/home/testuser')
    expect(env.USER).toBe('testuser')
    expect(env.PATH).toBe('/usr/bin:/bin')
    expect(env.SHELL).toBe('/bin/zsh')
    expect(env.LANG).toBe('en_US.UTF-8')
    expect(env.TMPDIR).toBe('/tmp')
    expect(env.EDITOR).toBe('vim')
  })

  it('blocks secret patterns from host env', () => {
    const env = buildAgentEnv(fakeHost)
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
    expect(env.GITHUB_TOKEN).toBeUndefined()
    expect(env.GH_TOKEN).toBeUndefined()
    expect(env.NPM_TOKEN).toBeUndefined()
    expect(env.PRIVATE_KEY_PATH).toBeUndefined()
    expect(env.WALLET_SEED).toBeUndefined()
    expect(env.MNEMONIC).toBeUndefined()
    expect(env.SEED_PHRASE_BACKUP).toBeUndefined()
    expect(env.MY_CUSTOM_SECRET).toBeUndefined()
    expect(env.DATABASE_PASSWORD).toBeUndefined()
    expect(env.AZURE_CLIENT_SECRET).toBeUndefined()
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined()
    expect(env.NODE_AUTH_TOKEN).toBeUndefined()
    expect(env.GCP_PROJECT).toBeUndefined()
    expect(env.SOME_CREDENTIAL_FILE).toBeUndefined()
  })

  it('applies overrides that are not denied', () => {
    const env = buildAgentEnv(fakeHost, { TERM: 'dumb', MY_VAR: 'hello' })
    expect(env.TERM).toBe('dumb')
    expect(env.MY_VAR).toBe('hello')
  })

  it('blocks denied overrides', () => {
    const env = buildAgentEnv(fakeHost, {
      ANTHROPIC_API_KEY: 'injected',
      WALLET_SEED: 'injected'
    })
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.WALLET_SEED).toBeUndefined()
  })

  it('returns empty values for missing allowed keys', () => {
    const env = buildAgentEnv({})
    expect(env.HOME).toBeUndefined()
    expect(Object.keys(env)).toHaveLength(0)
  })

  it('does not leak non-allowed, non-denied keys', () => {
    const env = buildAgentEnv({ ...fakeHost, RANDOM_THING: 'leak' })
    expect(env.RANDOM_THING).toBeUndefined()
  })
})

describe('isDenied', () => {
  const deniedNames = [
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AZURE_CLIENT_SECRET',
    'GCP_PROJECT',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'GITHUB_TOKEN',
    'GH_TOKEN',
    'NPM_TOKEN',
    'NODE_AUTH_TOKEN',
    'PRIVATE_KEY_PATH',
    'WALLET_MNEMONIC',
    'MNEMONIC',
    'SEED_PHRASE_BACKUP',
    'DATABASE_PASSWORD',
    'MY_CUSTOM_SECRET',
    'SOME_CREDENTIAL_FILE'
  ]

  for (const name of deniedNames) {
    it(`denies ${name}`, () => {
      expect(isDenied(name)).toBe(true)
    })
  }

  const safeName = ['HOME', 'PATH', 'SHELL', 'LANG', 'TMPDIR', 'EDITOR']

  for (const name of safeName) {
    it(`allows ${name}`, () => {
      expect(isDenied(name)).toBe(false)
    })
  }
})

describe('ALLOWED_KEYS', () => {
  it('contains PATH and HOME for CLI discovery', () => {
    expect(ALLOWED_KEYS.has('PATH')).toBe(true)
    expect(ALLOWED_KEYS.has('HOME')).toBe(true)
  })

  it('does not contain any secret-like keys', () => {
    for (const key of ALLOWED_KEYS) {
      expect(isDenied(key)).toBe(false)
    }
  })
})
