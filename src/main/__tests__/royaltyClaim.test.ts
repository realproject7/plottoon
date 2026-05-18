import { describe, it, expect, vi } from 'vitest'
import {
  encodeClaimRoyalties,
  getDefaultRoyaltyConfig,
  validateRoyaltyConfig,
  PLOT_TOKEN_BASE_MAINNET,
  readRoyaltyInfo
} from '../services/royaltyClaim'
import { encodeFunctionData } from 'viem'

describe('encodeClaimRoyalties', () => {
  it('returns hex-encoded calldata for claimRoyalties', () => {
    const reserveToken = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
    const data = encodeClaimRoyalties(reserveToken)
    expect(data).toMatch(/^0x/)
    expect(data.length).toBeGreaterThan(10)
  })

  it('encodes different tokens to different calldata', () => {
    const token1 = '0x1111111111111111111111111111111111111111'
    const token2 = '0x2222222222222222222222222222222222222222'
    expect(encodeClaimRoyalties(token1)).not.toBe(encodeClaimRoyalties(token2))
  })
})

describe('getDefaultRoyaltyConfig', () => {
  it('returns config with MCV2_BOND and PLOT token fields', () => {
    const config = getDefaultRoyaltyConfig()
    expect(config.rpcUrl).toBeTruthy()
    expect(config.mcv2BondAddress).toBe('')
    expect(config.plotTokenAddress).toBeTruthy()
  })

  it('defaults PLOT token to Base mainnet constant with valid EIP-55 checksum', () => {
    const config = getDefaultRoyaltyConfig()
    expect(config.plotTokenAddress).toBe(PLOT_TOKEN_BASE_MAINNET)
    expect(config.plotTokenAddress).toBe('0x4F567DACBF9D15A6acBe4A47FC2Ade0719Fb63C4')
    expect(config.plotTokenAddress).not.toBe('0x0000000000000000000000000000000000000000')
  })

  it('distinguishes MCV2_BOND from StoryFactory config', () => {
    const config = getDefaultRoyaltyConfig()
    expect('mcv2BondAddress' in config).toBe(true)
    expect('contractAddress' in config).toBe(false)
  })
})

describe('validateRoyaltyConfig', () => {
  it('returns no errors for valid config', () => {
    const errors = validateRoyaltyConfig({
      rpcUrl: 'https://rpc.example',
      mcv2BondAddress: '0x1234567890abcdef1234567890abcdef12345678',
      plotTokenAddress: PLOT_TOKEN_BASE_MAINNET
    })
    expect(errors).toEqual([])
  })

  it('rejects empty MCV2_BOND address', () => {
    const errors = validateRoyaltyConfig({
      rpcUrl: 'https://rpc.example',
      mcv2BondAddress: '',
      plotTokenAddress: PLOT_TOKEN_BASE_MAINNET
    })
    expect(errors).toContain('MCV2_BOND_ADDRESS is required for royalty operations')
  })

  it('rejects zero MCV2_BOND address', () => {
    const errors = validateRoyaltyConfig({
      rpcUrl: 'https://rpc.example',
      mcv2BondAddress: '0x0000000000000000000000000000000000000000',
      plotTokenAddress: PLOT_TOKEN_BASE_MAINNET
    })
    expect(errors).toContain('MCV2_BOND_ADDRESS is required for royalty operations')
  })

  it('rejects empty PLOT token address', () => {
    const errors = validateRoyaltyConfig({
      rpcUrl: 'https://rpc.example',
      mcv2BondAddress: '0x1234567890abcdef1234567890abcdef12345678',
      plotTokenAddress: ''
    })
    expect(errors).toContain('PLOT_TOKEN_ADDRESS is required for royalty operations')
  })

  it('rejects zero PLOT token address', () => {
    const errors = validateRoyaltyConfig({
      rpcUrl: 'https://rpc.example',
      mcv2BondAddress: '0x1234567890abcdef1234567890abcdef12345678',
      plotTokenAddress: '0x0000000000000000000000000000000000000000'
    })
    expect(errors).toContain('PLOT_TOKEN_ADDRESS is required for royalty operations')
  })

  it('rejects empty RPC URL', () => {
    const errors = validateRoyaltyConfig({
      rpcUrl: '',
      mcv2BondAddress: '0x1234567890abcdef1234567890abcdef12345678',
      plotTokenAddress: PLOT_TOKEN_BASE_MAINNET
    })
    expect(errors).toContain('BASE_RPC_URL is required for royalty operations')
  })

  it('collects multiple validation errors', () => {
    const errors = validateRoyaltyConfig({
      rpcUrl: '',
      mcv2BondAddress: '',
      plotTokenAddress: ''
    })
    expect(errors).toHaveLength(3)
    expect(errors).toContain('MCV2_BOND_ADDRESS is required for royalty operations')
    expect(errors).toContain('PLOT_TOKEN_ADDRESS is required for royalty operations')
    expect(errors).toContain('BASE_RPC_URL is required for royalty operations')
  })
})

