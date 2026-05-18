import { describe, it, expect } from 'vitest'
import {
  encodeClaimRoyalties,
  getDefaultRoyaltyConfig,
  validateRoyaltyConfig,
  PLOT_TOKEN_BASE_MAINNET
} from '../services/royaltyClaim'

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

  it('defaults PLOT token to Base mainnet constant', () => {
    const config = getDefaultRoyaltyConfig()
    expect(config.plotTokenAddress).toBe(PLOT_TOKEN_BASE_MAINNET)
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

  it('rejects empty RPC URL', () => {
    const errors = validateRoyaltyConfig({
      rpcUrl: '',
      mcv2BondAddress: '0x1234567890abcdef1234567890abcdef12345678',
      plotTokenAddress: PLOT_TOKEN_BASE_MAINNET
    })
    expect(errors).toContain('BASE_RPC_URL is required for royalty operations')
  })
})
