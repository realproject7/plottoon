import { createRequire } from 'node:module'
import type { OWSVaultEntry, OWSVaultDiscoverFn, OWSWalletCreateFn } from './walletConnection'

export const OWS_UNAVAILABLE_MESSAGE = 'OWS wallet module is unavailable'

const OWS_CORE_METHODS = ['listWallets', 'createWallet', 'signMessage', 'signTransaction'] as const

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

export function unwrapOwsCoreExports(raw: unknown): OWSCoreModule {
  // electron-vite bundling can wrap CJS exports in one or more layers of
  // `default` / namespace records, sometimes hiding the original native-addon
  // functions behind chains like `{ default: { default: { listWallets, ... } } }`.
  // Walk a small number of `default` layers until we find a layer that exposes
  // the OWS core methods as functions.
  let cur: unknown = raw
  for (let depth = 0; depth < 4; depth++) {
    if (cur && typeof cur === 'object') {
      const candidate = cur as Record<string, unknown>
      if (OWS_CORE_METHODS.every((m) => typeof candidate[m] === 'function')) {
        return candidate as unknown as OWSCoreModule
      }
      const next = candidate.default
      if (next && next !== cur) {
        cur = next
        continue
      }
    }
    break
  }
  throw new Error(OWS_UNAVAILABLE_MESSAGE)
}

export async function createOWSFromCore(
  loader: () => unknown = defaultOwsLoader
): Promise<OWSCoreModule> {
  // @open-wallet-standard/core is a CJS native addon (NAPI-RS). Going through
  // electron-vite's `import()` rewrites the addon export shape and the
  // destructuring inside the package's loader can yield `undefined` for every
  // method. Resolve the package via Node's runtime `createRequire` so the
  // original CJS exports load intact, then defensively unwrap.
  let raw: unknown
  try {
    raw = loader()
  } catch {
    throw new Error(OWS_UNAVAILABLE_MESSAGE)
  }
  const mod = unwrapOwsCoreExports(raw)
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

function defaultOwsLoader(): unknown {
  const requireFn = createRequire(import.meta.url)
  return requireFn('@open-wallet-standard/core')
}
