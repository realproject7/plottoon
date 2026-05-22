import { ipcMain, type BrowserWindow } from 'electron'
import type { SelectedWalletState } from './walletConnectionHandlers'
import type { WalletSigner } from '../services/walletSigning'
import { readProjectMeta } from '../services/projectMeta'
import { getProjectRoot } from '../services/projectRegistry'
import { normalizeWalletAddress } from '../../shared/walletIdentity'
import { checkActiveWalletInVault } from '../services/walletVaultCheck'
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
  createOWSViemSigner,
  validatePublishConfig,
  fetchCreationFee
} from '../services/plotlinkPublish'
import { validatePublishChain } from '../services/owsRuntimeConfig'
import type { OWSCoreModule, OWSVaultConfig } from '../services/owsAdapter'
import type {
  PublishPreflightResult,
  PublishRequest,
  PublishExecuteResult,
  PublishResultMeta,
  PublishProgress
} from '../../shared/publishFlow'
import {
  readPublishStatus,
  writePublishStatus,
  createPublishStatus,
  markPlotPublished,
  markPublishedNotIndexed,
  markPlotFailed,
  setPlotState,
  type PublishResultRecord
} from '../services/publishStatus'
import {
  checkRetryContentEligibility,
  selectIndexEndpoint,
  buildIndexBody,
  retryIndex,
  markManualNotIndexed
} from '../services/indexRecovery'

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
  resolvePlotDir: (projectId: string, plotSlug: string) => Promise<string>
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

function toResultRecord(
  result: PublishFullResult,
  wallet: { address: string; source: string },
  plotlinkUrl: string | null,
  publishAction: 'create-storyline' | 'chain-plot'
): PublishResultRecord {
  return {
    txHash: result.txHash,
    storylineId: result.storylineId ?? null,
    plotIndex: result.plotIndex ?? null,
    contentCid: result.contentCid,
    contentHash: result.contentHash,
    authorAddress: result.authorAddress,
    gasCostWei: result.gasCostWei ?? null,
    totalCostWei: result.totalCostWei ?? null,
    plotlinkUrl,
    walletAddress: wallet.address,
    walletSource: wallet.source,
    indexed: result.indexed,
    indexError: result.indexError ?? null,
    publishAction
  }
}

function toResultMeta(record: PublishResultRecord): PublishResultMeta {
  return {
    ...record,
    publishedAt: new Date().toISOString()
  }
}

function mockPublishResult(request: PublishRequest): PublishResultMeta {
  const mockTxHash = '0x' + 'mock'.repeat(16)
  const mockStorylineId =
    request.action === 'create-storyline' ? String(Date.now()) : (request.storylineId ?? null)
  return {
    txHash: mockTxHash,
    storylineId: mockStorylineId,
    plotIndex: request.action === 'create-storyline' ? 0 : 1,
    contentCid: 'bafymock' + Date.now().toString(36),
    contentHash: '0x' + 'bb'.repeat(32),
    authorAddress: '0x' + '00'.repeat(20),
    gasCostWei: '0',
    totalCostWei: '0',
    plotlinkUrl: null,
    walletAddress: null,
    walletSource: null,
    indexed: true,
    indexError: null,
    publishedAt: new Date().toISOString()
  }
}

async function loadOrCreateStatus(plotDir: string) {
  try {
    return await readPublishStatus(plotDir)
  } catch {
    return createPublishStatus([])
  }
}

/**
 * Check that the project identified by `projectId` is owned by the active
 * wallet. Returns null when the check passes (active wallet matches, or
 * project is legacy with no wallet stamp and the caller has decided to
 * allow that — currently we do NOT allow publishing legacy projects, so
 * any mismatch including legacy returns an error). Per #223, never select
 * a wallet by first-wallet/name-prefix conventions during publish.
 *
 * Errors are structured so the renderer can surface a clear message to the
 * user before any signing flow runs.
 */
async function checkProjectWalletOwnership(
  projectId: string,
  activeWalletAddress: string | null
): Promise<string | null> {
  if (!activeWalletAddress) {
    return 'No active wallet selected. Connect or switch a wallet before publishing.'
  }
  let projectRoot: string
  try {
    projectRoot = getProjectRoot(projectId)
  } catch (err) {
    return err instanceof Error ? err.message : 'Unknown project'
  }
  let projectAddress: string | null
  try {
    const meta = await readProjectMeta(projectRoot)
    projectAddress = meta.wallet?.address ?? null
  } catch (err) {
    return err instanceof Error ? err.message : 'Failed to read project metadata'
  }
  if (!projectAddress) {
    return 'This project has no wallet ownership. Assign it to the active wallet from the Projects screen before publishing.'
  }
  const active = normalizeWalletAddress(activeWalletAddress)
  if (projectAddress !== active) {
    return `This project belongs to a different wallet (${truncateAddressForError(projectAddress)}). Switch wallets to publish it.`
  }
  return null
}

