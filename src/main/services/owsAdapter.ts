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
    passphrase?: string | null
  ): OWSSignResult
  signTransaction(
    wallet: string,
    chain: string,
    txHex: string,
    passphrase?: string | null
  ): OWSSignResult
}

function extractEvmAddress(accounts: OWSAccountInfo[]): string | undefined {
  const evm = accounts.find((a) => a.chainId.startsWith('eip155:'))
  return evm?.address
}

export function createOWSDiscoverFn(module: OWSCoreModule): OWSVaultDiscoverFn {
  return async (): Promise<OWSVaultEntry[]> => {
    const wallets = module.listWallets()
    return wallets
      .map((w) => {
        const address = extractEvmAddress(w.accounts)
        if (!address) return null
        return { name: w.name, address }
      })
      .filter((e): e is OWSVaultEntry => e !== null)
  }
}

export function createOWSCreateFn(module: OWSCoreModule): OWSWalletCreateFn {
  return async (name: string): Promise<{ address: string }> => {
    const wallet = module.createWallet(name)
    const address = extractEvmAddress(wallet.accounts)
    if (!address) {
      throw new Error('Created wallet has no EVM account')
    }
    return { address }
  }
}

export function createOWSConfig(module: OWSCoreModule) {
  return {
    discoverVault: createOWSDiscoverFn(module),
    createWallet: createOWSCreateFn(module)
  }
}

export async function createOWSFromCore(): Promise<OWSCoreModule> {
  const ows = await import('@open-wallet-standard/core')
  return {
    listWallets(vaultPath?: string) {
      return ows.listWallets(vaultPath)
    },
    createWallet(
      name: string,
      passphrase?: string | null,
      words?: number | null,
      vaultPath?: string | null
    ) {
      return ows.createWallet(name, passphrase, words, vaultPath)
    },
    signMessage(wallet: string, chain: string, message: string, passphrase?: string | null) {
      return ows.signMessage(wallet, chain, message, passphrase)
    },
    signTransaction(wallet: string, chain: string, txHex: string, passphrase?: string | null) {
      return ows.signTransaction(wallet, chain, txHex, passphrase)
    }
  }
}
