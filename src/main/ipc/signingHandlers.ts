import { ipcMain } from 'electron'
import type { WalletSigner } from '../services/walletSigning'

export function registerSigningHandlers(signer: WalletSigner): void {
  ipcMain.handle('wallet:requestSignature', async (_event, message: string) => {
    if (typeof message !== 'string' || message.length === 0) {
      return { error: 'Message must be a non-empty string' }
    }

    try {
      const result = await signer.requestSignature({
        message,
        requireConfirmation: !signer.isMockMode()
      })
      return { signature: result.signature, timestamp: result.timestamp }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Signing failed'
      return { error: errorMessage }
    }
  })

  ipcMain.handle('wallet:getMode', () => {
    return { mode: signer.isMockMode() ? 'mock' : 'live' }
  })
}
