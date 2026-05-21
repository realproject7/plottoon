import type { OWSVaultEntry, OWSVaultDiscoverFn, OWSWalletCreateFn } from './walletConnection'

export interface OWSAccountInfo {
  chainId: string
  address: string
  derivationPath: string
}

export interface OWSWalletInfo {
  id: string
  name: string
  accounts: OWSAccountInfo[]
  createdAt: string
}

export interface OWSSignResult {
  signature: string
  recoveryId?: number
}

export interface OWSCoreModule {
  listWallets(vaultPath?: string): OWSWalletInfo[]
  createWallet(
    name: string,
    passphrase?: string | null,
    words?: number | null,
    vaultPath?: string | null
  ): OWSWalletInfo
  signMessage(
    wallet: string,
    chain: string,
    message: string,
    passphrase?: string | null,
    encoding?: string | null,
    index?: number | null,
    vaultPath?: string | null
  ): OWSSignResult
  signTransaction(
    wallet: string,
    chain: string,
    txHex: string,
    passphrase?: string | null,
    index?: number | null,
    vaultPath?: string | null
  ): OWSSignResult
}

export interface OWSVaultConfig {
  vaultPath?: string
  passphrase?: string
  chain: string
}

const DEFAULT_VAULT_CONFIG: OWSVaultConfig = {
  chain: 'eip155:1'
}

function extractEvmAddress(accounts: OWSAccountInfo[]): string | undefined {
  const evm = accounts.find((a) => a.chainId.startsWith('eip155:'))
  return evm?.address
}

export function createOWSDiscoverFn(
  module: OWSCoreModule,
  vaultConfig: OWSVaultConfig = DEFAULT_VAULT_CONFIG
): OWSVaultDiscoverFn {
  return async (): Promise<OWSVaultEntry[]> => {
    const wallets = module.listWallets(vaultConfig.vaultPath)
    return wallets
      .map((w) => {
        const address = extractEvmAddress(w.accounts)
        if (!address) return null
        return { name: w.name, address }
      })
      .filter((e): e is OWSVaultEntry => e !== null)
  }
}

export function createOWSCreateFn(
  module: OWSCoreModule,
  vaultConfig: OWSVaultConfig = DEFAULT_VAULT_CONFIG
): OWSWalletCreateFn {
  return async (name: string): Promise<{ address: string }> => {
    const wallet = module.createWallet(
      name,
      vaultConfig.passphrase ?? null,
      null,
      vaultConfig.vaultPath ?? null
    )
    const address = extractEvmAddress(wallet.accounts)
    if (!address) {
      throw new Error('Created wallet has no EVM account')
    }
    return { address }
  }
}

export function createOWSSignMessageFn(
  module: OWSCoreModule,
  vaultConfig: OWSVaultConfig = DEFAULT_VAULT_CONFIG
) {
  return (walletName: string, message: string): OWSSignResult => {
    return module.signMessage(
      walletName,
      vaultConfig.chain,
      message,
      vaultConfig.passphrase ?? null,
      null,
      null,
      vaultConfig.vaultPath ?? null
    )
  }
}

export function createOWSSignTransactionFn(
  module: OWSCoreModule,
  vaultConfig: OWSVaultConfig = DEFAULT_VAULT_CONFIG
) {
  return (walletName: string, txHex: string): OWSSignResult => {
    return module.signTransaction(
      walletName,
      vaultConfig.chain,
      txHex,
      vaultConfig.passphrase ?? null,
      null,
      vaultConfig.vaultPath ?? null
    )
  }
}

export function createOWSConfig(
  module: OWSCoreModule,
  vaultConfig: OWSVaultConfig = DEFAULT_VAULT_CONFIG
) {
  return {
    discoverVault: createOWSDiscoverFn(module, vaultConfig),
    createWallet: createOWSCreateFn(module, vaultConfig),
    signMessage: createOWSSignMessageFn(module, vaultConfig),
    signTransaction: createOWSSignTransactionFn(module, vaultConfig)
  }
}

export async function createOWSFromCore(): Promise<OWSCoreModule> {
  // @open-wallet-standard/core is a CJS native addon (NAPI-RS).
  // Dynamic import of CJS wraps exports as { default: { listWallets, ... } }.
  const imported = await import('@open-wallet-standard/core')
  const ows = (imported as { default?: Record<string, unknown> }).default ?? imported
  const mod = ows as unknown as OWSCoreModule
  return {
    listWallets(vaultPath?: string) {
      return mod.listWallets(vaultPath)
    },
    createWallet(
      name: string,
      passphrase?: string | null,
      words?: number | null,
      vaultPath?: string | null
    ) {
      return mod.createWallet(name, passphrase, words, vaultPath)
    },
    signMessage(
      wallet: string,
      chain: string,
      message: string,
      passphrase?: string | null,
      encoding?: string | null,
      index?: number | null,
      vaultPath?: string | null
    ) {
      return mod.signMessage(wallet, chain, message, passphrase, encoding, index, vaultPath)
    },
    signTransaction(
      wallet: string,
      chain: string,
      txHex: string,
      passphrase?: string | null,
      index?: number | null,
      vaultPath?: string | null
    ) {
      return mod.signTransaction(wallet, chain, txHex, passphrase, index, vaultPath)
    }
  }
}
