// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  validateContentRating,
  defaultContentRating,
  contentRatingToMatureFlag
} from '../contentRating'
import { checkContentRating, validatePublishReadiness } from '../publishReadiness'
import {
  createConfirmationState,
  buildPublishPreview,
  confirmPublish,
  canPublishWithConfirmation,
  isConfirmationValid,
  invalidateOnChange
} from '../publishConfirmation'
import type { ExportMeta } from '../exportMetadata'
import { buildAgentEnv, isDenied, ALLOWED_KEYS } from '../../main/services/agentEnv'

function makeExportMeta(cutId: string, hash?: string): ExportMeta {
  return {
    cutId,
    exportedAt: '2026-05-19T12:00:00.000Z',
    width: 320,
    height: 480,
    mimeType: 'image/webp',
    byteSize: 500_000,
    hash: hash ?? `hash-${cutId}`,
    fonts: ['sans-serif'],
    path: `exports/${cutId}.webp`
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-05-19T12:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Security, privacy, and content gates (issue #56)', () => {
  describe('Content gate: mature/adult confirmation', () => {
    it('validateContentRating accepts valid ratings', () => {
      expect(validateContentRating('all-ages')).toBe('all-ages')
      expect(validateContentRating('teen')).toBe('teen')
      expect(validateContentRating('mature')).toBe('mature')
    })

    it('validateContentRating rejects invalid values', () => {
      expect(validateContentRating('adult')).toBeNull()
      expect(validateContentRating('')).toBeNull()
      expect(validateContentRating(undefined)).toBeNull()
      expect(validateContentRating(null)).toBeNull()
      expect(validateContentRating(42)).toBeNull()
    })

    it('default content rating is safe (all-ages)', () => {
      expect(defaultContentRating()).toBe('all-ages')
    })

    it('matureFlag only set for mature rating', () => {
      expect(contentRatingToMatureFlag('all-ages')).toBe(false)
      expect(contentRatingToMatureFlag('teen')).toBe(false)
      expect(contentRatingToMatureFlag('mature')).toBe(true)
    })

    it('checkContentRating blocks when rating is missing', () => {
      const check = checkContentRating(undefined)
      expect(check.level).toBe('block')
      expect(check.message).toContain('required')
    })

    it('checkContentRating passes when rating is valid', () => {
      const check = checkContentRating('all-ages')
      expect(check.level).toBe('pass')
    })

    it('publish readiness blocks without content rating', () => {
      const cuts = [{ id: 'cut-001', status: 'approved' }]
      const metas = [makeExportMeta('cut-001')]
      const report = validatePublishReadiness(cuts, metas, { contentRating: undefined })
      const ratingCheck = report.checks.find((c) => c.id === 'content-rating')
      expect(ratingCheck).toBeDefined()
      expect(ratingCheck!.level).toBe('block')
    })
  })

  describe('Terminal receives no private key material', () => {
    const DANGEROUS_ENV_KEYS = [
      'WALLET_PRIVATE_KEY',
      'WALLET_MNEMONIC',
      'WALLET_SEED',
      'MNEMONIC',
      'SEED_PHRASE_BACKUP',
      'PRIVATE_KEY_HEX',
      'PLOTLINK_SIGNING_KEY',
      'PLOTLINK_API_TOKEN',
      'AWS_SECRET_ACCESS_KEY',
      'AZURE_CLIENT_SECRET',
      'GCP_CREDENTIALS',
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
      'GITHUB_TOKEN',
      'GH_TOKEN',
      'NPM_TOKEN',
      'NODE_AUTH_TOKEN'
    ]

    it('isDenied blocks all dangerous env keys', () => {
      for (const key of DANGEROUS_ENV_KEYS) {
        expect(isDenied(key), `Expected ${key} to be denied`).toBe(true)
      }
    })

    it('ALLOWED_KEYS contains only safe system variables', () => {
      for (const key of ALLOWED_KEYS) {
        expect(isDenied(key), `ALLOWED key ${key} should not be denied`).toBe(false)
        expect(key).not.toMatch(/key|token|secret|password|credential|mnemonic|seed/i)
      }
    })

    it('buildAgentEnv excludes all secret keys from host environment', () => {
      const hostEnv: Record<string, string> = {
        HOME: '/home/user',
        PATH: '/usr/bin',
        SHELL: '/bin/zsh'
      }
      for (const key of DANGEROUS_ENV_KEYS) {
        hostEnv[key] = `secret-value-${key}`
      }

      const env = buildAgentEnv(hostEnv)

      for (const key of DANGEROUS_ENV_KEYS) {
        expect(env[key], `Expected ${key} to be absent`).toBeUndefined()
      }
      expect(env.HOME).toBe('/home/user')
      expect(env.PATH).toBe('/usr/bin')
    })

    it('buildAgentEnv rejects secrets injected as overrides', () => {
      const overrides: Record<string, string> = {}
      for (const key of DANGEROUS_ENV_KEYS) {
        overrides[key] = `injected-${key}`
      }

      const env = buildAgentEnv({ HOME: '/home/user' }, overrides)

      for (const key of DANGEROUS_ENV_KEYS) {
        expect(env[key]).toBeUndefined()
      }
    })

    it('secret values do not leak as substrings of allowed values', () => {
      const secretValues = DANGEROUS_ENV_KEYS.map((k) => `secret-${k}`)
      const hostEnv: Record<string, string> = { HOME: '/home/user', PATH: '/usr/bin' }
      for (let i = 0; i < DANGEROUS_ENV_KEYS.length; i++) {
        hostEnv[DANGEROUS_ENV_KEYS[i]] = secretValues[i]
      }

      const env = buildAgentEnv(hostEnv)
      const allValues = Object.values(env).join(' ')

      for (const secret of secretValues) {
        expect(allValues).not.toContain(secret)
      }
    })
  })

  describe('Publish requires explicit confirmation before signing', () => {
    it('createConfirmationState starts unconfirmed', () => {
      const state = createConfirmationState(false)
      expect(state.confirmed).toBe(false)
      expect(state.confirmedAt).toBeNull()
      expect(state.payloadHash).toBeNull()
    })

    it('dry-run mode bypasses confirmation requirement', async () => {
      const state = createConfirmationState(true)
      const metas = [makeExportMeta('cut-001')]
      const preview = await buildPublishPreview('Test', '# Test', metas, {
        hasTranscript: true,
        hasAltText: true
      })
      const result = canPublishWithConfirmation(state, preview)
      expect(result.allowed).toBe(true)
    })

    it('live mode blocks publish without confirmation', async () => {
      const state = createConfirmationState(false)
      const metas = [makeExportMeta('cut-001')]
      const preview = await buildPublishPreview('Test', '# Test', metas, {
        hasTranscript: true,
        hasAltText: true
      })
      const result = canPublishWithConfirmation(state, preview)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('explicit')
    })

    it('live mode allows publish after explicit confirmation', async () => {
      let state = createConfirmationState(false)
      const metas = [makeExportMeta('cut-001')]
      const preview = await buildPublishPreview('Test', '# Test', metas, {
        hasTranscript: true,
        hasAltText: true
      })
      state = confirmPublish(state, preview)
      expect(state.confirmed).toBe(true)

      const result = canPublishWithConfirmation(state, preview)
      expect(result.allowed).toBe(true)
    })

    it('confirmation invalidated when payload changes', async () => {
      let state = createConfirmationState(false)
      const metas = [makeExportMeta('cut-001')]
      const preview1 = await buildPublishPreview('Title 1', '# Title 1', metas, {
        hasTranscript: true,
        hasAltText: true
      })
      state = confirmPublish(state, preview1)
      expect(isConfirmationValid(state, preview1)).toBe(true)

      const preview2 = await buildPublishPreview('Title 2', '# Title 2', metas, {
        hasTranscript: true,
        hasAltText: true
      })
      expect(isConfirmationValid(state, preview2)).toBe(false)
      expect(canPublishWithConfirmation(state, preview2).allowed).toBe(false)
    })

    it('matureFlag change invalidates confirmation', async () => {
      let state = createConfirmationState(false)
      const metas = [makeExportMeta('cut-001')]
      const preview1 = await buildPublishPreview('Test', '# Test', metas, {
        hasTranscript: true,
        hasAltText: true,
        matureFlag: false
      })
      state = confirmPublish(state, preview1)

      const preview2 = await buildPublishPreview('Test', '# Test', metas, {
        hasTranscript: true,
        hasAltText: true,
        matureFlag: true
      })

      state = invalidateOnChange(state, preview2)
      expect(state.confirmed).toBe(false)
    })
  })

  describe('Local env/config not written to project files or artifacts', () => {
    it('DENIED_PATTERNS covers all major secret categories', () => {
      const categories = [
        { pattern: 'MY_SECRET_KEY', desc: '_KEY suffix' },
        { pattern: 'AUTH_TOKEN', desc: '_TOKEN suffix' },
        { pattern: 'DB_SECRET', desc: '_SECRET suffix' },
        { pattern: 'ADMIN_PASSWORD', desc: '_PASSWORD suffix' },
        { pattern: 'AWS_ACCESS_KEY_ID', desc: 'AWS prefix' },
        { pattern: 'AZURE_TENANT_ID', desc: 'Azure prefix' },
        { pattern: 'GCP_PROJECT', desc: 'GCP prefix' },
        { pattern: 'GOOGLE_APPLICATION_CREDENTIALS', desc: 'Google prefix' },
        { pattern: 'ANTHROPIC_API_KEY', desc: 'Anthropic prefix' },
        { pattern: 'OPENAI_API_KEY', desc: 'OpenAI prefix' },
        { pattern: 'GITHUB_TOKEN', desc: 'GitHub token' },
        { pattern: 'GH_TOKEN', desc: 'GH token' },
        { pattern: 'NPM_TOKEN', desc: 'NPM token' },
        { pattern: 'NODE_AUTH_TOKEN', desc: 'Node auth token' },
        { pattern: 'PRIVATE_KEY_PATH', desc: 'Private key prefix' },
        { pattern: 'WALLET_ADDRESS', desc: 'Wallet prefix' },
        { pattern: 'MNEMONIC_PHRASE', desc: 'Mnemonic prefix' },
        { pattern: 'SEED_PHRASE_FILE', desc: 'Seed phrase prefix' }
      ]

      for (const { pattern, desc } of categories) {
        expect(isDenied(pattern), `${desc}: ${pattern} should be denied`).toBe(true)
      }
    })

    it('buildAgentEnv does not pass through arbitrary env vars', () => {
      const hostEnv: Record<string, string> = {
        HOME: '/home/user',
        MY_CUSTOM_VAR: 'value',
        INTERNAL_CONFIG: 'config',
        DATABASE_URL: 'postgres://localhost/db',
        REDIS_HOST: 'localhost'
      }

      const env = buildAgentEnv(hostEnv)

      expect(env.MY_CUSTOM_VAR).toBeUndefined()
      expect(env.INTERNAL_CONFIG).toBeUndefined()
      expect(env.DATABASE_URL).toBeUndefined()
      expect(env.REDIS_HOST).toBeUndefined()
      expect(env.HOME).toBe('/home/user')
    })

    it('overrides only accepted if not denied', () => {
      const env = buildAgentEnv(
        { HOME: '/home/user' },
        {
          CUSTOM_ALLOWED: 'allowed-value',
          MY_SECRET_KEY: 'blocked-value'
        }
      )

      expect(env.CUSTOM_ALLOWED).toBe('allowed-value')
      expect(env.MY_SECRET_KEY).toBeUndefined()
    })
  })
})
