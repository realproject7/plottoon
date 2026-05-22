import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { registerPublishHandlers, type PublishHandlerDeps } from '../ipc/publishHandlers'
import { registerRoyaltyHandlers, type RoyaltyHandlerDeps } from '../ipc/royaltyHandlers'
import {
  registerAgentRegistrationHandlers,
  type AgentRegistrationHandlerDeps
} from '../ipc/agentRegistrationHandlers'
import { registerProject, clearRegistry } from '../services/projectRegistry'
import { writeProjectMeta, createProjectMeta } from '../services/projectMeta'
import type { PublishExecuteResult, PublishPreflightResult } from '../../shared/publishFlow'
import type { RoyaltyClaimResult } from '../../shared/royaltyFlow'

// Fake wallets only.
const ACTIVE_NAME = 'pw-stale-test'
const ACTIVE_ADDRESS = '0xaaaa000000000000000000000000000000000001'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) }
}))

vi.mock('../services/plotlinkPublish', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    realPublish: vi.fn(),
    fetchCreationFee: vi.fn(),
    createOWSViemSigner: vi.fn(),
    createViemContractEncoder: vi.fn().mockReturnValue({
      encodeCreateStoryline: vi.fn(),
      encodeChainPlot: vi.fn(),
      decodePublishEvents: vi.fn()
    })
  }
})

let tmpDir: string

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const calls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls
  const match = calls.find((c: unknown[]) => c[0] === channel)
  if (!match) throw new Error(`No handler registered for ${channel}`)
  return match[1] as (...args: unknown[]) => unknown
}

function mockSigner(isMock: boolean) {
  return {
    isMockMode: vi.fn().mockReturnValue(isMock),
    sign: vi.fn(),
    getAddress: vi.fn().mockReturnValue(ACTIVE_ADDRESS),
    requestSignature: vi.fn()
  } as unknown as PublishHandlerDeps['signer']
}

function staleOws() {
  // Active wallet is `pw-stale-test`; the vault is empty (the wallet
  // was deleted/renamed in OWS). listWallets returns no entries.
  return {
    listWallets: vi.fn().mockReturnValue([]),
    createWallet: vi.fn(),
    signMessage: vi.fn(),
    signTransaction: vi.fn()
  }
}

function freshOws() {
  return {
    listWallets: vi.fn().mockReturnValue([
      {
        id: 'fake-id',
        name: ACTIVE_NAME,
        accounts: [],
        createdAt: '2026-05-22T00:00:00.000Z'
      }
    ]),
    createWallet: vi.fn(),
    signMessage: vi.fn().mockReturnValue({ signature: '0xsig' }),
    signTransaction: vi.fn().mockReturnValue({ signature: '0xtxsig' })
  }
}

function activeWallet() {
  return {
    address: ACTIVE_ADDRESS,
    source: 'plottoon-writer' as const,
    name: ACTIVE_NAME,
    createdAt: '2026-05-22T00:00:00.000Z'
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  clearRegistry()
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plottoon-stalewallet-'))
})

async function registerStampedProject(): Promise<string> {
  const root = path.join(tmpDir, 'stamped')
  await fs.mkdir(root, { recursive: true })
  await writeProjectMeta(
    root,
    createProjectMeta('Stamped', undefined, {
      address: ACTIVE_ADDRESS,
      source: 'plottoon-writer'
    })
  )
  return registerProject(root)
}

