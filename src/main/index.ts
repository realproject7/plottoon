import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerFsHandlers } from './ipc/fsHandlers'
import { registerProjectHandlers } from './ipc/projectHandlers'
import { registerTerminalHandlers } from './ipc/terminalHandlers'
import { registerSigningHandlers } from './ipc/signingHandlers'
import {
  registerWalletConnectionHandlers,
  createSelectedWalletState
} from './ipc/walletConnectionHandlers'
import {
  registerWalletIdentityHandlers,
  restoreActiveWalletFromStore
} from './ipc/walletIdentityHandlers'
import { createWalletIdentityStore } from './services/walletIdentityStore'
import { registerPublishHandlers } from './ipc/publishHandlers'
import { registerDashboardHandlers } from './ipc/dashboardHandlers'
import { registerRoyaltyHandlers } from './ipc/royaltyHandlers'
import { registerAgentRegistrationHandlers } from './ipc/agentRegistrationHandlers'
import {
  getDefaultRoyaltyConfig,
  readRoyaltyInfo,
  PLOT_TOKEN_BASE_MAINNET
} from './services/royaltyClaim'
import { getDefaultAgentRegistrationConfig } from './services/agentRegistration'
import { destroyAllSessions } from './services/terminalSession'
import { createWalletSigner } from './services/walletSigning'
import { createOWSConfig, createOWSFromCore, OWS_UNAVAILABLE_MESSAGE } from './services/owsAdapter'
import { getDefaultPublishConfig, createPlotlinkUploadClient } from './services/plotlinkPublish'
import { readErc20Balance, USDC_BASE_MAINNET } from './services/erc20Balance'
import { resolveOwsVaultConfig } from './services/owsRuntimeConfig'
import { resolveProjectFilePath } from './services/fsService'
import { keccak256, toBytes } from 'viem'

