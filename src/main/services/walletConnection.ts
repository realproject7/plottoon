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
    .filter((e) => e.name.startsWith(PLOTLINK_WALLET_PREFIX))
    .map((e) => ({
      type: 'reuse-existing' as const,
      source: 'plotlink-writer' as WalletSource,
      address: e.address,
      name: e.name
    }))
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

export function toPublishSignerAddress(wallet: WalletMetadata): string {
  return wallet.address
}

export interface AppOwnedSigner {
  sign(message: string): Promise<string>
  sendTransaction(payload: {
    action: 'create-storyline' | 'chain-plot'
    storylineId?: string
    title: string
    contentCid: string
    contentHash: string
  }): Promise<{ txHash: string; confirmed: boolean }>
  getAddress(): string
}

export type SignFn = (message: string) => Promise<string>
export type TransactionFn = (payload: {
  action: 'create-storyline' | 'chain-plot'
  storylineId?: string
  title: string
  contentCid: string
  contentHash: string
}) => Promise<{ txHash: string; confirmed: boolean }>

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
