import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  parseEnvFile,
  resolveOwsVaultConfig,
  resolvePublishContractDefaults,
  validatePublishChain,
  BASE_CHAIN,
  STORY_FACTORY_BASE_MAINNET,
  MCV2_BOND_BASE_MAINNET
} from '../services/owsRuntimeConfig'

describe('parseEnvFile', () => {
  it('parses KEY=VALUE lines', () => {
    const result = parseEnvFile('FOO=bar\nBAZ=qux')
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })

  it('strips double quotes from values', () => {
    const result = parseEnvFile('KEY="value"')
    expect(result).toEqual({ KEY: 'value' })
  })

  it('strips single quotes from values', () => {
    const result = parseEnvFile("KEY='value'")
    expect(result).toEqual({ KEY: 'value' })
  })

  it('ignores comments and blank lines', () => {
    const result = parseEnvFile('# comment\n\nKEY=val\n  # another comment')
    expect(result).toEqual({ KEY: 'val' })
  })

  it('handles values with equals signs', () => {
    const result = parseEnvFile('URL=https://rpc.example?key=abc')
    expect(result).toEqual({ URL: 'https://rpc.example?key=abc' })
  })
})

describe('resolveOwsVaultConfig', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.OWS_VAULT_PATH
    delete process.env.OWS_PASSPHRASE
    delete process.env.OWS_DEFAULT_CHAIN
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('defaults chain to Base eip155:8453', () => {
    const config = resolveOwsVaultConfig({})
    expect(config.chain).toBe('eip155:8453')
  })

  it('process env takes precedence over plotlink-ows env', () => {
    process.env.OWS_VAULT_PATH = '/from/process'
    process.env.OWS_PASSPHRASE = 'process-pass'

    const config = resolveOwsVaultConfig({
      OWS_VAULT_PATH: '/from/plotlink-ows',
      OWS_PASSPHRASE: 'ows-pass'
    })

    expect(config.vaultPath).toBe('/from/process')
    expect(config.passphrase).toBe('process-pass')
  })

  it('falls back to plotlink-ows env when process env is empty', () => {
    const config = resolveOwsVaultConfig({
      OWS_VAULT_PATH: '/home/user/.plotlink-ows/vault',
      OWS_PASSPHRASE: 'ows-pass'
    })

    expect(config.vaultPath).toBe('/home/user/.plotlink-ows/vault')
    expect(config.passphrase).toBe('ows-pass')
  })

  it('returns undefined for vaultPath and passphrase when no source provides them', () => {
    const config = resolveOwsVaultConfig({})
    expect(config.vaultPath).toBeUndefined()
    expect(config.passphrase).toBeUndefined()
  })

  it('process env OWS_DEFAULT_CHAIN overrides Base default', () => {
    process.env.OWS_DEFAULT_CHAIN = 'eip155:1'
    const config = resolveOwsVaultConfig({})
    expect(config.chain).toBe('eip155:1')
  })
})

describe('validatePublishChain', () => {
  it('returns no errors for Base chain eip155:8453', () => {
    expect(validatePublishChain('eip155:8453')).toEqual([])
  })

  it('rejects non-Base chain', () => {
    const errors = validatePublishChain('eip155:1')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('eip155:8453')
    expect(errors[0]).toContain('eip155:1')
  })

  it('rejects empty chain string', () => {
    const errors = validatePublishChain('')
    expect(errors).toHaveLength(1)
  })
})

describe('resolvePublishContractDefaults', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.PLOTLINK_STORY_FACTORY_ADDRESS
    delete process.env.MCV2_BOND_ADDRESS
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('defaults to production PlotLink contract addresses', () => {
    const contracts = resolvePublishContractDefaults()
    expect(contracts.storyFactoryAddress).toBe(STORY_FACTORY_BASE_MAINNET)
    expect(contracts.mcv2BondAddress).toBe(MCV2_BOND_BASE_MAINNET)
  })

  it('env override takes precedence', () => {
    process.env.PLOTLINK_STORY_FACTORY_ADDRESS = '0xcustom1'
    process.env.MCV2_BOND_ADDRESS = '0xcustom2'

    const contracts = resolvePublishContractDefaults()
    expect(contracts.storyFactoryAddress).toBe('0xcustom1')
    expect(contracts.mcv2BondAddress).toBe('0xcustom2')
  })
})

describe('production contract address parity with plotlink-ows', () => {
  it('STORY_FACTORY_BASE_MAINNET matches plotlink-ows production', () => {
    expect(STORY_FACTORY_BASE_MAINNET).toBe('0x9D2AE1E99D0A6300bfcCF41A82260374e38744Cf')
  })

  it('MCV2_BOND_BASE_MAINNET matches plotlink-ows production', () => {
    expect(MCV2_BOND_BASE_MAINNET).toBe('0xc5a076cad94176c2996B32d8466Be1cE757FAa27')
  })

  it('BASE_CHAIN is eip155:8453', () => {
    expect(BASE_CHAIN).toBe('eip155:8453')
  })

  it('addresses are valid 20-byte hex', () => {
    expect(STORY_FACTORY_BASE_MAINNET).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(MCV2_BOND_BASE_MAINNET).toMatch(/^0x[0-9a-fA-F]{40}$/)
  })
})