describe('PLOT_TOKEN_BASE_MAINNET parity with plotlink-ows', () => {
  it('matches the known PlotLink Base mainnet PLOT token address', () => {
    expect(PLOT_TOKEN_BASE_MAINNET).toBe('0x4F567DACBF9D15A6acBe4A47FC2Ade0719Fb63C4')
  })

  it('has valid EIP-55 checksum (lowercase matches expected)', () => {
    expect(PLOT_TOKEN_BASE_MAINNET.toLowerCase()).toBe('0x4f567dacbf9d15a6acbe4a47fc2ade0719fb63c4')
  })

  it('is a valid 20-byte hex address', () => {
    expect(PLOT_TOKEN_BASE_MAINNET).toMatch(/^0x[0-9a-fA-F]{40}$/)
  })
})

describe('readRoyaltyInfo targets mcv2BondAddress with PLOT token', () => {
  it('sends eth_call to mcv2BondAddress with getRoyaltyInfo(wallet, plotToken)', async () => {
    const bondAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const walletAddress = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const plotToken = '0xcccccccccccccccccccccccccccccccccccccccc'

    const earned = BigInt(500000)
    const claimed = BigInt(100000)
    const encodedResult =
      '0x' + earned.toString(16).padStart(64, '0') + claimed.toString(16).padStart(64, '0')

    const capturedBodies: unknown[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      capturedBodies.push(body)
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: encodedResult }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    })

    try {
      const info = await readRoyaltyInfo(walletAddress, plotToken, {
        config: {
          rpcUrl: 'https://rpc.test',
          mcv2BondAddress: bondAddress,
          plotTokenAddress: plotToken
        }
      })

      const ethCall = capturedBodies.find(
        (b: unknown) => (b as { method: string }).method === 'eth_call'
      ) as { params: [{ to: string; data: string }, string] }

      expect(ethCall).toBeDefined()
      expect(ethCall.params[0].to).toBe(bondAddress)

      const expectedCalldata = encodeFunctionData({
        abi: [
          {
            type: 'function',
            name: 'getRoyaltyInfo',
            inputs: [
              { name: 'account', type: 'address' },
              { name: 'reserveToken', type: 'address' }
            ],
            outputs: [
              { name: 'earned', type: 'uint256' },
              { name: 'claimed', type: 'uint256' }
            ],
            stateMutability: 'view'
          }
        ],
        functionName: 'getRoyaltyInfo',
        args: [walletAddress as `0x${string}`, plotToken as `0x${string}`]
      })
      expect(ethCall.params[0].data).toBe(expectedCalldata)

      expect(info.earnedWei).toBe('500000')
      expect(info.claimedWei).toBe('100000')
      expect(info.unclaimedWei).toBe('400000')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('encodeClaimRoyalties targets PLOT token', () => {
  it('encodes claimRoyalties calldata with PLOT token address', () => {
    const plotToken = '0xcccccccccccccccccccccccccccccccccccccccc'
    const calldata = encodeClaimRoyalties(plotToken)

    const expectedCalldata = encodeFunctionData({
      abi: [
        {
          type: 'function',
          name: 'claimRoyalties',
          inputs: [{ name: 'reserveToken', type: 'address' }],
          outputs: [],
          stateMutability: 'nonpayable'
        }
      ],
      functionName: 'claimRoyalties',
      args: [plotToken as `0x${string}`]
    })
    expect(calldata).toBe(expectedCalldata)
    expect(calldata).toContain('cccccccccccccccccccccccccccccccccccccccc')
  })
})
