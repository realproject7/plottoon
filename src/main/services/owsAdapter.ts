import type { OWSVaultEntry, OWSVaultDiscoverFn, OWSWalletCreateFn } from './walletConnection'

export interface OWSCoreModule {
  listWallets(): Promise<Array<{ name: string; address: string }>>
  createWallet(name: string): Promise<{ address: string }>
}

export function createOWSDiscoverFn(module: OWSCoreModule): OWSVaultDiscoverFn {
  return async (): Promise<OWSVaultEntry[]> => {
    const wallets = await module.listWallets()
    return wallets.map((w) => ({ name: w.name, address: w.address }))
  }
}

export function createOWSCreateFn(module: OWSCoreModule): OWSWalletCreateFn {
  return async (name: string): Promise<{ address: string }> => {
    return module.createWallet(name)
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
    async listWallets() {
      const vault = new ows.Vault()
      const wallets = await vault.list()
      return wallets.map((w: { name: string; address: string }) => ({
        name: w.name,
        address: w.address
      }))
    },
    async createWallet(name: string) {
      const vault = new ows.Vault()
      const wallet = await vault.create({ name })
      return { address: wallet.address }
    }
  }
}
