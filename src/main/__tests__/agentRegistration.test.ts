import { describe, it, expect, vi } from 'vitest'
import {
  buildOwnerBindingMessage,
  getDefaultAgentRegistrationConfig,
  readAgentStatus
} from '../services/agentRegistration'

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

  it('returns registered via agentIdByWallet success path', async () => {
    const { createPublicClient } = await import('viem')
    const mockReadContract = vi
      .fn()
      .mockResolvedValueOnce(BigInt(42))
      .mockResolvedValueOnce([BigInt(42), 'MyBot', 'Claude CLI', true])
    ;(createPublicClient as ReturnType<typeof vi.fn>).mockReturnValue({
      readContract: mockReadContract
    })

    const status = await readAgentStatus('0xabc', { config })
    expect(status.registered).toBe(true)
    expect(status.agentId).toBe('42')
    expect(status.agentName).toBe('MyBot')
    expect(mockReadContract).toHaveBeenCalledTimes(2)
  })

  it('falls back to getAgentInfo when agentIdByWallet fails', async () => {
    const { createPublicClient } = await import('viem')
    const mockReadContract = vi
      .fn()
      .mockRejectedValueOnce(new Error('method not found'))
      .mockResolvedValueOnce([BigInt(7), 'FallbackBot', 'Codex CLI', true])
    ;(createPublicClient as ReturnType<typeof vi.fn>).mockReturnValue({
      readContract: mockReadContract
    })

    const status = await readAgentStatus('0xabc', { config })
    expect(status.registered).toBe(true)
    expect(status.agentId).toBe('7')
    expect(status.agentName).toBe('FallbackBot')
  })

  it('falls back to balanceOf when both agentIdByWallet and getAgentInfo fail', async () => {
    const { createPublicClient } = await import('viem')
    const mockReadContract = vi
      .fn()
      .mockRejectedValueOnce(new Error('not found'))
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce(BigInt(1))
    ;(createPublicClient as ReturnType<typeof vi.fn>).mockReturnValue({
      readContract: mockReadContract
    })

    const status = await readAgentStatus('0xabc', { config })
    expect(status.registered).toBe(true)
    expect(status.agentId).toBeNull()
    expect(mockReadContract).toHaveBeenCalledTimes(3)
  })

  it('returns unregistered when balanceOf is zero', async () => {
    const { createPublicClient } = await import('viem')
    const mockReadContract = vi
      .fn()
      .mockRejectedValueOnce(new Error('not found'))
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
      .mockResolvedValueOnce([BigInt(0), '', '', false])
    ;(createPublicClient as ReturnType<typeof vi.fn>).mockReturnValue({
      readContract: mockReadContract
    })

    const status = await readAgentStatus('0xabc', { config })
    expect(status.registered).toBe(false)
  })
})
