import { describe, it, expect } from 'vitest'
import { buildAgentEnv, isDenied } from '../services/agentEnv'

const WALLET_SECRETS: Record<string, string> = {
  WALLET_PRIVATE_KEY: '0xdeadbeef',
  WALLET_MNEMONIC:
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  WALLET_SEED: 'seed-value',
  MNEMONIC: 'test mnemonic phrase',
  SEED_PHRASE_BACKUP: 'seed phrase backup',
  PRIVATE_KEY_HEX: '0xabc123',
  PLOTLINK_SIGNING_KEY: 'signing-secret',
  PLOTLINK_API_TOKEN: 'token-value'
}

describe('wallet signing boundary — terminal env sanitization', () => {
  it('wallet secret patterns are denied by isDenied', () => {
    for (const key of Object.keys(WALLET_SECRETS)) {
      expect(isDenied(key)).toBe(true)
    }
  })

  it('buildAgentEnv strips all wallet secrets from host env', () => {
    const hostEnv = {
      HOME: '/home/user',
      PATH: '/usr/bin',
      SHELL: '/bin/zsh',
      ...WALLET_SECRETS
    }

    const env = buildAgentEnv(hostEnv)

    for (const key of Object.keys(WALLET_SECRETS)) {
      expect(env[key]).toBeUndefined()
    }
    expect(env.HOME).toBe('/home/user')
    expect(env.PATH).toBe('/usr/bin')
  })

  it('buildAgentEnv rejects wallet secrets injected as overrides', () => {
    const env = buildAgentEnv({ HOME: '/home/user' }, WALLET_SECRETS)

    for (const key of Object.keys(WALLET_SECRETS)) {
      expect(env[key]).toBeUndefined()
    }
  })

  it('env values do not contain wallet secret values even as substrings', () => {
    const hostEnv = {
      HOME: '/home/user',
      PATH: '/usr/bin',
      ...WALLET_SECRETS
    }
    const env = buildAgentEnv(hostEnv)

    const allValues = Object.values(env).join(' ')
    for (const secretValue of Object.values(WALLET_SECRETS)) {
      expect(allValues).not.toContain(secretValue)
    }
  })
})

describe('wallet signing boundary — renderer isolation', () => {
  it('renderer preload does not expose signing material types', async () => {
    // Structural test: the preload index should not import wallet signing
    const preloadSource = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../../preload/index.ts', import.meta.url).pathname, 'utf-8')
    )

    expect(preloadSource).not.toContain('walletSigning')
    expect(preloadSource).not.toContain('privateKey')
    expect(preloadSource).not.toContain('mnemonic')
    expect(preloadSource).not.toContain('signMessage')
  })
})
