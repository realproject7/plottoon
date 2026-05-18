import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import type { OWSVaultConfig } from './owsAdapter'

export const BASE_CHAIN = 'eip155:8453'

export const STORY_FACTORY_BASE_MAINNET = '0x9D2AE1E99D0A6300bfcCF41A82260374e38744Cf'
export const MCV2_BOND_BASE_MAINNET = '0xc5a076cad94176c2996B32d8466Be1cE757FAa27'

export function validatePublishChain(chain: string): string[] {
  if (chain !== BASE_CHAIN) {
    return [`Live publish requires Base chain (${BASE_CHAIN}), got ${chain}`]
  }
  return []
}

export function loadPlotlinkOwsEnv(envPath?: string): Record<string, string> {
  const candidates = envPath
    ? [envPath]
    : [resolve(homedir(), '.plotlink-ows', '.env'), resolve(homedir(), '.plotlink-ows', 'env')]

  for (const filepath of candidates) {
    if (existsSync(filepath)) {
      return parseEnvFile(readFileSync(filepath, 'utf-8'))
    }
  }

  return {}
}

export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex < 1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    let value = trimmed.slice(eqIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

export function resolveOwsVaultConfig(envOverride?: Record<string, string>): OWSVaultConfig {
  const owsEnv = envOverride ?? loadPlotlinkOwsEnv()

  const vaultPath = process.env.OWS_VAULT_PATH || owsEnv.OWS_VAULT_PATH || undefined
  const passphrase = process.env.OWS_PASSPHRASE || owsEnv.OWS_PASSPHRASE || undefined
  const chain = process.env.OWS_DEFAULT_CHAIN || BASE_CHAIN

  return { vaultPath, passphrase, chain }
}

export function resolvePublishContractDefaults(): {
  storyFactoryAddress: string
  mcv2BondAddress: string
} {
  return {
    storyFactoryAddress: process.env.PLOTLINK_STORY_FACTORY_ADDRESS || STORY_FACTORY_BASE_MAINNET,
    mcv2BondAddress: process.env.MCV2_BOND_ADDRESS || MCV2_BOND_BASE_MAINNET
  }
}
