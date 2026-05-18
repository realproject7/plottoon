import { describe, it, expect, vi } from 'vitest'
import {
  buildOwnerBindingMessage,
  buildAgentURI,
  encodeRegister,
  decodeRegisteredEvent,
  getDefaultAgentRegistrationConfig,
  readAgentStatus
} from '../services/agentRegistration'
import { encodeFunctionData, encodeEventTopics, encodeAbiParameters, type Hex } from 'viem'

vi.mock('viem', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    createPublicClient: vi.fn()
  }
})

describe('buildOwnerBindingMessage', () => {
  it('produces the exact required message format', () => {
    const human = '0xHumanWallet1234567890abcdef12345678901234'
    const ows = '0xOwsWallet1234567890abcdef1234567890123456'
    const message = buildOwnerBindingMessage(human, ows)
    expect(message).toBe(`I authorize ${human} as my PlotLink owner. Wallet: ${ows}`)
  })

  it('includes both addresses in the message', () => {
    const human = '0xaaa'
    const ows = '0xbbb'
    const message = buildOwnerBindingMessage(human, ows)
    expect(message).toContain(human)
    expect(message).toContain(ows)
  })
})

describe('buildAgentURI', () => {
  it('produces valid JSON with name, model, genre, registeredBy', () => {
    const uri = buildAgentURI({
      agentName: 'TestBot',
      modelLabel: 'Claude CLI 1.0.0',
      genre: 'fantasy'
    })
    const parsed = JSON.parse(uri)
    expect(parsed.name).toBe('TestBot')
    expect(parsed.model).toBe('Claude CLI 1.0.0')
    expect(parsed.genre).toBe('fantasy')
    expect(parsed.registeredBy).toBe('plottoon')
  })

  it('defaults genre to empty string when omitted', () => {
    const uri = buildAgentURI({ agentName: 'Bot', modelLabel: 'Model' })
    const parsed = JSON.parse(uri)
    expect(parsed.genre).toBe('')
  })
})

describe('encodeRegister', () => {
  it('encodes register(agentURI) calldata', () => {
    const agentURI = '{"name":"Bot","model":"Claude"}'
    const calldata = encodeRegister(agentURI)
    expect(calldata).toMatch(/^0x/)

    const expected = encodeFunctionData({
      abi: [
        {
          type: 'function',
          name: 'register',
          inputs: [{ name: 'agentURI', type: 'string' }],
          outputs: [{ name: 'agentId', type: 'uint256' }],
          stateMutability: 'nonpayable'
        }
      ],
      functionName: 'register',
      args: [agentURI]
    })
    expect(calldata).toBe(expected)
  })

  it('does not encode registerAgent calldata', () => {
    const calldata = encodeRegister('test')
    const registerAgentSelector = '0x' + 'a1b2c3d4'
    expect(calldata.slice(0, 10)).not.toBe(registerAgentSelector)
  })
})

describe('decodeRegisteredEvent', () => {
  const registeredEventAbi = [
    {
      type: 'event' as const,
      name: 'Registered',
      inputs: [
        { name: 'agentId', type: 'uint256', indexed: true },
        { name: 'agentURI', type: 'string', indexed: false },
        { name: 'owner', type: 'address', indexed: true }
      ]
    }
  ]

  it('decodes Registered(agentId, agentURI, owner) event from logs', () => {
    const agentId = BigInt(42)
    const agentURI = '{"name":"Bot"}'
    const owner = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

    const topics = encodeEventTopics({
      abi: registeredEventAbi,
      eventName: 'Registered',
      args: { agentId, owner: owner as Hex }
    }) as Hex[]

    const data = encodeAbiParameters([{ name: 'agentURI', type: 'string' }], [agentURI])

    const result = decodeRegisteredEvent([{ topics, data }])
    expect(result).not.toBeNull()
    expect(result!.agentId).toBe('42')
    expect(result!.agentURI).toBe(agentURI)
    expect(result!.owner.toLowerCase()).toBe(owner)
  })

  it('returns null when no matching logs', () => {
    const result = decodeRegisteredEvent([])
    expect(result).toBeNull()
  })

  it('skips non-matching logs and finds the Registered event', () => {
    const agentId = BigInt(7)
    const agentURI = '{"name":"Agent7"}'
    const owner = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

    const topics = encodeEventTopics({
      abi: registeredEventAbi,
      eventName: 'Registered',
      args: { agentId, owner: owner as Hex }
    }) as Hex[]

    const data = encodeAbiParameters([{ name: 'agentURI', type: 'string' }], [agentURI])

    const unrelatedLog = {
      topics: ['0xdeadbeef'] as Hex[],
      data: '0x' as Hex
    }

    const result = decodeRegisteredEvent([unrelatedLog, { topics, data }])
    expect(result).not.toBeNull()
    expect(result!.agentId).toBe('7')
  })
})

