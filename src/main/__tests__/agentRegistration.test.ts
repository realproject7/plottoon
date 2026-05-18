import { describe, it, expect } from 'vitest'
import {
  buildOwnerBindingMessage,
  getDefaultAgentRegistrationConfig
} from '../services/agentRegistration'

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