function truncateAddressForError(addr: string): string {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function registerPublishHandlers(deps: PublishHandlerDeps): void {
  ipcMain.handle(
    'publish:preflight',
    async (_event, projectId?: string): Promise<PublishPreflightResult> => {
      const errors: string[] = []
      const isMock = deps.signer.isMockMode()

      if (!isMock) {
        if (!deps.walletState.wallet) {
          errors.push('No wallet connected')
        }
        errors.push(...validatePublishConfig(deps.config))
        errors.push(...validatePublishChain(deps.vaultConfig.chain))
        // #235 stale-wallet guard. A persisted active identity may have been
        // deleted/renamed in the OWS vault since the last app launch. Catch
        // it at preflight so the renderer can disable the Confirm button
        // before any signer is built.
        if (deps.walletState.wallet) {
          const fresh = checkActiveWalletInVault(
            deps.owsModule,
            deps.vaultConfig,
            deps.walletState.wallet
          )
          if (!fresh.ok && fresh.error) errors.push(fresh.error)
        }
      }

      // #223 wallet-binding: when the renderer supplies a projectId,
      // surface a wallet-ownership mismatch as a preflight error so the
      // confirmation UI can block publish before signing. The same check
      // runs again at execute time so the renderer can never bypass it by
      // skipping preflight.
      if (typeof projectId === 'string' && projectId.length > 0) {
        const ownershipError = await checkProjectWalletOwnership(
          projectId,
          deps.walletState.wallet?.address ?? null
        )
        if (ownershipError) errors.push(ownershipError)
      }

      return {
        ready: errors.length === 0,
        walletAddress: deps.walletState.wallet?.address,
        walletSource: deps.walletState.wallet?.source,
        signerMode: isMock ? 'mock' : 'live',
        errors
      }
    }
  )

  ipcMain.handle(
    'publish:execute',
    async (_event, request: PublishRequest, confirmed: boolean): Promise<PublishExecuteResult> => {
      if (!confirmed) {
        return { success: false, error: 'Publish requires explicit confirmation' }
      }

      const isMock = deps.signer.isMockMode()

      if (isMock) {
        sendProgress(deps, { state: 'uploading', detail: 'Mock: uploading content' })
        sendProgress(deps, { state: 'estimating', detail: 'Mock: estimating gas' })
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

      const configErrors = [
        ...validatePublishConfig(deps.config),
        ...validatePublishChain(deps.vaultConfig.chain)
      ]
      if (configErrors.length > 0) {
        return { success: false, error: configErrors.join('; ') }
      }

      // #235 stale-wallet guard. Runs *before* `createOWSViemSigner` so
      // we never construct a signer for a missing OWS wallet name/id.
      // Preflight already does this check; we re-run here because the
      // renderer can skip preflight or the vault state may have changed
      // between preflight and Confirm.
      const fresh = checkActiveWalletInVault(deps.owsModule, deps.vaultConfig, wallet)
      if (!fresh.ok) {
        return { success: false, error: fresh.error ?? 'Active wallet is unavailable' }
      }

      // #223 wallet-binding: refuse to publish a project owned by a
      // different wallet. Runs after the wallet + config validations so
      // those existing error paths still produce their canonical messages;
      // skipped in mock mode (no real signing) so dev fixtures don't have
      // to register projects with the project registry.
      const ownershipError = await checkProjectWalletOwnership(request.projectId, wallet.address)
      if (ownershipError) {
        return { success: false, error: ownershipError }
      }

      let creationFeeWei: string | undefined = deps.config.creationFeeWei
      if (request.action === 'create-storyline') {
        if (!creationFeeWei) {
          try {
            creationFeeWei = await fetchCreationFee(deps.config)
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Unknown error'
            return { success: false, error: `Failed to fetch creation fee: ${msg}` }
          }
        }
      }

      const plotDir = await deps.resolvePlotDir(request.projectId, request.plotSlug)

      try {
        let status = await loadOrCreateStatus(plotDir)
        status = setPlotState(status, 'publishing')
        await writePublishStatus(plotDir, status)

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

        sendProgress(deps, { state: 'estimating', detail: 'Estimating gas' })

        const indexMeta =
          request.action === 'create-storyline'
            ? {
                isNsfw: request.isNsfw ?? 'false',
                contentType: request.contentType ?? 'cartoon'
              }
            : { isNsfw: request.isNsfw ?? 'false' }

        sendProgress(deps, { state: 'signing', detail: 'Signing transaction' })
        sendProgress(deps, { state: 'broadcasting', detail: 'Broadcasting transaction' })

        const fullResult = await realPublish(
          {
            action: request.action,
            title: request.title,
            contentCid: '',
            contentHash: '',
            storylineId: request.storylineId,
            hasDeadline: request.hasDeadline,
            creationFeeWei: request.action === 'create-storyline' ? creationFeeWei : undefined
          },
          request.markdown,
          wallet.address,
          publishDeps,
          indexMeta
        )

        if (!fullResult.confirmed) {
          sendProgress(deps, { state: 'error', detail: 'Transaction reverted' })
          status = markPlotFailed(status, 'Transaction reverted on chain')
          await writePublishStatus(plotDir, status)
          return { success: false, error: 'Transaction reverted on chain' }
        }

        sendProgress(deps, { state: 'confirming', detail: 'Transaction confirmed' })

        const plotlinkUrl = buildPlotlinkUrl(
          deps.config.plotlinkBaseUrl,
          fullResult.storylineId,
          fullResult.plotIndex,
          request.action
        )

        const resultRecord = toResultRecord(
          fullResult,
          { address: wallet.address, source: wallet.source },
          plotlinkUrl,
          request.action
        )

        if (fullResult.indexed) {
          sendProgress(deps, { state: 'indexing', detail: 'Indexed on PlotLink' })
          status = markPlotPublished(status, resultRecord)
        } else {
          sendProgress(deps, {
            state: 'error',
            detail: fullResult.indexError ?? 'Indexing failed'
          })
          status = markPublishedNotIndexed(status, resultRecord)
        }
        await writePublishStatus(plotDir, status)

        const resultMeta = toResultMeta(resultRecord)

        sendProgress(deps, {
          state: fullResult.indexed ? 'done' : 'error',
          detail: fullResult.indexed ? 'Published successfully' : 'Published but indexing failed'
        })

        return { success: true, result: resultMeta }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown publish error'
        sendProgress(deps, { state: 'error', detail: message })
        try {
          let status = await loadOrCreateStatus(plotDir)
          status = markPlotFailed(status, message)
          await writePublishStatus(plotDir, status)
        } catch {
          // status persistence is best-effort
        }
        return { success: false, error: message }
      }
    }
  )

  ipcMain.handle(
    'publish:retryIndex',
    async (
      _event,
      params: {
        projectId: string
        plotSlug: string
        fallbackContent?: string
        meta?: { contentType?: string; isNsfw?: string; genre?: string; language?: string }
      }
    ): Promise<{ success: boolean; error?: string }> => {
      // #223 RE1 finding: recovery/repair state must not cross-contaminate
      // wallets — and it must not cross-contaminate in MOCK mode either,
      // because mock mode is the default runtime path and `retryIndex`
      // mutates the local `.publish-status.json` regardless of whether
      // anything is sent on-chain. Wallet B must not be able to flip
      // wallet A's plot from `published-not-indexed` back to `published`.
      const retryOwnershipError = await checkProjectWalletOwnership(
        params.projectId,
        deps.walletState.wallet?.address ?? null
      )
      if (retryOwnershipError) {
        return { success: false, error: retryOwnershipError }
      }

      const plotDir = await deps.resolvePlotDir(params.projectId, params.plotSlug)

      let status = await loadOrCreateStatus(plotDir)
      const eligibility = checkRetryContentEligibility(status, params.fallbackContent)
      if (!eligibility.eligible) {
        return { success: false, error: eligibility.reason ?? 'Not eligible for retry' }
      }

      const result = status.publishResult!
      const { url, isStoryline } = selectIndexEndpoint(result, deps.config.plotlinkBaseUrl)
      const body = buildIndexBody(result, isStoryline, params.fallbackContent ?? null, params.meta)

      const indexResult = await retryIndex(body, url, {
        plotlinkBaseUrl: deps.config.plotlinkBaseUrl,
        indexRetries: deps.config.indexRetries,
        indexRetryDelayMs: deps.config.indexRetryDelayMs,
        fetch: deps.fetchFn
      })

      if (indexResult.success) {
        const updatedResult: PublishResultRecord = {
          ...result,
          indexed: true,
          indexError: null
        }
        status = markPlotPublished(status, updatedResult)
      } else {
        const updatedResult: PublishResultRecord = {
          ...result,
          indexError: indexResult.error ?? 'Index retry failed'
        }
        status = markPublishedNotIndexed(status, updatedResult)
      }

      await writePublishStatus(plotDir, status)
      return indexResult
    }
  )

  ipcMain.handle(
    'publish:markNotIndexed',
    async (
      _event,
      params: { projectId: string; plotSlug: string; reason: string }
    ): Promise<{ success: boolean; error?: string }> => {
      // #223 RE1 finding: protect recovery-path mutation from a cross-
      // wallet caller in BOTH mock and live modes — markNotIndexed flips
      // `.publish-status.json` from `published` to `published-not-indexed`,
      // and that state must remain wallet-scoped regardless of signer.
      const markOwnershipError = await checkProjectWalletOwnership(
        params.projectId,
        deps.walletState.wallet?.address ?? null
      )
      if (markOwnershipError) {
        return { success: false, error: markOwnershipError }
      }

      const plotDir = await deps.resolvePlotDir(params.projectId, params.plotSlug)

      let status = await loadOrCreateStatus(plotDir)

      if (status.plotState !== 'published' && status.plotState !== 'published-not-indexed') {
        return {
          success: false,
          error: 'Can only mark published or published-not-indexed plots'
        }
      }

      if (!status.publishResult) {
        return { success: false, error: 'No publish result metadata to preserve' }
      }

      status = markManualNotIndexed(status, params.reason)
      await writePublishStatus(plotDir, status)
      return { success: true }
    }
  )
}
