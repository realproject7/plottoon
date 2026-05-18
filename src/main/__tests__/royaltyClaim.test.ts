import { describe, it, expect } from 'vitest'
import { encodeClaimRoyalties, getDefaultRoyaltyConfig } from '../services/royaltyClaim'

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
  it('returns config with default values', () => {
    const config = getDefaultRoyaltyConfig()
    expect(config.rpcUrl).toBeTruthy()
    expect(config.contractAddress).toBeTruthy()
    expect(config.defaultReserveToken).toBeTruthy()
  })
})