describe('#235 stale-wallet guard — publish', () => {
  function publishDeps(ows: ReturnType<typeof staleOws>): PublishHandlerDeps {
    return {
      walletState: { wallet: activeWallet() },
      signer: mockSigner(false),
      owsModule: ows,
      vaultConfig: { chain: 'eip155:8453' },
      config: {
        rpcUrl: 'https://rpc.example',
        plotlinkBaseUrl: 'https://plotlink.example',
        storyFactoryAddress: '0x1234567890abcdef1234567890abcdef12345678',
        mcv2BondAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        creationFeeWei: '1',
        indexRetries: 0,
        indexRetryDelayMs: 0,
        indexInitialDelayMs: 0
      },
      ipfs: { upload: vi.fn().mockResolvedValue({ cid: 'bafy' }) },
      keccak: vi.fn().mockReturnValue('0x' + 'ab'.repeat(32)),
      fetchFn: vi.fn(),
      getWindow: vi.fn().mockReturnValue(null),
      resolvePlotDir: vi.fn().mockResolvedValue(tmpDir)
    }
  }

  it('publish:preflight surfaces stale-wallet error when active wallet is missing from the vault', async () => {
    registerPublishHandlers(publishDeps(staleOws()))
    const projectId = await registerStampedProject()
    const handler = getHandler('publish:preflight')
    const result = (await handler({}, projectId)) as PublishPreflightResult
    expect(result.ready).toBe(false)
    expect(result.errors.join(' ')).toMatch(/no longer available|reconnect|switch wallets/i)
  })

  it('publish:execute refuses before signer construction when wallet is stale', async () => {
    const ows = staleOws()
    registerPublishHandlers(publishDeps(ows))
    const projectId = await registerStampedProject()
    const handler = getHandler('publish:execute')
    const result = (await handler(
      {},
      {
        action: 'create-storyline',
        title: 't',
        markdown: '#',
        projectId,
        plotSlug: 'ep-1'
      },
      true
    )) as PublishExecuteResult
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/no longer available/i)
    // `realPublish` and signer construction must not have happened.
    const { realPublish, createOWSViemSigner } = await import('../services/plotlinkPublish')
    expect(realPublish).not.toHaveBeenCalled()
    expect(createOWSViemSigner).not.toHaveBeenCalled()
  })

  it('stale-wallet error does not leak vault paths, OWS names, or addresses', async () => {
    const ows = {
      ...staleOws(),
      listWallets: vi.fn().mockImplementation(() => {
        throw new Error('EACCES /private/var/folders/secret/vault.json')
      })
    }
    registerPublishHandlers(publishDeps(ows))
    const projectId = await registerStampedProject()
    const handler = getHandler('publish:execute')
    const result = (await handler(
      {},
      {
        action: 'create-storyline',
        title: 't',
        markdown: '#',
        projectId,
        plotSlug: 'ep-1'
      },
      true
    )) as PublishExecuteResult
    expect(result.success).toBe(false)
    expect(result.error).not.toContain('/private/var/folders')
    expect(result.error).not.toContain('vault.json')
    expect(result.error).not.toContain(ACTIVE_NAME)
    expect(result.error).not.toContain(ACTIVE_ADDRESS)
  })

  it('preflight passes when the wallet is present in the vault (control)', async () => {
    registerPublishHandlers(publishDeps(freshOws()))
    const projectId = await registerStampedProject()
    const handler = getHandler('publish:preflight')
    const result = (await handler({}, projectId)) as PublishPreflightResult
    expect(result.ready).toBe(true)
  })
})

describe('#235 stale-wallet guard — royalty', () => {
  function royaltyDeps(ows: ReturnType<typeof staleOws>): RoyaltyHandlerDeps {
    return {
      walletState: { wallet: activeWallet() },
      owsModule: ows,
      vaultConfig: { chain: 'eip155:8453' },
      royaltyConfig: {
        rpcUrl: 'https://rpc.example',
        mcv2BondAddress: '0x1234567890abcdef1234567890abcdef12345678',
        plotTokenAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
      },
      signerMode: 'live',
      getWindow: vi.fn().mockReturnValue(null)
    }
  }

  it('royalty:claim refuses live claim when active wallet is missing from the vault', async () => {
    registerRoyaltyHandlers(royaltyDeps(staleOws()))
    const handler = getHandler('royalty:claim')
    const result = (await handler({}, true)) as RoyaltyClaimResult
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/no longer available/i)
  })
})

describe('#235 stale-wallet guard — agent registration', () => {
  function agentDeps(ows: ReturnType<typeof staleOws>): AgentRegistrationHandlerDeps {
    return {
      walletState: { wallet: activeWallet() },
      owsModule: ows,
      vaultConfig: { chain: 'eip155:8453' },
      registrationConfig: {
        rpcUrl: 'https://rpc.example',
        registryAddress: '0x1234567890abcdef1234567890abcdef12345678'
      },
      signerMode: 'live'
    }
  }

  it('agent:register refuses live registration when active wallet is missing from the vault', async () => {
    registerAgentRegistrationHandlers(agentDeps(staleOws()))
    const handler = getHandler('agent:register')
    const result = (await handler({}, { agentName: 'TestAgent' })) as {
      success: boolean
      error?: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/no longer available/i)
  })

  it('agent:bindingProof refuses to sign when active wallet is missing from the vault', async () => {
    registerAgentRegistrationHandlers(agentDeps(staleOws()))
    const handler = getHandler('agent:bindingProof')
    const result = (await handler({}, '0xbbbb000000000000000000000000000000000002')) as {
      error?: string
    }
    expect(result.error).toMatch(/no longer available/i)
  })
})
