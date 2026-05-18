import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'
import {
  registerAgentRegistrationHandlers,
  type AgentRegistrationHandlerDeps
} from '../ipc/agentRegistrationHandlers'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn()
  },
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/plottoon-test')
  }
}))

vi.mock('../services/agentRegistration', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    readAgentStatus: vi.fn(),
    executeAgentRegistration: vi.fn()
  }
})

vi.mock('../services/agentRegistrationCache', () => ({
  findCachedAgent: vi.fn().mockResolvedValue(null),
  upsertAgentCache: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../services/cliDetection', () => ({
  detectClis: vi.fn().mockResolvedValue({
    detectedAt: '2026-05-18T00:00:00Z',
    clis: [
      { name: 'Claude CLI', command: 'claude', installed: true, version: '1.0.0' },
      { name: 'Codex CLI', command: 'codex', installed: false, version: null }
    ]
  })
}))

type IpcHandler = (...args: unknown[]) => unknown

function getHandler(channel: string): IpcHandler {
  const calls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls
  const match = calls.find((c: unknown[]) => c[0] === channel)
  if (!match) throw new Error(`No handler registered for ${channel}`)
  return match[1] as IpcHandler
}

function createDeps(
  overrides?: Partial<AgentRegistrationHandlerDeps>
): AgentRegistrationHandlerDeps {
  return {
    walletState: { wallet: null },
    owsModule: {
      listWallets: vi.fn().mockReturnValue([]),
      createWallet: vi.fn(),
      signMessage: vi.fn().mockReturnValue({ signature: '0xsig' }),
      signTransaction: vi.fn().mockReturnValue({ signature: '0xtxsig' })
    },
    vaultConfig: { chain: 'eip155:8453' },
    registrationConfig: {
      rpcUrl: 'https://rpc.example',
      registryAddress: '0x1234567890abcdef1234567890abcdef12345678'
    },
    signerMode: 'mock',
    ...overrides
  }
}

const WALLET = {
  address: '0xabc',
  source: 'plottoon-writer' as const,
  name: 'pw-1',
  createdAt: '2026-05-18T00:00:00Z'
}

describe('agent:status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null status when no wallet connected', async () => {
    const deps = createDeps()
    registerAgentRegistrationHandlers(deps)
    const handler = getHandler('agent:status')
    const result = (await handler()) as { status: null; cached: null; error: null }
    expect(result.status).toBeNull()
    expect(result.error).toBeNull()
  })

  it('returns unregistered status in mock mode with no cache', async () => {
    const deps = createDeps({ walletState: { wallet: WALLET } })
    registerAgentRegistrationHandlers(deps)
    const handler = getHandler('agent:status')
    const result = (await handler()) as {
      status: { registered: boolean }
      cached: null
      error: null
    }
    expect(result.status.registered).toBe(false)
    expect(result.cached).toBeNull()
  })

  it('returns registered status in mock mode when cached', async () => {
    const { findCachedAgent } = await import('../services/agentRegistrationCache')
    ;(findCachedAgent as ReturnType<typeof vi.fn>).mockResolvedValue({
      agentId: 'mock-agent-1',
      agentName: 'TestBot',
      genre: 'fantasy',
      modelLabel: 'Claude CLI 1.0.0',
      registeredAt: '2026-05-18T00:00:00Z',
      registeredBy: 'plottoon',
      walletAddress: '0xabc'
    })

    const deps = createDeps({ walletState: { wallet: WALLET } })
    registerAgentRegistrationHandlers(deps)
    const handler = getHandler('agent:status')
    const result = (await handler()) as {
      status: { registered: boolean; agentId: string }
      cached: { agentId: string }
      error: null
    }
    expect(result.status.registered).toBe(true)
    expect(result.status.agentId).toBe('mock-agent-1')
    expect(result.cached).toBeDefined()
  })

  it('reads live status when in live mode', async () => {
    const { readAgentStatus } = await import('../services/agentRegistration')
    ;(readAgentStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      registered: true,
      agentId: '42',
      agentName: 'LiveBot',
      modelLabel: 'Claude CLI 1.0.0'
    })

    const deps = createDeps({
      signerMode: 'live',
      walletState: { wallet: WALLET }
    })
    registerAgentRegistrationHandlers(deps)
    const handler = getHandler('agent:status')
    const result = (await handler()) as {
      status: { registered: boolean; agentId: string }
      error: null
    }
    expect(result.status.registered).toBe(true)
    expect(result.status.agentId).toBe('42')
    expect(readAgentStatus).toHaveBeenCalled()
  })

  it('falls back to cache when live read fails', async () => {
    const { readAgentStatus } = await import('../services/agentRegistration')
    const { findCachedAgent } = await import('../services/agentRegistrationCache')
    ;(readAgentStatus as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('RPC timeout'))
    ;(findCachedAgent as ReturnType<typeof vi.fn>).mockResolvedValue({
      agentId: 'cached-1',
      agentName: 'CachedBot',
      genre: '',
      modelLabel: 'Claude CLI',
      registeredAt: '2026-05-18T00:00:00Z',
      registeredBy: 'plottoon',
      walletAddress: '0xabc'
    })

    const deps = createDeps({
      signerMode: 'live',
      walletState: { wallet: WALLET }
    })
    registerAgentRegistrationHandlers(deps)
    const handler = getHandler('agent:status')
    const result = (await handler()) as {
      status: { registered: boolean; agentId: string }
      error: string
    }
    expect(result.status.registered).toBe(true)
    expect(result.status.agentId).toBe('cached-1')
    expect(result.error).toBe('RPC timeout')
  })

  it('returns null status and error when live fails with no cache', async () => {
    const { readAgentStatus } = await import('../services/agentRegistration')
    const { findCachedAgent } = await import('../services/agentRegistrationCache')
    ;(readAgentStatus as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('RPC unavailable'))
    ;(findCachedAgent as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    const deps = createDeps({
      signerMode: 'live',
      walletState: { wallet: WALLET }
    })
    registerAgentRegistrationHandlers(deps)
    const handler = getHandler('agent:status')
    const result = (await handler()) as { status: null; error: string }
    expect(result.status).toBeNull()
    expect(result.error).toBe('RPC unavailable')
  })
})

