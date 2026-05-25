import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

let mockUserData = ''
const ipcHandlers: Record<string, (...args: unknown[]) => unknown> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcHandlers[channel] = handler
    }
  },
  app: {
    getPath: vi.fn(() => mockUserData)
  }
}))

import { registerAgentEnvBridgeHandlers } from '../ipc/agentEnvBridgeHandlers'

beforeEach(() => {
  Object.keys(ipcHandlers).forEach((k) => delete ipcHandlers[k])
  mockUserData = mkdtempSync(path.join(os.tmpdir(), 'plottoon-envbridge-ipc-'))
  registerAgentEnvBridgeHandlers()
})

afterEach(() => {
  rmSync(mockUserData, { recursive: true, force: true })
})

interface StatusEntry {
  envName: string
  bridgeKey: string
  enabled: boolean
  configured: boolean
}

interface Status {
  entries: StatusEntry[]
}

describe('#276 agentEnvBridge IPC handlers', () => {
  it('getStatus on a fresh install returns enabled=false', async () => {
    const status = (await ipcHandlers['agentEnvBridge:getStatus']()) as Status
    const atlas = status.entries.find((e) => e.bridgeKey === 'atlascloud')!
    expect(atlas.enabled).toBe(false)
  })

  it('setConfig({atlascloud: true}) persists + returns refreshed status', async () => {
    const before = (await ipcHandlers['agentEnvBridge:getStatus']()) as Status
    expect(before.entries.find((e) => e.bridgeKey === 'atlascloud')!.enabled).toBe(false)

    const after = (await ipcHandlers['agentEnvBridge:setConfig'](
      {},
      { atlascloud: true }
    )) as Status
    expect(after.entries.find((e) => e.bridgeKey === 'atlascloud')!.enabled).toBe(true)

    // Next getStatus call reads the persisted value, not the in-memory state.
    const persisted = (await ipcHandlers['agentEnvBridge:getStatus']()) as Status
    expect(persisted.entries.find((e) => e.bridgeKey === 'atlascloud')!.enabled).toBe(true)
  })

  it('setConfig ignores unknown fields a renderer might try to slip in', async () => {
    // Renderer tries to write the env value alongside the toggle.
    const SECRET = 'fake-test-distinctive-attempt-to-persist-key'
    const status = (await ipcHandlers['agentEnvBridge:setConfig'](
      {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { atlascloud: true, ATLASCLOUD_API_KEY: SECRET } as any
    )) as Status
    const serialized = JSON.stringify(status)
    expect(serialized).not.toContain(SECRET)
    // And the persisted file doesn't carry it either.
    const { readFile } = await import('node:fs/promises')
    const raw = await readFile(path.join(mockUserData, 'config', 'agent-env-bridge.json'), 'utf-8')
    expect(raw).not.toContain(SECRET)
  })

  it('setConfig with no payload defaults atlascloud to false', async () => {
    // First flip it on, then call setConfig with empty input — the
    // sanitizer should reset to false (atlascloud requires === true).
    await ipcHandlers['agentEnvBridge:setConfig']({}, { atlascloud: true })
    const after = (await ipcHandlers['agentEnvBridge:setConfig']({}, {})) as Status
    expect(after.entries.find((e) => e.bridgeKey === 'atlascloud')!.enabled).toBe(false)
  })

  it('getStatus response carries only the documented EnvBridgeStatus shape (no secret values)', async () => {
    const ORIGINAL = process.env.ATLASCLOUD_API_KEY
    const SECRET = 'fake-test-distinctive-getstatus-secret'
    process.env.ATLASCLOUD_API_KEY = SECRET
    try {
      await ipcHandlers['agentEnvBridge:setConfig']({}, { atlascloud: true })
      const status = (await ipcHandlers['agentEnvBridge:getStatus']()) as Status
      const serialized = JSON.stringify(status)
      expect(serialized).not.toContain(SECRET)
      // Configured reflects that the env var IS set, but the value
      // itself never leaks.
      expect(status.entries.find((e) => e.bridgeKey === 'atlascloud')!.configured).toBe(true)
    } finally {
      if (ORIGINAL === undefined) delete process.env.ATLASCLOUD_API_KEY
      else process.env.ATLASCLOUD_API_KEY = ORIGINAL
    }
  })
})
