import { ipcMain, type BrowserWindow } from 'electron'
import type { SelectedWalletState } from './walletConnectionHandlers'
import type { WalletSigner } from '../services/walletSigning'
import type {
  PlotlinkPublishDeps,
  PublishFullResult,
  IpfsClient,
  KeccakFn,
  FetchFn,
  PublishConfig
} from '../services/plotlinkPublish'
import {
  realPublish,
  createViemContractEncoder,
  createOWSViemSigner
} from '../services/plotlinkPublish'
import type { OWSCoreModule } from '../services/owsAdapter'
import type { OWSVaultConfig } from '../services/owsAdapter'
import type {
  PublishPreflightResult,
  PublishRequest,
  PublishExecuteResult,
  PublishResultMeta,
  PublishProgress
} from '../../shared/publishFlow'

export interface PublishHandlerDeps {
  walletState: SelectedWalletState
  signer: WalletSigner
  owsModule: OWSCoreModule
  vaultConfig: OWSVaultConfig
  config: PublishConfig
  ipfs: IpfsClient
  keccak: KeccakFn
  fetchFn: FetchFn
  getWindow: () => BrowserWindow | null
}

function sendProgress(deps: PublishHandlerDeps, progress: PublishProgress): void {
  const win = deps.getWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('publish:progress', progress)
  }
}

function buildPlotlinkUrl(
  baseUrl: string,
  storylineId: string | undefined,
  plotIndex: number | undefined,
  action: 'create-storyline' | 'chain-plot'
): string | null {
  if (!storylineId) return null
  if (action === 'create-storyline') {
    return `${baseUrl}/story/${storylineId}`
  }
  if (plotIndex !== undefined) {
    return `${baseUrl}/story/${storylineId}/${plotIndex}`
  }
  return `${baseUrl}/story/${storylineId}`
}

function toResultMeta(
  result: PublishFullResult,
  wallet: { address: string; source: string },
  plotlinkUrl: string | null
): PublishResultMeta {
  return {
    txHash: result.txHash,
    storylineId: result.storylineId ?? null,
    plotIndex: result.plotIndex ?? null,
    contentCid: result.contentCid,
    contentHash: result.contentHash,
    authorAddress: result.authorAddress,
    gasCostWei: result.gasCostWei ?? null,
    plotlinkUrl,
    walletAddress: wallet.address,
    walletSource: wallet.source,
    indexed: result.indexed,
    indexError: result.indexError ?? null,
    publishedAt: new Date().toISOString()
  }
}

function mockPublishResult(request: PublishRequest): PublishResultMeta {
  const mockTxHash = '0x' + 'mock'.repeat(16)
  const mockStorylineId =
    request.action === 'create-storyline' ? '0x' + 'aa'.repeat(32) : (request.storylineId ?? null)
  return {
    txHash: mockTxHash,
    storylineId: mockStorylineId,
    plotIndex: request.action === 'create-storyline' ? 0 : 1,
    contentCid: 'bafymock' + Date.now().toString(36),
    contentHash: '0x' + 'bb'.repeat(32),
    authorAddress: '0x' + '00'.repeat(20),
    gasCostWei: '0',
    plotlinkUrl: null,
    walletAddress: null,
    walletSource: null,
    indexed: true,
    indexError: null,
    publishedAt: new Date().toISOString()
  }
}

