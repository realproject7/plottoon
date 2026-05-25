import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

let mockUserData = ''

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => mockUserData)
  }
}))

import {
  readEnvBridgeConfig,
  writeEnvBridgeConfig,
  getEnvBridgeStatus,
  buildBridgedEnv,
  DEFAULT_ENV_BRIDGE_CONFIG,
  BRIDGEABLE_ENV_KEYS,
  type EnvBridgeConfig
} from '../services/agentEnvBridge'

beforeEach(() => {
  mockUserData = mkdtempSync(path.join(os.tmpdir(), 'plottoon-envbridge-'))
})

afterEach(() => {
  rmSync(mockUserData, { recursive: true, force: true })
})

describe('#276 readEnvBridgeConfig / writeEnvBridgeConfig', () => {
  it('returns the default config on a fresh install (no file)', async () => {
    const config = await readEnvBridgeConfig()
    expect(config).toEqual(DEFAULT_ENV_BRIDGE_CONFIG)
    expect(config.atlascloud).toBe(false)
  })

  it('round-trips: write then read returns the same shape', async () => {
    await writeEnvBridgeConfig({ atlascloud: true })
    const config = await readEnvBridgeConfig()
    expect(config.atlascloud).toBe(true)
  })

  it('sanitizes unknown keys out of the persisted file', async () => {
    // Even if a future caller tried to write extra fields, the
    // reader's sanitizer only keeps the documented boolean shape.
    await writeEnvBridgeConfig({
      atlascloud: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ATLASCLOUD_API_KEY: 'should-not-persist' as any
    } as EnvBridgeConfig)
    const config = await readEnvBridgeConfig()
    expect(Object.keys(config).sort()).toEqual(['atlascloud'])
    expect((config as unknown as Record<string, unknown>).ATLASCLOUD_API_KEY).toBeUndefined()
  })

  it('coerces non-boolean truthy values to false (only `=== true` enables)', async () => {
    // Belt-and-suspenders: if the on-disk file is hand-edited to a
    // non-boolean value, the reader treats it as false instead of
    // honoring a sketchy input.
    await writeEnvBridgeConfig({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      atlascloud: 'yes' as any
    } as EnvBridgeConfig)
    const config = await readEnvBridgeConfig()
    expect(config.atlascloud).toBe(false)
  })
})

describe('#276 getEnvBridgeStatus — renderer-safe surface', () => {
  it('returns enabled=false, configured=false on a fresh install with no env var', () => {
    const status = getEnvBridgeStatus({ atlascloud: false }, {})
    const atlas = status.entries.find((e) => e.bridgeKey === 'atlascloud')!
    expect(atlas.enabled).toBe(false)
    expect(atlas.configured).toBe(false)
    expect(atlas.envName).toBe('ATLASCLOUD_API_KEY')
  })

  it('reports configured=true when the env var is set in the host shell', () => {
    const status = getEnvBridgeStatus(
      { atlascloud: false },
      { ATLASCLOUD_API_KEY: 'fake-test-key' }
    )
    const atlas = status.entries.find((e) => e.bridgeKey === 'atlascloud')!
    expect(atlas.configured).toBe(true)
    expect(atlas.enabled).toBe(false)
  })

  it('reports enabled=true when the toggle is on', () => {
    const status = getEnvBridgeStatus({ atlascloud: true }, { ATLASCLOUD_API_KEY: 'fake-test-key' })
    const atlas = status.entries.find((e) => e.bridgeKey === 'atlascloud')!
    expect(atlas.enabled).toBe(true)
    expect(atlas.configured).toBe(true)
  })

  it('treats an empty env var as not configured', () => {
    const status = getEnvBridgeStatus({ atlascloud: false }, { ATLASCLOUD_API_KEY: '' })
    const atlas = status.entries.find((e) => e.bridgeKey === 'atlascloud')!
    expect(atlas.configured).toBe(false)
  })

  it('never carries the env var value through the status payload', () => {
    const SECRET = 'fake-test-distinctive-atlas-key-9988'
    const status = getEnvBridgeStatus({ atlascloud: true }, { ATLASCLOUD_API_KEY: SECRET })
    const serialized = JSON.stringify(status)
    expect(serialized).not.toContain(SECRET)
    // Status entries expose only the documented keys.
    for (const entry of status.entries) {
      expect(Object.keys(entry).sort()).toEqual(['bridgeKey', 'configured', 'enabled', 'envName'])
    }
  })

  it('exposes only the keys in BRIDGEABLE_ENV_KEYS', () => {
    const status = getEnvBridgeStatus({ atlascloud: false }, {})
    expect(status.entries).toHaveLength(BRIDGEABLE_ENV_KEYS.length)
    expect(status.entries.map((e) => e.envName).sort()).toEqual(
      BRIDGEABLE_ENV_KEYS.map((k) => k.envName).sort()
    )
  })
})

describe('#276 buildBridgedEnv — value flow for the spawner', () => {
  it('returns an empty map when no toggles are on', () => {
    const bridged = buildBridgedEnv({ atlascloud: false }, { ATLASCLOUD_API_KEY: 'fake-test-key' })
    expect(bridged).toEqual({})
  })

  it('returns an empty map when the toggle is on but the env var is missing', () => {
    const bridged = buildBridgedEnv({ atlascloud: true }, {})
    expect(bridged).toEqual({})
  })

  it('returns the env var only when toggle is on AND var is present + non-empty', () => {
    const bridged = buildBridgedEnv({ atlascloud: true }, { ATLASCLOUD_API_KEY: 'fake-test-key' })
    expect(bridged).toEqual({ ATLASCLOUD_API_KEY: 'fake-test-key' })
  })

  it('rejects empty-string env values even when toggle is on', () => {
    const bridged = buildBridgedEnv({ atlascloud: true }, { ATLASCLOUD_API_KEY: '' })
    expect(bridged).toEqual({})
  })
})

describe('#276 BRIDGEABLE_ENV_KEYS — MVP scope', () => {
  it('only allows ATLASCLOUD_API_KEY in the MVP', () => {
    expect(BRIDGEABLE_ENV_KEYS).toHaveLength(1)
    expect(BRIDGEABLE_ENV_KEYS[0].envName).toBe('ATLASCLOUD_API_KEY')
    expect(BRIDGEABLE_ENV_KEYS[0].bridgeKey).toBe('atlascloud')
  })
})

describe('#276 persisted file never carries the env value', () => {
  // Final defense-in-depth: the only thing the bridge writes to disk
  // is the boolean config. The env value lives only in the host shell
  // and the in-memory spawner output.
  it('persisted config file contains only the boolean toggle, not the key value', async () => {
    const SECRET = 'fake-test-distinctive-key-on-disk-check'
    const originalEnv = process.env.ATLASCLOUD_API_KEY
    process.env.ATLASCLOUD_API_KEY = SECRET
    try {
      await writeEnvBridgeConfig({ atlascloud: true })
      const { readFile } = await import('node:fs/promises')
      const raw = await readFile(
        path.join(mockUserData, 'config', 'agent-env-bridge.json'),
        'utf-8'
      )
      expect(raw).not.toContain(SECRET)
      expect(JSON.parse(raw)).toEqual({ atlascloud: true })
    } finally {
      if (originalEnv === undefined) delete process.env.ATLASCLOUD_API_KEY
      else process.env.ATLASCLOUD_API_KEY = originalEnv
    }
  })
})