describe('agent:register', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects when no wallet connected', async () => {
    const deps = createDeps()
    registerAgentRegistrationHandlers(deps)
    const handler = getHandler('agent:register')
    const result = (await handler({}, { agentName: 'Bot' })) as {
      success: boolean
      error: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toContain('No wallet connected')
  })

  it('returns mock success and caches in mock mode', async () => {
    const { upsertAgentCache } = await import('../services/agentRegistrationCache')
    const deps = createDeps({ walletState: { wallet: WALLET } })
    registerAgentRegistrationHandlers(deps)
    const handler = getHandler('agent:register')
    const result = (await handler({}, { agentName: 'MockBot', genre: 'scifi' })) as {
      success: boolean
      agentId: string
    }
    expect(result.success).toBe(true)
    expect(result.agentId).toMatch(/^mock-agent-/)
    expect(upsertAgentCache).toHaveBeenCalledWith(
      expect.objectContaining({
        agentName: 'MockBot',
        genre: 'scifi',
        registeredBy: 'plottoon',
        walletAddress: '0xabc'
      })
    )
  })

  it('detects Claude CLI for model label', async () => {
    const { upsertAgentCache } = await import('../services/agentRegistrationCache')
    const deps = createDeps({ walletState: { wallet: WALLET } })
    registerAgentRegistrationHandlers(deps)
    const handler = getHandler('agent:register')
    await handler({}, { agentName: 'Bot' })
    expect(upsertAgentCache).toHaveBeenCalledWith(
      expect.objectContaining({
        modelLabel: 'Claude CLI 1.0.0'
      })
    )
  })

  it('returns error when live registration fails', async () => {
    const { executeAgentRegistration } = await import('../services/agentRegistration')
    ;(executeAgentRegistration as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Insufficient gas')
    )

    const deps = createDeps({
      signerMode: 'live',
      walletState: { wallet: WALLET }
    })
    registerAgentRegistrationHandlers(deps)
    const handler = getHandler('agent:register')
    const result = (await handler({}, { agentName: 'LiveBot' })) as {
      success: boolean
      error: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Insufficient gas')
  })
})

describe('agent:bindingProof', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects when no wallet connected', async () => {
    const deps = createDeps()
    registerAgentRegistrationHandlers(deps)
    const handler = getHandler('agent:bindingProof')
    const result = (await handler({}, '0x1234567890abcdef1234567890abcdef12345678')) as {
      error: string
    }
    expect(result.error).toContain('No wallet connected')
  })

  it('rejects invalid human wallet address', async () => {
    const deps = createDeps({ walletState: { wallet: WALLET } })
    registerAgentRegistrationHandlers(deps)
    const handler = getHandler('agent:bindingProof')
    const result = (await handler({}, 'not-an-address')) as { error: string }
    expect(result.error).toContain('Invalid human wallet address')
  })

  it('returns signed binding proof with correct message format', async () => {
    const deps = createDeps({ walletState: { wallet: WALLET } })
    registerAgentRegistrationHandlers(deps)
    const handler = getHandler('agent:bindingProof')
    const humanWallet = '0x1234567890abcdef1234567890abcdef12345678'
    const result = (await handler({}, humanWallet)) as {
      message: string
      signature: string
      owsWalletAddress: string
    }
    expect(result.message).toBe(
      `I authorize ${humanWallet} as my PlotLink owner. Wallet: ${WALLET.address}`
    )
    expect(result.signature).toBe('0xsig')
    expect(result.owsWalletAddress).toBe(WALLET.address)
  })

  it('includes cached agent metadata in binding proof', async () => {
    const { findCachedAgent } = await import('../services/agentRegistrationCache')
    const cachedEntry = {
      agentId: 'agent-42',
      agentName: 'MyBot',
      genre: 'fantasy',
      modelLabel: 'Claude CLI 1.0.0',
      registeredAt: '2026-05-18T00:00:00Z',
      registeredBy: 'plottoon',
      walletAddress: '0xabc'
    }
    ;(findCachedAgent as ReturnType<typeof vi.fn>).mockResolvedValue(cachedEntry)

    const deps = createDeps({ walletState: { wallet: WALLET } })
    registerAgentRegistrationHandlers(deps)
    const handler = getHandler('agent:bindingProof')
    const result = (await handler({}, '0x1234567890abcdef1234567890abcdef12345678')) as {
      cachedAgent: { agentId: string }
    }
    expect(result.cachedAgent).toEqual(cachedEntry)
  })

  it('returns error when signing fails', async () => {
    const deps = createDeps({
      walletState: { wallet: WALLET },
      owsModule: {
        listWallets: vi.fn(),
        createWallet: vi.fn(),
        signMessage: vi.fn().mockImplementation(() => {
          throw new Error('HSM locked')
        }),
        signTransaction: vi.fn()
      }
    })
    registerAgentRegistrationHandlers(deps)
    const handler = getHandler('agent:bindingProof')
    const result = (await handler({}, '0x1234567890abcdef1234567890abcdef12345678')) as {
      error: string
    }
    expect(result.error).toBe('HSM locked')
  })
})