const currentDir = path.dirname(fileURLToPath(import.meta.url))

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(currentDir, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(currentDir, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  registerFsHandlers()

  let owsModule: import('./services/owsAdapter').OWSCoreModule
  try {
    owsModule = await createOWSFromCore()
  } catch (err) {
    console.warn('OWS wallet module unavailable — wallet features disabled:', err)
    const unavailable = () => {
      throw new Error(OWS_UNAVAILABLE_MESSAGE)
    }
    owsModule = {
      listWallets: unavailable,
      createWallet: unavailable,
      signMessage: unavailable,
      signTransaction: unavailable
    } as unknown as import('./services/owsAdapter').OWSCoreModule
  }

  const vaultConfig = resolveOwsVaultConfig()

  const signerMode = (process.env.PLOTLINK_SIGNER_MODE === 'live' ? 'live' : 'mock') as
    | 'live'
    | 'mock'

  const walletState = createSelectedWalletState()

  const signer = createWalletSigner({
    mode: signerMode,
    sign:
      signerMode === 'live'
        ? async (message: string) => {
            const wallet = walletState.wallet
            if (!wallet) throw new Error('No wallet connected for signing')
            const result = owsModule.signMessage(
              wallet.name,
              vaultConfig.chain,
              message,
              vaultConfig.passphrase ?? null
            )
            return result.signature
          }
        : undefined
  })
  registerSigningHandlers(signer)

  const identityStore = createWalletIdentityStore({
    filePath: path.join(app.getPath('userData'), 'wallet-identities.json')
  })
  // Restore the persisted active wallet so single-wallet users don't have to
  // reconnect after every app launch (backward compat per #218).
  await restoreActiveWalletFromStore(identityStore, walletState)

  const walletConfig = createOWSConfig(owsModule, vaultConfig)
  registerWalletConnectionHandlers(walletConfig, walletState, signer, identityStore)
  registerWalletIdentityHandlers({ store: identityStore, walletState })

  // Publish config is computed early so the project handler can surface
  // the real PlotLink config + signer mode on the Status / Capability
  // Report page (#253).
  const publishConfig = getDefaultPublishConfig()

  // Project handlers depend on the wallet identity store so `project:discover`
  // can partition by active wallet and `project:create` can stamp ownership
  // metadata (#220). Registered after the store is constructed.
  registerProjectHandlers({
    walletIdentityStore: identityStore,
    capabilityContext: {
      publishConfig,
      signerMode,
      // #253 RE1: the Status wallet check runs the same vault freshness
      // guard the live publish/claim/agent flows use, so it can't show
      // Wallet:pass / Publish:pass when signing would fail at the
      // existing #235/#240 precheck.
      owsModule,
      vaultConfig
    }
  })

  // Terminal sessions are keyed by (projectId, activeWalletAddress) so
  // wallet A and wallet B don't reattach to each other's running shell
  // (#221). Registered after the wallet identity store for the same reason
  // as project handlers above.
  registerTerminalHandlers({ walletIdentityStore: identityStore })

  registerPublishHandlers({
    walletState,
    signer,
    owsModule,
    vaultConfig,
    config: publishConfig,
    ipfs: createPlotlinkUploadClient(publishConfig.plotlinkBaseUrl),
    keccak: (content: string) => keccak256(toBytes(content)),
    fetchFn: fetch as unknown as (url: string, init: RequestInit) => Promise<Response>,
    getWindow: () => BrowserWindow.getAllWindows()[0] ?? null,
    resolvePlotDir: async (projectId: string, plotSlug: string) =>
      resolveProjectFilePath(projectId, 'plots', plotSlug)
  })

  // #249: derive the Dashboard royalty config from the publish config so
  // we read PLOT royalties from the same MCV2 bond + PLOT token plotlink-ows
  // hits. The previous wiring called `${plotlinkBaseUrl}/api/royalty/<addr>`
  // — that PlotLink endpoint does not exist, and #248 / #249 explicitly
  // forbid introducing one. Dashboard royalty now reads directly from
  // Base RPC via `readRoyaltyInfo`.
  const dashboardRoyaltyConfig = getDefaultRoyaltyConfig()

  registerDashboardHandlers({
    getDashboardDeps: () => ({
      getWallet: () => walletState.wallet,
      fetchBalance: publishConfig.rpcUrl
        ? async (walletAddress: string) => {
            const { createPublicClient, http } = await import('viem')
            const { base } = await import('viem/chains')
            const client = createPublicClient({
              chain: base,
              transport: http(publishConfig.rpcUrl)
            })
            const balance = await client.getBalance({
              address: walletAddress as `0x${string}`
            })
            return balance.toString()
          }
        : undefined,
      // #249: USDC + PLOT balances via direct RPC. Mirrors plotlink-ows
      // wallet.ts which hits the same two contracts with `balanceOf`.
      fetchUsdcBalance: publishConfig.rpcUrl
        ? (walletAddress: string) =>
            readErc20Balance(walletAddress, {
              rpcUrl: publishConfig.rpcUrl,
              token: USDC_BASE_MAINNET
            })
        : undefined,
      fetchPlotBalance: publishConfig.rpcUrl
        ? (walletAddress: string) =>
            readErc20Balance(walletAddress, {
              rpcUrl: publishConfig.rpcUrl,
              token: dashboardRoyaltyConfig.plotTokenAddress || PLOT_TOKEN_BASE_MAINNET
            })
        : undefined,
      fetchEthPrice: async () => {
        const response = await fetch(
          'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd'
        )
        if (!response.ok) throw new Error(`Price API returned ${response.status}`)
        const json = (await response.json()) as { ethereum?: { usd?: number } }
        const usd = json.ethereum?.usd
        if (typeof usd !== 'number') throw new Error('Unexpected price response format')
        return usd
      },
      // #249: best-effort PLOT/USD via the same CoinGecko shape, looked up
      // by the PLOT token's Base address. Returns 0 on failure (the
      // dashboard hides the PnL row when this is unavailable) — never
      // raise: the rest of the Dashboard must always render.
      fetchPlotPrice: async () => {
        const tokenAddr = (
          dashboardRoyaltyConfig.plotTokenAddress || PLOT_TOKEN_BASE_MAINNET
        ).toLowerCase()
        const response = await fetch(
          `https://api.coingecko.com/api/v3/simple/token_price/base?contract_addresses=${tokenAddr}&vs_currencies=usd`
        )
        if (!response.ok) throw new Error(`PLOT price API returned ${response.status}`)
        const json = (await response.json()) as Record<string, { usd?: number }>
        const usd = json[tokenAddr]?.usd
        if (typeof usd !== 'number') throw new Error('Unexpected PLOT price response format')
        return usd
      },
      fetchRoyalty: async (walletAddress: string) => {
        const info = await readRoyaltyInfo(
          walletAddress,
          dashboardRoyaltyConfig.plotTokenAddress || PLOT_TOKEN_BASE_MAINNET,
          { config: dashboardRoyaltyConfig }
        )
        return {
          earnedWei: info.earnedWei,
          claimedWei: info.claimedWei,
          unclaimedWei: info.unclaimedWei
        }
      }
    })
  })

  const royaltyConfig = getDefaultRoyaltyConfig()
  registerRoyaltyHandlers({
    walletState,
    owsModule,
    vaultConfig,
    royaltyConfig,
    signerMode,
    getWindow: () => BrowserWindow.getAllWindows()[0] ?? null
  })

  const registrationConfig = getDefaultAgentRegistrationConfig()
  registerAgentRegistrationHandlers({
    walletState,
    owsModule,
    vaultConfig,
    registrationConfig,
    signerMode
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  destroyAllSessions()
})
