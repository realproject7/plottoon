import { ipcMain } from 'electron'
import type {
  WalletConnectionConfig,
  WalletConnectionOption,
  WalletConnectionOptionView,
  WalletMetadata
} from '../services/walletConnection'
import {
  getConnectionOptions,
  connectWallet,
  resolveReuseExistingOption,
  toWalletConnectionOptionView,
  walletMetadataIsSafe,
  sanitizeWalletErrorMessage,
  isOwsUnavailableError
} from '../services/walletConnection'
import { OWS_UNAVAILABLE_MESSAGE } from '../services/owsAdapter'
import type { WalletSigner } from '../services/walletSigning'
import type { WalletIdentityStore } from '../services/walletIdentityStore'
import { normalizeWalletAddress } from '../../shared/walletIdentity'

export interface SelectedWalletState {
  wallet: WalletMetadata | null
}

export function registerWalletConnectionHandlers(
  config: WalletConnectionConfig,
  state: SelectedWalletState,
  signer: WalletSigner,
  identityStore?: WalletIdentityStore
) {
  ipcMain.handle('wallet:getOptions', async () => {
    try {
      const options = await getConnectionOptions(config)
      // #245: drop reuse-existing options whose address is already a known
      // identity. The renderer already lists those wallets under "Switch
      // wallet"; surfacing them again as "Reuse 0x…" is confusing and the
      // click is a silent no-op (re-registers / reselects the same wallet).
      // Address normalization uses the same `normalizeWalletAddress` the
      // identity store keys identities by, so checksum/case mismatches
      // between OWS vault and the registry don't produce duplicates.
      const known = identityStore ? await identityStore.list() : []
      const knownAddresses = new Set(known.map((i) => normalizeWalletAddress(i.address)))
      const filtered = options.filter((opt) => {
        if (opt.type !== 'reuse-existing') return true
        if (!opt.address) return true
        return !knownAddresses.has(normalizeWalletAddress(opt.address))
      })
      // #239: strip OWS internal names before serializing to the renderer.
      // Reuse-existing options keep `address` as their renderer-side
      // identifier; the main process re-resolves the OWS name from the
      // vault at connect time.
      return { options: filtered.map(toWalletConnectionOptionView) }
    } catch (err) {
      const unavailable = isOwsUnavailableError(err)
      const reason = unavailable
        ? OWS_UNAVAILABLE_MESSAGE
        : sanitizeWalletErrorMessage(err instanceof Error ? err.message : 'Wallet discovery failed')
      return {
        options: [
          {
            type: 'create-new' as const,
            source: 'plottoon-writer' as const,
            available: false,
            unavailableReason: reason
          }
        ] satisfies WalletConnectionOptionView[]
      }
    }
  })

  ipcMain.handle('wallet:connect', async (_event, optionView: WalletConnectionOptionView) => {
    if (optionView.available === false) {
      return {
        success: false,
        error: optionView.unavailableReason ?? 'Wallet option is not available'
      }
    }
    // #239: the renderer no longer sends the OWS internal name. For a
    // reuse-existing option we re-discover the vault and match by address;
    // for create-new the internal `connectWallet` mints a fresh name.
    let option: WalletConnectionOption
    if (optionView.type === 'create-new') {
      option = {
        type: 'create-new',
        source: optionView.source
      }
    } else {
      const resolved = await resolveReuseExistingOption(optionView, config).catch(() => null)
      if (!resolved) {
        return { success: false, error: 'Wallet option is no longer available' }
      }
      option = resolved
    }
    try {
      const result = await connectWallet(option, config)
      if (result.success && result.wallet) {
        if (!walletMetadataIsSafe(result.wallet)) {
          return { success: false, error: 'Wallet metadata contains unsafe content' }
        }
        state.wallet = result.wallet
        // Persist the connected wallet as a known identity and mark it active
        // so the selection survives a restart. The store normalizes the
        // address; existing identities at the same address are updated in
        // place, preserving their original registeredAt.
        if (identityStore) {
          const persisted = await identityStore.register({
            address: result.wallet.address,
            source: result.wallet.source,
            owsName: result.wallet.name,
            registeredAt: result.wallet.createdAt
          })
          await identityStore.setActive(persisted.address)
        }
        // #234: project the connected wallet to non-signing metadata only.
        // `result.wallet.name` is the OWS internal selector and must stay
        // in the main process for signing — never echoed to the renderer.
        return {
          success: true,
          wallet: {
            address: result.wallet.address,
            source: result.wallet.source
          }
        }
      }
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Wallet connection failed'
      return { success: false, error: sanitizeWalletErrorMessage(message) }
    }
  })

  ipcMain.handle('wallet:getConnected', () => {
    if (!state.wallet) {
      return { connected: false }
    }
    // #234: never project the OWS internal name through this IPC. The
    // renderer only needs non-signing metadata (address + source); the
    // main process still keeps `state.wallet.name` for publish, royalty,
    // and agent registration signing.
    return {
      connected: true,
      address: state.wallet.address,
      source: state.wallet.source
    }
  })

  ipcMain.handle('wallet:disconnect', async () => {
    state.wallet = null
    if (identityStore) {
      // Disconnect clears the in-memory selection without erasing the
      // registry of known identities — the user can re-pick one later via
      // wallet:identity:setActive without going through OWS discovery again.
      await identityStore.clearActive()
    }
    return { success: true }
  })

  ipcMain.handle('wallet:getSignerMode', () => {
    return { mode: signer.isMockMode() ? 'mock' : 'live' }
  })
}

export function createSelectedWalletState(): SelectedWalletState {
  return { wallet: null }
}
