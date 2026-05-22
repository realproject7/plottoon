import type { OWSCoreModule, OWSVaultConfig } from './owsAdapter'
import { OWS_UNAVAILABLE_MESSAGE } from './owsAdapter'
import { normalizeWalletAddress } from '../../shared/walletIdentity'

/**
 * Result of a pre-signing vault freshness check.
 *
 * `ok: true` means the active wallet's OWS name/id is still present in the
 * configured vault and signing can proceed. `ok: false` means the renderer
 * should surface `error` to the user — never the underlying OWS message,
 * never a vault path.
 */
export interface VaultFreshnessResult {
  ok: boolean
  error?: string
}

const STALE_WALLET_USER_MESSAGE =
  'The active wallet is no longer available. Reconnect or switch wallets to continue.'

/**
 * Verify that the active wallet's OWS identifier (name and id) still exists
 * in the configured vault, *before* constructing a live signer. This is the
 * #235 guard: a wallet that was persisted in the identity store may have
 * since been deleted, renamed, or come from a different vault. Without this
 * check, the renderer would proceed all the way to `signMessage` /
 * `signTransaction` before failing — sometimes mid-publish.
 *
 * Error messages are deliberately generic so we don't leak the OWS internal
 * name, the wallet id, or the vault path through error UI / logs.
 */
export function checkActiveWalletInVault(
  owsModule: Pick<OWSCoreModule, 'listWallets'>,
  vaultConfig: Pick<OWSVaultConfig, 'vaultPath'>,
  activeWallet: { name: string; address: string } | null
): VaultFreshnessResult {
  if (!activeWallet) {
    // The caller already has the no-active-wallet check it cares about
    // (publish: "No wallet connected"; royalty: same); we just don't
    // overwrite their message.
    return { ok: true }
  }

  let entries: ReturnType<OWSCoreModule['listWallets']>
  try {
    entries = owsModule.listWallets(vaultConfig.vaultPath)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // OWS module unavailable / vault not readable. Surface the canonical
    // sentinel; the renderer already treats this as "wallet features
    // disabled" and the publish path validates separately.
    if (message.includes(OWS_UNAVAILABLE_MESSAGE)) {
      return { ok: false, error: OWS_UNAVAILABLE_MESSAGE }
    }
    return { ok: false, error: STALE_WALLET_USER_MESSAGE }
  }

  // #240: require BOTH a name match AND an EVM account whose normalized
  // address equals the active wallet's address. A same-name/different-
  // address vault entry would otherwise pass freshness — and signing would
  // use a different key than the metadata shown to the user. The error
  // is the same generic stale message either way so we don't leak
  // whether the failure is "name missing" vs "address mismatch" vs
  // "wrong chain family".
  //
  // #240 RE1: the account must specifically be EVM. OWS uses CAIP-2
  // identifiers, so we check `chainId.startsWith('eip155:')` (same
  // convention as `owsAdapter`). A same-name vault entry that happened
  // to carry a non-EVM account with the same address string (e.g.
  // `chainId: 'solana:mainnet'`) would otherwise pass and signing
  // would dispatch to a chain family the user never intended.
  const wantedAddress = normalizeWalletAddress(activeWallet.address)
  const matches = entries.some((entry) => {
    if (entry.name !== activeWallet.name) return false
    if (entry.id === undefined) return false
    const accounts = Array.isArray(entry.accounts) ? entry.accounts : []
    return accounts.some(
      (account) =>
        typeof account?.chainId === 'string' &&
        account.chainId.startsWith('eip155:') &&
        typeof account?.address === 'string' &&
        normalizeWalletAddress(account.address) === wantedAddress
    )
  })
  if (!matches) {
    return { ok: false, error: STALE_WALLET_USER_MESSAGE }
  }
  return { ok: true }
}
