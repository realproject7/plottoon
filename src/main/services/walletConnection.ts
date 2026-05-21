import { redactSecrets } from './actionLog'

export type WalletSource = 'plottoon-writer' | 'plotlink-writer'

export interface WalletMetadata {
  address: string
  source: WalletSource
  name: string
  createdAt: string
}

export interface WalletConnectionOption {
  type: 'create-new' | 'reuse-existing'
  source: WalletSource
  address?: string
  name?: string
  available?: boolean
  unavailableReason?: string
}

export interface WalletConnectionResult {
  success: boolean
  wallet?: WalletMetadata
  error?: string
}

export interface OWSVaultEntry {
  name: string
  address: string
}

export type OWSVaultDiscoverFn = () => Promise<OWSVaultEntry[]>
export type OWSWalletCreateFn = (name: string) => Promise<{ address: string }>

export interface WalletConnectionConfig {
  discoverVault: OWSVaultDiscoverFn
  createWallet: OWSWalletCreateFn
}

const PLOTTOON_WALLET_PREFIX = 'plottoon-writer'
const PLOTLINK_WALLET_PREFIX = 'plotlink-writer'

export async function discoverExistingWallets(
  config: WalletConnectionConfig
): Promise<WalletConnectionOption[]> {
  const entries = await config.discoverVault()
  return entries
    .filter(
      (e) => e.name.startsWith(PLOTLINK_WALLET_PREFIX) || e.name.startsWith(PLOTTOON_WALLET_PREFIX)
    )
    .map((e) => {
      const source: WalletSource = e.name.startsWith(PLOTLINK_WALLET_PREFIX)
        ? 'plotlink-writer'
        : 'plottoon-writer'
      return {
        type: 'reuse-existing' as const,
        source,
        address: e.address,
        name: e.name
      }
    })
}

export async function getConnectionOptions(
  config: WalletConnectionConfig
): Promise<WalletConnectionOption[]> {
  const createOption: WalletConnectionOption = {
    type: 'create-new',
    source: 'plottoon-writer'
  }

  const existing = await discoverExistingWallets(config)
  return [createOption, ...existing]
}

export async function connectWallet(
  option: WalletConnectionOption,
  config: WalletConnectionConfig
): Promise<WalletConnectionResult> {
  if (option.type === 'create-new') {
    const name = `${PLOTTOON_WALLET_PREFIX}-${Date.now()}`
    const { address } = await config.createWallet(name)
    return {
      success: true,
      wallet: {
        address,
        source: 'plottoon-writer',
        name,
        createdAt: new Date().toISOString()
      }
    }
  }

  if (!option.address || !option.name) {
    return { success: false, error: 'Existing wallet requires address and name' }
  }

  return {
    success: true,
    wallet: {
      address: option.address,
      source: option.source,
      name: option.name,
      createdAt: new Date().toISOString()
    }
  }
}

export function walletMetadataIsSafe(wallet: WalletMetadata): boolean {
  const json = JSON.stringify(wallet)
  const secrets = ['private', 'mnemonic', 'seed', 'passphrase', 'secret']
  return !secrets.some((s) => json.toLowerCase().includes(s))
}

const WALLET_SECRET_TERMS = ['private', 'mnemonic', 'seed', 'passphrase', 'secret']

export function sanitizeWalletErrorMessage(message: string): string {
  const lower = message.toLowerCase()
  // Wallet-material terms imply the surrounding text may quote or describe a
  // private key / mnemonic / seed / passphrase. Drop the whole message.
  if (WALLET_SECRET_TERMS.some((s) => lower.includes(s))) {
    return 'Wallet operation failed'
  }
  // Otherwise strip credential-shaped substrings (api_key=..., token=...,
  // Bearer ..., sk-..., xox?-...) using the shared action-log patterns.
  return redactSecrets(message)
}

export function isOwsUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('OWS native module is not available')
}

export function toPublishSignerAddress(wallet: WalletMetadata): string {
  return wallet.address
}

import type {
  PublishTransactionPayload,
  PublishTransactionResult
} from '../../shared/publishTransaction'

export interface AppOwnedSigner {
  sign(message: string): Promise<string>
  sendTransaction(payload: PublishTransactionPayload): Promise<PublishTransactionResult>
  getAddress(): string
}

export type SignFn = (message: string) => Promise<string>
export type TransactionFn = (
  payload: PublishTransactionPayload
) => Promise<PublishTransactionResult>

export function createAppOwnedSigner(
  wallet: WalletMetadata,
  signFn: SignFn,
  transactionFn: TransactionFn
): AppOwnedSigner {
  return {
    sign: signFn,
    sendTransaction: transactionFn,
    getAddress: () => wallet.address
  }
}
