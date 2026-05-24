import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { registerProjectHandlers } from '../ipc/projectHandlers'
import { normalizeWalletAddress, type WalletIdentity } from '../../shared/walletIdentity'
import type { WalletIdentityStore } from '../services/walletIdentityStore'
import type { PublishConfig } from '../services/plotlinkPublish'

let mockUserData = ''

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcHandlers[channel] = handler
    }
  },
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: {
    fromWebContents: vi.fn(),
    getFocusedWindow: vi.fn()
  },
  app: {
    getPath: vi.fn(() => mockUserData)
  }
}))

const ipcHandlers: Record<string, (...args: unknown[]) => unknown> = {}

const WALLET_A = '0xaaaa000000000000000000000000000000000001'

function makeIdentity(address: string): WalletIdentity {
  return {
    address: normalizeWalletAddress(address),
    source: 'plottoon-writer',
    owsName: 'plottoon-writer-distinctive-internal-selector',
    registeredAt: '2026-05-24T00:00:00.000Z'
  }
}

function fakeStore(active: WalletIdentity | null): WalletIdentityStore {
  return {
    list: vi.fn().mockResolvedValue([]),
    getActive: vi.fn().mockResolvedValue(active),
    setActive: vi.fn(),
    clearActive: vi.fn(),
    register: vi.fn(),
    remove: vi.fn()
  }
}

const PUBLISH_CONFIG_VALID: PublishConfig = {
  rpcUrl: 'https://example-rpc.invalid',
  plotlinkBaseUrl: 'https://example-plotlink.invalid',
  storyFactoryAddress: '0xdead000000000000000000000000000000000001',
  mcv2BondAddress: '0xdead000000000000000000000000000000000002',
  indexRetries: 10,
  indexRetryDelayMs: 30000,
  indexInitialDelayMs: 8000
}

interface Report {
  generatedAt: string
  sections: Array<{
    title: string
    checks: Array<{ id: string; label: string; status: string; detail: string }>
  }>
}

function findCheck(report: Report, id: string) {
  return report.sections.flatMap((s) => s.checks).find((c) => c.id === id)
}

describe('#253 capability:getReport handler wiring', () => {
  beforeEach(() => {
    Object.keys(ipcHandlers).forEach((k) => delete ipcHandlers[k])
    mockUserData = mkdtempSync(path.join(os.tmpdir(), 'plottoon-cap-userdata-'))
  })

  afterEach(() => {
    rmSync(mockUserData, { recursive: true, force: true })
  })

  it('passes the active wallet from the identity store into the wallet check', async () => {
    registerProjectHandlers({
      walletIdentityStore: fakeStore(makeIdentity(WALLET_A)),
      capabilityContext: { publishConfig: PUBLISH_CONFIG_VALID, signerMode: 'live' }
    })
    const report = (await ipcHandlers['capability:getReport']()) as Report
    const wallet = findCheck(report, 'wallet')
    expect(wallet?.status).toBe('pass')
    expect(wallet?.detail).toContain('0xaaaa')
    expect(wallet?.detail).toContain('plottoon-writer')
  })

  it('reports wallet fail when no active wallet is selected', async () => {
    registerProjectHandlers({
      walletIdentityStore: fakeStore(null),
      capabilityContext: { publishConfig: PUBLISH_CONFIG_VALID, signerMode: 'live' }
    })
    const report = (await ipcHandlers['capability:getReport']()) as Report
    const wallet = findCheck(report, 'wallet')
    expect(wallet?.status).toBe('fail')
    expect(wallet?.detail).toMatch(/no active wallet/i)
  })

  it('passes the publish config + signer mode through to the PlotLink check', async () => {
    registerProjectHandlers({
      walletIdentityStore: fakeStore(makeIdentity(WALLET_A)),
      capabilityContext: { publishConfig: PUBLISH_CONFIG_VALID, signerMode: 'live' }
    })
    const report = (await ipcHandlers['capability:getReport']()) as Report
    const plotLink = findCheck(report, 'plotlink-endpoint')
    expect(plotLink?.status).toBe('pass')
    expect(plotLink?.detail).toContain('example-plotlink.invalid')
    expect(plotLink?.detail).not.toMatch(/placeholder/i)
  })

  it('surfaces signer-mode as info', async () => {
    registerProjectHandlers({
      walletIdentityStore: fakeStore(makeIdentity(WALLET_A)),
      capabilityContext: { publishConfig: PUBLISH_CONFIG_VALID, signerMode: 'mock' }
    })
    const report = (await ipcHandlers['capability:getReport']()) as Report
    const signer = findCheck(report, 'signer-mode')
    expect(signer?.status).toBe('info')
    expect(signer?.detail).toMatch(/Mock/i)
  })

  it('write-access fail surfaces CTA pointing to the Projects screen when no projects dir is configured', async () => {
    // Fresh userData with no projectsDir config file → write-access fails
    // with the new actionable detail.
    registerProjectHandlers({
      walletIdentityStore: fakeStore(makeIdentity(WALLET_A)),
      capabilityContext: { publishConfig: PUBLISH_CONFIG_VALID, signerMode: 'live' }
    })
    const report = (await ipcHandlers['capability:getReport']()) as Report
    const write = findCheck(report, 'write-access')
    expect(write?.status).toBe('fail')
    expect(write?.detail).toMatch(/No projects directory configured/)
    expect(write?.detail).toMatch(/Projects screen/)
  })

  it('write-access passes when a projects dir is configured and writable', async () => {
    const projectsDir = mkdtempSync(path.join(os.tmpdir(), 'plottoon-cap-projects-'))
    try {
      const configDir = path.join(mockUserData, 'config')
      mkdirSync(configDir, { recursive: true })
      writeFileSync(path.join(configDir, 'projectsDir'), projectsDir, 'utf-8')

      registerProjectHandlers({
        walletIdentityStore: fakeStore(makeIdentity(WALLET_A)),
        capabilityContext: { publishConfig: PUBLISH_CONFIG_VALID, signerMode: 'live' }
      })
      const report = (await ipcHandlers['capability:getReport']()) as Report
      const write = findCheck(report, 'write-access')
      expect(write?.status).toBe('pass')
    } finally {
      rmSync(projectsDir, { recursive: true, force: true })
    }
  })

  it('renderer-safe view projection — capability report does not leak OWS internal name', async () => {
    // The active identity carries `owsName: 'plottoon-writer-distinctive-internal-selector'`.
    // That selector must never appear in the report payload — the handler
    // projects through `{address, source}` only, mirroring the #234 boundary
    // for wallet IPC.
    registerProjectHandlers({
      walletIdentityStore: fakeStore(makeIdentity(WALLET_A)),
      capabilityContext: { publishConfig: PUBLISH_CONFIG_VALID, signerMode: 'live' }
    })
    const report = (await ipcHandlers['capability:getReport']()) as Report
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('plottoon-writer-distinctive-internal-selector')
    expect(serialized).not.toContain('owsName')
  })
})