export function registerPublishHandlers(deps: PublishHandlerDeps): void {
  ipcMain.handle('publish:preflight', (): PublishPreflightResult => {
    const errors: string[] = []
    const isMock = deps.signer.isMockMode()

    if (!isMock) {
      if (!deps.walletState.wallet) {
        errors.push('No wallet connected')
      }
      if (
        !deps.config.contractAddress ||
        deps.config.contractAddress === '0x0000000000000000000000000000000000000000'
      ) {
        errors.push('PlotLink contract address not configured')
      }
      if (!deps.config.rpcUrl) {
        errors.push('Base RPC URL not configured')
      }
    }

    return {
      ready: errors.length === 0,
      walletAddress: deps.walletState.wallet?.address,
      walletSource: deps.walletState.wallet?.source,
      signerMode: isMock ? 'mock' : 'live',
      errors
    }
  })

  ipcMain.handle(
    'publish:execute',
    async (_event, request: PublishRequest, confirmed: boolean): Promise<PublishExecuteResult> => {
      if (!confirmed) {
        return { success: false, error: 'Publish requires explicit confirmation' }
      }

      const isMock = deps.signer.isMockMode()

      if (isMock) {
        sendProgress(deps, { state: 'uploading', detail: 'Mock: uploading content' })
        sendProgress(deps, { state: 'signing', detail: 'Mock: signing transaction' })
        sendProgress(deps, { state: 'broadcasting', detail: 'Mock: broadcasting' })
        sendProgress(deps, { state: 'confirming', detail: 'Mock: confirming' })
        sendProgress(deps, { state: 'indexing', detail: 'Mock: indexing' })
        const result = mockPublishResult(request)
        sendProgress(deps, { state: 'done', detail: 'Mock publish complete' })
        return { success: true, result }
      }

      const wallet = deps.walletState.wallet
      if (!wallet) {
        return { success: false, error: 'No wallet connected' }
      }

      if (
        !deps.config.contractAddress ||
        deps.config.contractAddress === '0x0000000000000000000000000000000000000000'
      ) {
        return { success: false, error: 'PlotLink contract address not configured' }
      }

      if (!deps.config.rpcUrl) {
        return { success: false, error: 'Base RPC URL not configured' }
      }

      try {
        sendProgress(deps, { state: 'uploading', detail: 'Uploading content to IPFS' })

        const signer = createOWSViemSigner(
          deps.owsModule,
          wallet.name,
          wallet.address,
          deps.vaultConfig.chain,
          deps.vaultConfig.passphrase,
          deps.config.rpcUrl
        )

        const publishDeps: PlotlinkPublishDeps = {
          ows: deps.owsModule,
          signer,
          encoder: createViemContractEncoder(),
          ipfs: deps.ipfs,
          keccak: deps.keccak,
          fetch: deps.fetchFn,
          config: deps.config
        }

        sendProgress(deps, { state: 'signing', detail: 'Signing transaction' })

        const indexMeta =
          request.action === 'create-storyline'
            ? {
                isNsfw: request.isNsfw ?? 'false',
                contentType: request.contentType ?? 'cartoon'
              }
            : { isNsfw: request.isNsfw ?? 'false' }

        sendProgress(deps, { state: 'broadcasting', detail: 'Broadcasting transaction' })

        const fullResult = await realPublish(
          {
            action: request.action,
            title: request.title,
            contentCid: '',
            contentHash: '',
            storylineId: request.storylineId,
            hasDeadline: request.hasDeadline,
            creationFeeWei:
              request.action === 'create-storyline' ? deps.config.creationFeeWei : undefined
          },
          request.markdown,
          wallet.address,
          publishDeps,
          indexMeta
        )

        if (!fullResult.confirmed) {
          sendProgress(deps, { state: 'error', detail: 'Transaction reverted' })
          return { success: false, error: 'Transaction reverted on chain' }
        }

        sendProgress(deps, { state: 'confirming', detail: 'Transaction confirmed' })

        if (!fullResult.indexed) {
          sendProgress(deps, {
            state: 'error',
            detail: fullResult.indexError ?? 'Indexing failed'
          })
        } else {
          sendProgress(deps, { state: 'indexing', detail: 'Indexing on PlotLink' })
        }

        const plotlinkUrl = buildPlotlinkUrl(
          deps.config.plotlinkBaseUrl,
          fullResult.storylineId,
          fullResult.plotIndex,
          request.action
        )

        const resultMeta = toResultMeta(
          fullResult,
          { address: wallet.address, source: wallet.source },
          plotlinkUrl
        )

        sendProgress(deps, {
          state: fullResult.indexed ? 'done' : 'error',
          detail: fullResult.indexed ? 'Published successfully' : 'Published but indexing failed'
        })

        return { success: true, result: resultMeta }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown publish error'
        sendProgress(deps, { state: 'error', detail: message })
        return { success: false, error: message }
      }
    }
  )
}
