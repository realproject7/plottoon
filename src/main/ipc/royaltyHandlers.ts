import { ipcMain, type BrowserWindow } from 'electron'
import type { SelectedWalletState } from './walletConnectionHandlers'
import type { OWSCoreModule, OWSVaultConfig } from '../services/owsAdapter'
import {
  readRoyaltyInfo,
  executeRoyaltyClaim,
  type RoyaltyClaimConfig
} from '../services/royaltyClaim'
import { appendClaimRecord, readClaimHistory } from '../services/royaltyClaimStatus'
import type {
  RoyaltyInfo,
  RoyaltyClaimResult,
  RoyaltyClaimProgress
} from '../../shared/royaltyFlow'

export interface RoyaltyHandlerDeps {
  walletState: SelectedWalletState
  owsModule: OWSCoreModule
  vaultConfig: OWSVaultConfig
  royaltyConfig: RoyaltyClaimConfig
  signerMode: 'live' | 'mock'
  getWindow: () => BrowserWindow | null
}

function sendProgress(deps: RoyaltyHandlerDeps, progress: RoyaltyClaimProgress): void {
  const win = deps.getWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('royalty:progress', progress)
  }
}

export function registerRoyaltyHandlers(deps: RoyaltyHandlerDeps): void {
  ipcMain.handle(
    'royalty:info',
    async (): Promise<{ info: RoyaltyInfo | null; error: string | null }> => {
      const wallet = deps.walletState.wallet
      if (!wallet) return { info: null, error: null }

      const reserveToken = deps.royaltyConfig.defaultReserveToken
      if (!reserveToken || reserveToken === '0x0000000000000000000000000000000000000000') {
        return { info: null, error: null }
      }

      if (deps.signerMode === 'mock') {
        return {
          info: {
            earnedWei: '0',
            claimedWei: '0',
            unclaimedWei: '0',
            reserveToken
          },
          error: null
        }
      }

      try {
        const info = await readRoyaltyInfo(wallet.address, reserveToken, {
          config: deps.royaltyConfig
        })
        return { info, error: null }
      } catch (err) {
        return {
          info: null,
          error: err instanceof Error ? err.message : 'Failed to read royalty info'
        }
      }
    }
  )

  ipcMain.handle(
    'royalty:claim',
    async (_event, confirmed: boolean): Promise<RoyaltyClaimResult> => {
      if (!confirmed) {
        return { success: false, error: 'Claim requires explicit confirmation' }
      }

      const wallet = deps.walletState.wallet
      if (!wallet) {
        return { success: false, error: 'No wallet connected' }
      }

      const reserveToken = deps.royaltyConfig.defaultReserveToken
      if (!reserveToken || reserveToken === '0x0000000000000000000000000000000000000000') {
        return { success: false, error: 'Reserve token not configured' }
      }

      if (deps.signerMode === 'mock') {
        sendProgress(deps, { state: 'preparing', detail: 'Mock: preparing claim' })
        sendProgress(deps, { state: 'signing', detail: 'Mock: signing' })
        sendProgress(deps, { state: 'broadcasting', detail: 'Mock: broadcasting' })
        sendProgress(deps, { state: 'confirming', detail: 'Mock: confirming' })
        sendProgress(deps, { state: 'done', detail: 'Mock claim complete' })

        const mockTxHash = '0x' + 'mock'.repeat(16)
        await appendClaimRecord({
          txHash: mockTxHash,
          walletAddress: wallet.address,
          reserveToken,
          gasCostWei: '0',
          status: 'confirmed',
          error: null,
          claimedAt: new Date().toISOString()
        })

        return { success: true, txHash: mockTxHash, gasCostWei: '0' }
      }

      try {
        const result = await executeRoyaltyClaim(reserveToken, {
          config: deps.royaltyConfig,
          ows: deps.owsModule,
          walletName: wallet.name,
          walletAddress: wallet.address,
          chain: deps.vaultConfig.chain,
          passphrase: deps.vaultConfig.passphrase,
          onProgress: (state, detail) =>
            sendProgress(deps, { state: state as RoyaltyClaimProgress['state'], detail })
        })

        await appendClaimRecord({
          txHash: result.txHash ?? '',
          walletAddress: wallet.address,
          reserveToken,
          gasCostWei: result.gasCostWei ?? null,
          status: result.success ? 'confirmed' : 'failed',
          error: result.error ?? null,
          claimedAt: new Date().toISOString()
        })

        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown claim error'
        sendProgress(deps, { state: 'error', detail: message })

        await appendClaimRecord({
          txHash: '',
          walletAddress: wallet.address,
          reserveToken,
          gasCostWei: null,
          status: 'failed',
          error: message,
          claimedAt: new Date().toISOString()
        }).catch(() => {})

        return { success: false, error: message }
      }
    }
  )

  ipcMain.handle('royalty:claimHistory', async () => {
    return readClaimHistory()
  })
}
