import { ipcMain } from 'electron'
import type {
  WalletConnectionConfig,
  WalletConnectionOption,
  WalletMetadata
} from '../services/walletConnection'
import {
  getConnectionOptions,
  connectWallet,
  walletMetadataIsSafe
} from '../services/walletConnection'
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
    } catch {
      // OWS unavailable — return only the create-new option so the UI is still usable
      return { options: [{ type: 'create-new' as const, source: 'plottoon-writer' as const }] }
    }
  })

  ipcMain.handle('wallet:connect', async (_event, option: WalletConnectionOption) => {
    const result = await connectWallet(option, config)
    if (result.success && result.wallet) {
      if (!walletMetadataIsSafe(result.wallet)) {
        return { success: false, error: 'Wallet metadata contains unsafe content' }
      }
      state.wallet = result.wallet
    }
    return result
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
