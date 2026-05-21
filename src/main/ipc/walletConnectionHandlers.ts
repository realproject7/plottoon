import { ipcMain } from 'electron'
import type {
  WalletConnectionConfig,
  WalletConnectionOption,
  WalletMetadata
} from '../services/walletConnection'
import {
  getConnectionOptions,
  connectWallet,
  walletMetadataIsSafe,
  sanitizeWalletErrorMessage,
  isOwsUnavailableError
} from '../services/walletConnection'
import { OWS_UNAVAILABLE_MESSAGE } from '../services/owsAdapter'
import type { WalletSigner } from '../services/walletSigning'

export interface SelectedWalletState {
  wallet: WalletMetadata | null
}

export function registerWalletConnectionHandlers(
  config: WalletConnectionConfig,
  state: SelectedWalletState,
  signer: WalletSigner
) {
  ipcMain.handle('wallet:getOptions', async () => {
    try {
      const options = await getConnectionOptions(config)
      return { options }
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
        ]
      }
    }
  })

  ipcMain.handle('wallet:connect', async (_event, option: WalletConnectionOption) => {
    if (option.available === false) {
      return {
        success: false,
        error: option.unavailableReason ?? 'Wallet option is not available'
      }
    }
    try {
      const result = await connectWallet(option, config)
      if (result.success && result.wallet) {
        if (!walletMetadataIsSafe(result.wallet)) {
          return { success: false, error: 'Wallet metadata contains unsafe content' }
        }
        state.wallet = result.wallet
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
    return {
      connected: true,
      address: state.wallet.address,
      source: state.wallet.source,
      name: state.wallet.name
    }
  })

  ipcMain.handle('wallet:disconnect', () => {
    state.wallet = null
    return { success: true }
  })

  ipcMain.handle('wallet:getSignerMode', () => {
    return { mode: signer.isMockMode() ? 'mock' : 'live' }
  })
}

export function createSelectedWalletState(): SelectedWalletState {
  return { wallet: null }
}
