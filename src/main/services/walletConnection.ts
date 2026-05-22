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

/**
 * Renderer-facing projection of `WalletConnectionOption`. The OWS internal
 * name is stripped — it is a signing selector and must stay in the main
 * process per the #218/#234/#239 boundary. The renderer identifies a
 * reuse-existing option by `address`; the main process re-resolves the
 * OWS name from the vault at connect time.
 */
export interface WalletConnectionOptionView {
  type: 'create-new' | 'reuse-existing'
  source: WalletSource
  address?: string
  available?: boolean
  unavailableReason?: string
}

export function toWalletConnectionOptionView(
  option: WalletConnectionOption
): WalletConnectionOptionView {
  return {
    type: option.type,
    source: option.source,
    address: option.address,
    available: option.available,
    unavailableReason: option.unavailableReason
  }
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

/**
 * #239: connect-time resolver. The renderer no longer carries the OWS
 * internal name for a reuse-existing option — it sends back only the
 * address. The main process re-resolves the full option (including
 * `name`) here by re-discovering the vault and matching on address.
 *
 * #239 RE1 finding: the resolver MUST search in the same filtered set
 * `wallet:getOptions` exposes — writer-prefix names only. Otherwise a
 * renderer could bypass the option list and connect to an arbitrary
 * unrelated OWS wallet by address, stamped as a writer source. We
 * delegate to `discoverExistingWallets` so the prefix filter + source
 * mapping run exactly once and are guaranteed identical to discovery.
 */
export async function resolveReuseExistingOption(
  view: WalletConnectionOptionView,
  config: WalletConnectionConfig
): Promise<WalletConnectionOption | null> {
  if (view.type !== 'reuse-existing') return null
  if (!view.address) return null
  const wantedAddress = view.address.toLowerCase()
  const recognized = await discoverExistingWallets(config)
  const match = recognized.find((opt) => (opt.address ?? '').toLowerCase() === wantedAddress)
  return match ?? null
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

// Patterns that indicate OWS is unavailable. The canonical sentinel is
// 'OWS wallet module is unavailable' (see owsAdapter.OWS_UNAVAILABLE_MESSAGE).
// The legacy 'OWS native module is not available' string is retained for
// backward compatibility with any catch-site or test fixture that still uses
// the older wording.
const OWS_UNAVAILABLE_PATTERNS = [
  'OWS wallet module is unavailable',
  'OWS native module is not available'
]

// Bundler-internal shapes that should be treated as "OWS unavailable" so we
// never surface variable names like `mod2.listWallets` to the UI.
const BUNDLER_LEAK_PATTERNS = [
  /\bmod\d*\.\w+ is not a function\b/i,
  /\b(?:listWallets|createWallet|signMessage|signTransaction) is not a function\b/i
]

export function isOwsUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  if (OWS_UNAVAILABLE_PATTERNS.some((s) => message.includes(s))) return true
  return BUNDLER_LEAK_PATTERNS.some((re) => re.test(message))
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
