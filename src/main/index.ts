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
import { registerPublishHandlers } from './ipc/publishHandlers'
import { registerDashboardHandlers } from './ipc/dashboardHandlers'
import { registerRoyaltyHandlers } from './ipc/royaltyHandlers'
import { registerAgentRegistrationHandlers } from './ipc/agentRegistrationHandlers'
import { getDefaultRoyaltyConfig } from './services/royaltyClaim'
import { getDefaultAgentRegistrationConfig } from './services/agentRegistration'
import { destroyAllSessions } from './services/terminalSession'
import { createWalletSigner } from './services/walletSigning'
import { createOWSConfig, createOWSFromCore, OWS_UNAVAILABLE_MESSAGE } from './services/owsAdapter'
import { getDefaultPublishConfig, createPlotlinkUploadClient } from './services/plotlinkPublish'
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
  registerProjectHandlers()
  registerTerminalHandlers()

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

  const walletConfig = createOWSConfig(owsModule, vaultConfig)
  registerWalletConnectionHandlers(walletConfig, walletState, signer)

  const publishConfig = getDefaultPublishConfig()
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
      fetchRoyalty: async (walletAddress: string) => {
        const baseUrl = publishConfig.plotlinkBaseUrl
        const response = await fetch(`${baseUrl}/api/royalty/${walletAddress}`)
        if (!response.ok) throw new Error(`Royalty API returned ${response.status}`)
        const json = (await response.json()) as {
          earnedWei: string
          claimedWei: string
          unclaimedWei: string
        }
        return {
          earnedWei: json.earnedWei,
          claimedWei: json.claimedWei,
          unclaimedWei: json.unclaimedWei
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
