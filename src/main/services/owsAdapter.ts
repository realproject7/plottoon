import type { OWSVaultEntry, OWSVaultDiscoverFn, OWSWalletCreateFn } from './walletConnection'

export interface OWSCoreModule {
  listWallets(): Promise<Array<{ name: string; address: string }>>
  createWallet(name: string): Promise<{ address: string }>
}

export function createOWSDiscoverFn(ows: OWSCoreModule): OWSVaultDiscoverFn {
  return async (): Promise<OWSVaultEntry[]> => {
    const wallets = await ows.listWallets()
    return wallets.map((w) => ({ name: w.name, address: w.address }))
  }
}

export function createOWSCreateFn(ows: OWSCoreModule): OWSWalletCreateFn {
  return async (name: string): Promise<{ address: string }> => {
    return ows.createWallet(name)
  }
}

export function createOWSConfig(ows: OWSCoreModule) {
  return {
    discoverVault: createOWSDiscoverFn(ows),
    createWallet: createOWSCreateFn(ows)
  }
}