describe('getDefaultAgentRegistrationConfig', () => {
  it('returns config with default values', () => {
    const config = getDefaultAgentRegistrationConfig()
    expect(config.rpcUrl).toBeTruthy()
    expect(config.registryAddress).toBeTruthy()
  })
})

describe('readAgentStatus', () => {
  const config = {
    rpcUrl: 'https://rpc.example',
    registryAddress: '0x1234567890abcdef1234567890abcdef12345678'
  }

  it('returns registered via agentIdByWallet with agentURI', async () => {
    const { createPublicClient } = await import('viem')
    const mockReadContract = vi
      .fn()
      .mockResolvedValueOnce(BigInt(42))
      .mockResolvedValueOnce('{"name":"MyBot"}')
    ;(createPublicClient as ReturnType<typeof vi.fn>).mockReturnValue({
      readContract: mockReadContract
    })

    const status = await readAgentStatus('0xabc', { config })
    expect(status.registered).toBe(true)
    expect(status.agentId).toBe('42')
    expect(status.agentURI).toBe('{"name":"MyBot"}')
    expect(mockReadContract).toHaveBeenCalledTimes(2)
  })

  it('falls back to agentURI via tokenURI when agentURI fails', async () => {
    const { createPublicClient } = await import('viem')
    const mockReadContract = vi
      .fn()
      .mockResolvedValueOnce(BigInt(42))
      .mockRejectedValueOnce(new Error('agentURI not found'))
      .mockResolvedValueOnce('ipfs://token-uri')
    ;(createPublicClient as ReturnType<typeof vi.fn>).mockReturnValue({
      readContract: mockReadContract
    })

    const status = await readAgentStatus('0xabc', { config })
    expect(status.registered).toBe(true)
    expect(status.agentId).toBe('42')
    expect(status.agentURI).toBe('ipfs://token-uri')
  })

  it('falls back to balanceOf + tokenOfOwnerByIndex when agentIdByWallet fails', async () => {
    const { createPublicClient } = await import('viem')
    const mockReadContract = vi
      .fn()
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce(BigInt(1))
      .mockResolvedValueOnce(BigInt(99))
      .mockResolvedValueOnce('{"name":"FallbackBot"}')
    ;(createPublicClient as ReturnType<typeof vi.fn>).mockReturnValue({
      readContract: mockReadContract
    })

    const status = await readAgentStatus('0xabc', { config })
    expect(status.registered).toBe(true)
    expect(status.agentId).toBe('99')
    expect(status.agentURI).toBe('{"name":"FallbackBot"}')
    expect(mockReadContract).toHaveBeenCalledTimes(4)
  })

  it('returns registered with null agentId when tokenOfOwnerByIndex fails', async () => {
    const { createPublicClient } = await import('viem')
    const mockReadContract = vi
      .fn()
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce(BigInt(1))
      .mockRejectedValueOnce(new Error('not enumerable'))
    ;(createPublicClient as ReturnType<typeof vi.fn>).mockReturnValue({
      readContract: mockReadContract
    })

    const status = await readAgentStatus('0xabc', { config })
    expect(status.registered).toBe(true)
    expect(status.agentId).toBeNull()
    expect(status.agentURI).toBeNull()
  })

  it('returns unregistered when balanceOf is zero', async () => {
    const { createPublicClient } = await import('viem')
    const mockReadContract = vi
      .fn()
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce(BigInt(0))
    ;(createPublicClient as ReturnType<typeof vi.fn>).mockReturnValue({
      readContract: mockReadContract
    })

    const status = await readAgentStatus('0xabc', { config })
    expect(status.registered).toBe(false)
  })

  it('returns unregistered when agentIdByWallet returns zero', async () => {
    const { createPublicClient } = await import('viem')
    const mockReadContract = vi
      .fn()
      .mockResolvedValueOnce(BigInt(0))
      .mockResolvedValueOnce(BigInt(0))
    ;(createPublicClient as ReturnType<typeof vi.fn>).mockReturnValue({
      readContract: mockReadContract
    })

    const status = await readAgentStatus('0xabc', { config })
    expect(status.registered).toBe(false)
  })

  it('returns unregistered when all reads fail', async () => {
    const { createPublicClient } = await import('viem')
    const mockReadContract = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
    ;(createPublicClient as ReturnType<typeof vi.fn>).mockReturnValue({
      readContract: mockReadContract
    })

    const status = await readAgentStatus('0xabc', { config })
    expect(status.registered).toBe(false)
  })
})
