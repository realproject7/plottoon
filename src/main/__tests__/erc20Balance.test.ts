import { describe, it, expect, vi } from 'vitest'
import { encodeFunctionData } from 'viem'
import { readErc20Balance, USDC_BASE_MAINNET } from '../services/erc20Balance'

const PLOT = '0x4F567DACBF9D15A6acBe4A47FC2Ade0719Fb63C4'
const WALLET = '0xaaaa000000000000000000000000000000000001'

const BALANCE_OF_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
    stateMutability: 'view'
  }
] as const

describe('#249 readErc20Balance', () => {
  it('targets the token contract with balanceOf(walletAddress) calldata and returns the raw wei string', async () => {
    // PLOT (18 decimals): 1.5 PLOT = 1500000000000000000 wei.
    const wei = BigInt('1500000000000000000')
    const encoded = '0x' + wei.toString(16).padStart(64, '0')

    const captured: Array<{ url: string; body: unknown }> = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      captured.push({ url, body })
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: encoded }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }) as unknown as typeof globalThis.fetch

    try {
      const result = await readErc20Balance(WALLET, {
        rpcUrl: 'https://rpc.test',
        token: PLOT
      })
      expect(result).toBe('1500000000000000000')

      const ethCall = captured.find((c) => (c.body as { method: string }).method === 'eth_call')!
      expect(ethCall).toBeDefined()
      const params = (ethCall.body as { params: [{ to: string; data: string }, string] }).params
      expect(params[0].to.toLowerCase()).toBe(PLOT.toLowerCase())

      // Calldata = balanceOf(WALLET).
      const expected = encodeFunctionData({
        abi: BALANCE_OF_ABI,
        functionName: 'balanceOf',
        args: [WALLET as `0x${string}`]
      })
      expect(params[0].data).toBe(expected)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('returns "0" when the contract returns zero', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: body.id, result: '0x' + '0'.repeat(64) }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }) as unknown as typeof globalThis.fetch

    try {
      const result = await readErc20Balance(WALLET, {
        rpcUrl: 'https://rpc.test',
        token: USDC_BASE_MAINNET
      })
      expect(result).toBe('0')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('throws when the RPC returns an error', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockImplementation(
      async () =>
        new Response('Internal Server Error', {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'Content-Type': 'text/plain' }
        })
    ) as unknown as typeof globalThis.fetch

    try {
      await expect(
        readErc20Balance(WALLET, {
          rpcUrl: 'https://rpc.test',
          token: USDC_BASE_MAINNET
        })
      ).rejects.toThrow()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('exposes USDC_BASE_MAINNET as the Base mainnet USDC contract', () => {
    expect(USDC_BASE_MAINNET).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(USDC_BASE_MAINNET.toLowerCase()).toBe('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')
  })
})
